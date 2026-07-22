import type { InputFormat } from './demuxer'
import type { VideoDeliveryPlan, VideoRendition } from './delivery'
import type { VideoDerivative, VideoDerivativeOptions } from './native-transcode'
import type { AdaptiveDeliveryBundle, AdaptiveDeliveryOptions, AdaptiveRenditionInput } from './protected-delivery'
import type { Source } from './reader'
import type { SpriteSheetOptions, SpriteSheetResult, ThumbnailOptions, ThumbnailResult } from './thumbnails'
import type { VideoCodec, VideoTrack } from './types'
import { generatePreviewVtt } from './delivery'
import { Input } from './input'
import { generateVideoDerivatives } from './native-transcode'
import { Output } from './output'
import { createAdaptiveDeliveryBundle } from './protected-delivery'
import { createSource } from './source'
import { generateSpriteSheet, generateThumbnailAt } from './thumbnails'

interface Mp4Box {
  type: string
  start: number
  end: number
}

export interface FragmentedMp4Parts {
  initialization: Uint8Array
  segments: Uint8Array[]
}

export interface VideoPosterOptions extends ThumbnailOptions {
  timestamp?: number
  uri?: string
}

export interface VideoPreviewOptions extends SpriteSheetOptions {
  frameCount?: number
  uri?: string
  vttUri?: string
}

export interface VideoDeliveryPipelineOptions extends Omit<VideoDerivativeOptions, 'outputFactory'> {
  adaptive?: false | AdaptiveDeliveryOptions
  poster?: false | true | 'auto' | VideoPosterOptions
  previews?: false | true | 'auto' | VideoPreviewOptions
}

export interface VideoPosterAsset extends Omit<ThumbnailResult, 'data'> {
  uri: string
  data: Uint8Array
}

export interface VideoPreviewAsset extends Omit<SpriteSheetResult, 'data'> {
  uri: string
  vttUri: string
  data: Uint8Array
  vtt: string
}

export interface VideoDeliveryPipelineResult {
  derivatives: VideoDerivative[]
  adaptive?: AdaptiveDeliveryBundle
  poster?: VideoPosterAsset
  previews?: VideoPreviewAsset
  files: Record<string, string | Uint8Array>
}

function readBox(bytes: Uint8Array, offset: number): Mp4Box {
  if (offset + 8 > bytes.byteLength) throw new TypeError('Truncated MP4 box header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let size = view.getUint32(offset)
  const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > bytes.byteLength) throw new TypeError('Truncated extended MP4 box header')
    const extended = view.getBigUint64(offset + 8)
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('MP4 box is too large to address safely')
    size = Number(extended)
    headerSize = 16
  }
  else if (size === 0) {
    size = bytes.byteLength - offset
  }
  if (size < headerSize || offset + size > bytes.byteLength) throw new TypeError(`Invalid ${type} MP4 box size`)
  return { type, start: offset, end: offset + size }
}

/** Split one finalized fragmented MP4 into its reusable initialization and media fragments. */
export function splitFragmentedMp4(bytes: Uint8Array): FragmentedMp4Parts {
  const boxes: Mp4Box[] = []
  for (let offset = 0; offset < bytes.byteLength;) {
    const box = readBox(bytes, offset)
    boxes.push(box)
    offset = box.end
  }
  const firstFragment = boxes.findIndex(box => box.type === 'moof')
  if (firstFragment < 0) throw new TypeError('Fragmented MP4 contains no moof boxes')
  if (!boxes.slice(0, firstFragment).some(box => box.type === 'moov')) {
    throw new TypeError('Fragmented MP4 contains no initialization metadata')
  }

  const initialization = bytes.slice(0, boxes[firstFragment].start)
  const segments: Uint8Array[] = []
  for (let index = firstFragment; index < boxes.length;) {
    if (boxes[index].type !== 'moof') {
      index++
      continue
    }
    const start = boxes[index].start
    let end = boxes[index].end
    index++
    const contentStart = index
    while (index < boxes.length && boxes[index].type !== 'moof' && boxes[index].type !== 'mfra') {
      end = boxes[index].end
      index++
    }
    const hasMedia = boxes.slice(contentStart, index).some(box => box.type === 'mdat')
    if (!hasMedia) throw new TypeError('Fragmented MP4 fragment contains no mdat box')
    segments.push(bytes.slice(start, end))
  }
  if (segments.length === 0) throw new TypeError('Fragmented MP4 contains no media segments')
  return { initialization, segments }
}

