import type { DashContentProtection, DashRepresentation } from './dash'
import type { HlsKey, HlsSegment, HlsVariantStream } from './hls'
import type { VideoDeliveryPlan, VideoRendition } from './delivery'
import { generateMpd } from './dash'
import { generateMasterPlaylist, generateMediaPlaylist } from './hls'

export type VideoDrmSystem = 'clear-key' | 'fairplay' | 'playready' | 'widevine'

export interface VideoDrmDescriptor {
  system: VideoDrmSystem
  keyId: string
  licenseUrl: string
  pssh?: string
  certificateUrl?: string
}

export interface AdaptiveSegmentInput {
  uri: string
  duration: number
  data: Uint8Array
  startTime?: number
}

export interface AdaptiveRenditionInput {
  rendition: VideoRendition
  playlistUri?: string
  initialization?: { uri: string, data: Uint8Array }
  segments: AdaptiveSegmentInput[]
}

export interface HlsAes128Protection {
  key: Uint8Array | ((_segmentIndex: number, _rendition: VideoRendition) => Uint8Array | Promise<Uint8Array>)
  keyUri: string | ((_segmentIndex: number, _rendition: VideoRendition) => string)
  iv?: Uint8Array | ((_segmentIndex: number, _rendition: VideoRendition) => Uint8Array)
}

export interface AdaptiveDeliveryOptions {
  hls?: boolean
  dash?: boolean
  hlsAes128?: HlsAes128Protection
  drm?: {
    descriptors: VideoDrmDescriptor[]
    hlsSegmentsEncrypted?: boolean
    dashSegmentsEncrypted?: boolean
  }
  baseUrl?: string
}

export interface AdaptiveDeliveryBundle {
  files: Record<string, string | Uint8Array>
  hlsMaster?: string
  dashManifest?: string
  encrypted: boolean
}

const drmSchemeIds: Record<VideoDrmSystem, string> = {
  'clear-key': 'e2719d58-a985-b3c9-781a-b030af78d30e',
  'fairplay': '94ce86fb-07ff-4f43-adb8-93d2fa968ca2',
  'playready': '9a04f079-9840-4286-ab92-e65be0885f95',
  'widevine': 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
}