function decoderCodec(codec: VideoCodec): string {
  switch (codec) {
    case 'h264': return 'avc1.640028'
    case 'h265': return 'hvc1.1.6.L93.B0'
    case 'vp8': return 'vp8'
    case 'vp9': return 'vp09.00.10.08'
    case 'av1': return 'av01.0.08M.08'
    default: throw new TypeError(`Preview decoding is not configured for ${codec}`)
  }
}

function decoderConfig(track: VideoTrack): VideoDecoderConfig {
  return {
    codec: decoderCodec(track.codec),
    codedWidth: track.width,
    codedHeight: track.height,
    description: track.codecDescription,
  }
}

function canGeneratePreviews(): boolean {
  return typeof VideoDecoder !== 'undefined'
    && typeof EncodedVideoChunk !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap !== 'undefined'
}

async function mediaBytes(data: Blob | ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data)
}

function assetOptions<T extends object>(value: false | true | 'auto' | T | undefined): T {
  return typeof value === 'object' ? value : {} as T
}

function assetRequested(value: false | true | 'auto' | object | undefined): boolean {
  if (value === false) return false
  if (value === true || typeof value === 'object') return true
  return canGeneratePreviews()
}

async function inputFormats(): Promise<InputFormat[]> {
  const [mp4, webm] = await Promise.all([import('@ts-videos/mp4'), import('@ts-videos/webm')])
  return [new mp4.Mp4InputFormat(), new mp4.MovInputFormat(), new webm.WebmInputFormat(), new webm.MkvInputFormat()]
}

async function openInput(
  source: string | Uint8Array | ArrayBuffer | Source,
  options: Pick<VideoDeliveryPipelineOptions, 'inputFactory' | 'inputFormats'>,
): Promise<Input> {
  if (options.inputFactory) return options.inputFactory()
  if (typeof source === 'object' && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) {
    throw new TypeError('A custom media source requires an inputFactory')
  }
  return new Input({
    source: createSource(source as string | Uint8Array | ArrayBuffer),
    formats: options.inputFormats ?? await inputFormats(),
  })
}

function derivativePath(derivative: VideoDerivative): string {
  return `video/${derivative.rendition.name}.${derivative.output.container}`
}

function segmentDuration(plan: VideoDeliveryPlan, index: number, count: number): number {
  if (count === 1) return plan.source.duration
  const start = index * plan.segmentDuration
  if (index === count - 1) return Math.max(0.001, plan.source.duration - start)
  return Math.min(plan.segmentDuration, Math.max(0.001, plan.source.duration - start))
}

async function generatePoster(
  source: string | Uint8Array | ArrayBuffer | Source,
  plan: VideoDeliveryPlan,
  pipelineOptions: VideoDeliveryPipelineOptions,
): Promise<VideoPosterAsset | undefined> {
  if (!assetRequested(pipelineOptions.poster)) return undefined
  if (!canGeneratePreviews()) throw new Error('Native WebCodecs and OffscreenCanvas are required for poster generation')
  const options = assetOptions<VideoPosterOptions>(pipelineOptions.poster)
  const input = await openInput(source, pipelineOptions)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track found for poster generation')
    const timestamp = options.timestamp ?? Math.min(5, plan.source.duration * 0.1)
    const result = await generateThumbnailAt(input.packets(track.id), timestamp, decoderConfig(track), options)
    if (!result) return undefined
    return { ...result, uri: options.uri ?? 'poster.jpg', data: await mediaBytes(result.data) }
  }
  finally {
    await input.close()
  }
}

async function generatePreviews(
  source: string | Uint8Array | ArrayBuffer | Source,
  plan: VideoDeliveryPlan,
  pipelineOptions: VideoDeliveryPipelineOptions,
): Promise<VideoPreviewAsset | undefined> {
  if (!assetRequested(pipelineOptions.previews)) return undefined
  if (!canGeneratePreviews()) throw new Error('Native WebCodecs and OffscreenCanvas are required for preview generation')
  const options = assetOptions<VideoPreviewOptions>(pipelineOptions.previews)
  const frameCount = options.frameCount ?? Math.max(1, Math.min(100, Math.ceil(plan.source.duration / 10)))
  const input = await openInput(source, pipelineOptions)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track found for preview generation')
    const sprite = await generateSpriteSheet(input.packets(track.id), frameCount, decoderConfig(track), options)
    const uri = options.uri ?? 'previews.jpg'
    const vttUri = options.vttUri ?? 'previews.vtt'
    const cues = sprite.timestamps.map((startTime, index) => ({
      startTime,
      endTime: sprite.timestamps[index + 1] ?? plan.source.duration,
      uri,
      x: (index % sprite.columns) * sprite.thumbnailSize.width,
      y: Math.floor(index / sprite.columns) * sprite.thumbnailSize.height,
      width: sprite.thumbnailSize.width,
      height: sprite.thumbnailSize.height,
    })).filter(cue => cue.endTime > cue.startTime)
    return {
      ...sprite,
      uri,
      vttUri,
      data: await mediaBytes(sprite.data),
      vtt: generatePreviewVtt(cues),
    }
  }
  finally {
    await input.close()
  }
}

/** Execute progressive, adaptive, poster, and preview output from one delivery plan. */
export async function createVideoDeliveryPipeline(
  source: string | Uint8Array | ArrayBuffer | Source,
  plan: VideoDeliveryPlan,
  options: VideoDeliveryPipelineOptions = {},
): Promise<VideoDeliveryPipelineResult> {
  const adaptiveEnabled = options.adaptive !== false && plan.streaming.length > 0
  const [mp4, webm] = await Promise.all([import('@ts-videos/mp4'), import('@ts-videos/webm')])
  const derivatives = await generateVideoDerivatives(source, plan, {
    inputFactory: options.inputFactory,
    inputFormats: options.inputFormats,
    batchSize: options.batchSize,
    signal: options.signal,
    outputFactory: (planned) => new Output(
      planned.container === 'mp4'
        ? adaptiveEnabled
          ? new mp4.CmafOutputFormat({ fragmentDuration: plan.segmentDuration })
          : new mp4.Mp4OutputFormat()
        : new webm.WebmOutputFormat(),
    ),
  })
  const files: Record<string, string | Uint8Array> = Object.fromEntries(
    derivatives.map(derivative => [derivativePath(derivative), derivative.bytes]),
  )

  let adaptive: AdaptiveDeliveryBundle | undefined
  if (adaptiveEnabled) {
    const inputs: AdaptiveRenditionInput[] = plan.renditions.map((rendition: VideoRendition) => {
      const derivative = derivatives.find(item => item.output.container === 'mp4' && item.rendition.name === rendition.name)
      if (!derivative) throw new Error(`No fragmented MP4 derivative was generated for ${rendition.name}`)
      const parts = splitFragmentedMp4(derivative.bytes)
      return {
        rendition,
        initialization: { uri: 'init.mp4', data: parts.initialization },
        segments: parts.segments.map((data, index) => ({
          uri: `segment-${String(index).padStart(5, '0')}.m4s`,
          startTime: index * plan.segmentDuration,
          duration: segmentDuration(plan, index, parts.segments.length),
          data,
        })),
      }
    })
    adaptive = await createAdaptiveDeliveryBundle(
      plan,
      inputs,
      typeof options.adaptive === 'object' ? options.adaptive : {},
    )
    Object.assign(files, adaptive.files)
  }

  const [poster, previews] = await Promise.all([
    generatePoster(source, plan, options),
    generatePreviews(source, plan, options),
  ])
  if (poster) files[poster.uri] = poster.data
  if (previews) {
    files[previews.uri] = previews.data
    files[previews.vttUri] = previews.vtt
  }

  return { derivatives, adaptive, poster, previews, files }
}