function normalizedKid(value: string): string {
  const hex = value.toLowerCase().replaceAll('-', '')
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new TypeError('DRM key ID must be a 16-byte hexadecimal UUID')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function basename(path: string): string {
  const value = path.split(/[?#]/, 1)[0].split('/').at(-1)
  if (!value || value === '.' || value === '..') throw new TypeError('Segment URI must include a filename')
  return value
}

function renditionPath(rendition: VideoRendition): string {
  return rendition.name.replaceAll(/[^A-Za-z0-9._-]/g, '-')
}

function ivForSequence(sequence: number): Uint8Array {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('HLS sequence must be a non-negative integer')
  const iv = new Uint8Array(16)
  const view = new DataView(iv.buffer)
  view.setBigUint64(8, BigInt(sequence))
  return iv
}

function hlsIv(value: Uint8Array): string {
  return `0x${[...value].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function encryptHlsSegment(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  if (key.byteLength !== 16) throw new TypeError('HLS AES-128 key must contain exactly 16 bytes')
  if (iv.byteLength !== 16) throw new TypeError('HLS AES-128 IV must contain exactly 16 bytes')
  const keyBytes = Uint8Array.from(key)
  const ivBytes = Uint8Array.from(iv)
  const dataBytes = Uint8Array.from(data)
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'AES-CBC' }, false, ['encrypt'])
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ivBytes.buffer }, cryptoKey, dataBytes.buffer))
}

function dashProtection(descriptors: VideoDrmDescriptor[]): DashContentProtection[] {
  if (descriptors.length === 0) return []
  const keyId = normalizedKid(descriptors[0].keyId)
  if (descriptors.some(descriptor => normalizedKid(descriptor.keyId) !== keyId)) {
    throw new TypeError('A DASH adaptation set must use one default DRM key ID')
  }
  return [
    { schemeIdUri: 'urn:mpeg:dash:mp4protection:2011', value: 'cenc', defaultKID: keyId },
    ...descriptors.map(descriptor => ({
      schemeIdUri: `urn:uuid:${drmSchemeIds[descriptor.system]}`,
      value: descriptor.system,
      defaultKID: keyId,
      pssh: descriptor.pssh,
    })),
  ]
}

function hlsDrmKey(descriptors: VideoDrmDescriptor[]): HlsKey | undefined {
  const fairplay = descriptors.find(descriptor => descriptor.system === 'fairplay')
  if (fairplay) {
    return {
      method: 'SAMPLE-AES',
      uri: fairplay.licenseUrl,
      keyFormat: 'com.apple.streamingkeydelivery',
      keyFormatVersions: '1',
    }
  }
  const descriptor = descriptors.find(item => item.system !== 'clear-key')
  if (!descriptor) return undefined
  return {
    method: 'SAMPLE-AES-CTR',
    uri: descriptor.licenseUrl,
    keyFormat: `urn:uuid:${drmSchemeIds[descriptor.system]}`,
    keyFormatVersions: '1',
  }
}

function codecString(plan: VideoDeliveryPlan): string {
  const mp4 = plan.outputs.find(output => output.container === 'mp4')
  if (!mp4) return 'avc1.640028,mp4a.40.2'
  const video = mp4.videoCodec === 'h264' ? 'avc1.640028' : mp4.videoCodec
  const audio = mp4.audioCodec === 'aac' ? 'mp4a.40.2' : mp4.audioCodec
  return [video, audio].filter(Boolean).join(',')
}

export async function createAdaptiveDeliveryBundle(
  plan: VideoDeliveryPlan,
  inputs: AdaptiveRenditionInput[],
  options: AdaptiveDeliveryOptions = {},
): Promise<AdaptiveDeliveryBundle> {
  const hlsEnabled = options.hls ?? plan.streaming.includes('hls')
  const dashEnabled = options.dash ?? plan.streaming.includes('dash')
  if (!hlsEnabled && !dashEnabled) throw new TypeError('Adaptive delivery requires HLS or DASH output')
  if (inputs.length !== plan.renditions.length) throw new TypeError('Adaptive inputs must match the planned rendition count')
  const files: Record<string, string | Uint8Array> = {}
  const variants: HlsVariantStream[] = []
  const representations: DashRepresentation[] = []
  const drm = options.drm?.descriptors ?? []
  if (drm.length > 0 && hlsEnabled && !options.hlsAes128 && !options.drm?.hlsSegmentsEncrypted) {
    throw new TypeError('DRM HLS manifests require pre-encrypted SAMPLE-AES segments')
  }
  if (drm.length > 0 && dashEnabled && !options.drm?.dashSegmentsEncrypted) {
    throw new TypeError('DRM DASH manifests require pre-encrypted CENC segments')
  }
  const playlistUris = new Set<string>()

  for (const input of inputs) {
    if (input.segments.length === 0) throw new TypeError(`Rendition ${input.rendition.name} has no segments`)
    if (!plan.renditions.some(item => item.name === input.rendition.name && item.width === input.rendition.width && item.height === input.rendition.height)) {
      throw new TypeError(`Rendition ${input.rendition.name} does not match the delivery plan`)
    }
    const path = renditionPath(input.rendition)
    const playlistUri = input.playlistUri ?? `hls/${path}/index.m3u8`
    if (playlistUris.has(playlistUri)) throw new TypeError(`Duplicate rendition playlist URI: ${playlistUri}`)
    playlistUris.add(playlistUri)
    const hlsSegments: HlsSegment[] = []
    const dashSegments: Array<{ media: string }> = []

    if (input.initialization) {
      files[`hls/${path}/${basename(input.initialization.uri)}`] = input.initialization.data
      files[`dash/${path}/${basename(input.initialization.uri)}`] = input.initialization.data
    }

    for (const [index, segment] of input.segments.entries()) {
      if (!Number.isFinite(segment.duration) || segment.duration <= 0) throw new TypeError('Segment duration must be positive')
      const name = basename(segment.uri)
      const hlsPath = `hls/${path}/${name}`
      const dashPath = `dash/${path}/${name}`
      let key: HlsKey | undefined = hlsDrmKey(drm)
      let hlsData = segment.data
      if (options.hlsAes128) {
        const encryptionKey = typeof options.hlsAes128.key === 'function'
          ? await options.hlsAes128.key(index, input.rendition)
          : options.hlsAes128.key
        const keyUri = typeof options.hlsAes128.keyUri === 'function'
          ? options.hlsAes128.keyUri(index, input.rendition)
          : options.hlsAes128.keyUri
        const iv = typeof options.hlsAes128.iv === 'function'
          ? options.hlsAes128.iv(index, input.rendition)
          : options.hlsAes128.iv ?? ivForSequence(index)
        hlsData = await encryptHlsSegment(segment.data, encryptionKey, iv)
        key = { method: 'AES-128', uri: keyUri, iv: hlsIv(iv) }
      }
      if (hlsEnabled) files[hlsPath] = hlsData
      if (dashEnabled) files[dashPath] = segment.data
      hlsSegments.push({
        uri: name,
        duration: segment.duration,
        key,
        map: input.initialization ? { uri: basename(input.initialization.uri) } : undefined,
      })
      dashSegments.push({ media: name })
    }

    if (hlsEnabled) {
      files[playlistUri] = generateMediaPlaylist(hlsSegments, {
        targetDuration: Math.max(...input.segments.map(segment => segment.duration)),
        playlistType: 'VOD',
        independentSegments: true,
      })
      variants.push({
        uri: playlistUri.replace(/^hls\//, ''),
        bandwidth: input.rendition.videoBitrate + input.rendition.audioBitrate,
        resolution: { width: input.rendition.width, height: input.rendition.height },
        frameRate: input.rendition.frameRate,
        codecs: codecString(plan),
        name: input.rendition.name,
      })
    }
    if (dashEnabled) {
      representations.push({
        id: path,
        bandwidth: input.rendition.videoBitrate + input.rendition.audioBitrate,
        codecs: codecString(plan),
        mimeType: 'video/mp4',
        width: input.rendition.width,
        height: input.rendition.height,
        frameRate: String(input.rendition.frameRate),
        baseURL: `${path}/`,
        segmentList: {
          timescale: 1000,
          duration: Math.round(plan.segmentDuration * 1000),
          initialization: input.initialization ? { sourceURL: basename(input.initialization.uri) } : undefined,
          segmentURLs: dashSegments,
        },
      })
    }
  }

  const hlsMaster = hlsEnabled ? generateMasterPlaylist(variants, [], { independentSegments: true }) : undefined
  if (hlsMaster) files['hls/master.m3u8'] = hlsMaster
  const dashManifest = dashEnabled
    ? generateMpd([{
        id: 'main',
        duration: `PT${plan.source.duration}S`,
        adaptationSets: [{
          id: 1,
          contentType: 'video',
          mimeType: 'video/mp4',
          segmentAlignment: true,
          representations,
          contentProtection: dashProtection(drm),
        }],
      }], {
        type: 'static',
        mediaPresentationDuration: `PT${plan.source.duration}S`,
        minBufferTime: `PT${Math.min(2, plan.segmentDuration)}S`,
        baseURL: options.baseUrl,
      })
    : undefined
  if (dashManifest) files['dash/manifest.mpd'] = dashManifest
  return { files, hlsMaster, dashManifest, encrypted: !!options.hlsAes128 || drm.length > 0 }
}
