import type { AudioCodec, AudioTrack, ContainerFormat, ConversionOptions, VideoCodec, VideoTrack } from './types'

export interface VideoSourceProfile {
  width: number
  height: number
  duration: number
  frameRate: number
  container: ContainerFormat
  videoCodec: VideoCodec
  audioCodec?: AudioCodec
  videoBitrate?: number
  hasAudio?: boolean
  hdr?: boolean
}

export interface VideoRendition {
  name: string
  width: number
  height: number
  frameRate: number
  videoBitrate: number
  audioBitrate: number
}

export interface VideoRuntimeCapabilities {
  videoEncoder: boolean
  audioEncoder: boolean
  videoCodecs: VideoCodec[]
  audioCodecs: AudioCodec[]
}

export interface VideoDeliveryOptions {
  formats?: Array<'mp4' | 'webm'>
  streaming?: Array<'hls' | 'dash'>
  maxHeight?: number
  minHeight?: number
  renditions?: VideoRendition[]
}

export interface PlannedVideoOutput {
  container: 'mp4' | 'webm'
  videoCodec: VideoCodec
  audioCodec?: AudioCodec
  action: 'copy' | 'transcode'
  available: boolean
  reason?: string
}

export interface VideoDeliveryPlan {
  source: VideoSourceProfile
  renditions: VideoRendition[]
  outputs: PlannedVideoOutput[]
  streaming: Array<'hls' | 'dash'>
  segmentDuration: number
  keyframeInterval: number
}

export interface PreviewCue {
  startTime: number
  endTime: number
  uri: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface SegmentBoundary {
  startTime: number
  duration: number
}

export interface SegmentAlignmentIssue {
  rendition: number
  segment: number
  expected: number
  actual: number
}

const standardShortEdges = [240, 360, 480, 540, 720, 1080, 1440, 2160]

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function validateSource(source: VideoSourceProfile): void {
  for (const [name, value] of Object.entries({
    width: source.width,
    height: source.height,
    duration: source.duration,
    frameRate: source.frameRate,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`Video ${name} must be a positive number`)
  }
}

function recommendedVideoBitrate(width: number, height: number, frameRate: number, hdr: boolean): number {
  const framesMultiplier = frameRate > 30 ? Math.min(2, frameRate / 30) : 1
  const hdrMultiplier = hdr ? 1.25 : 1
  return Math.round(width * height * Math.min(frameRate, 60) * 0.075 * framesMultiplier * hdrMultiplier / 1000) * 1000
}

function recommendedAudioBitrate(width: number, hasAudio: boolean): number {
  if (!hasAudio) return 0
  return width >= 1280 ? 192_000 : 128_000
}

export function deriveVideoLadder(
  source: VideoSourceProfile,
  options: Pick<VideoDeliveryOptions, 'maxHeight' | 'minHeight'> = {},
): VideoRendition[] {
  validateSource(source)
  const isPortrait = source.height > source.width
  const sourceShortEdge = Math.min(source.width, source.height)
  const minimum = Math.max(2, options.minHeight ?? 240)
  const maximum = Math.min(sourceShortEdge, options.maxHeight ?? sourceShortEdge)
  const targets = standardShortEdges.filter(target => target >= minimum && target <= maximum)
  targets.push(sourceShortEdge)

  const unique = [...new Set(targets)].sort((a, b) => a - b)
  const renditions = unique.map((shortEdge) => {
    const scale = shortEdge / sourceShortEdge
    const width = even(source.width * scale)
    const height = even(source.height * scale)
    const recommended = recommendedVideoBitrate(width, height, source.frameRate, source.hdr ?? false)
    return {
      name: `${shortEdge}p`,
      width,
      height,
      frameRate: source.frameRate,
      videoBitrate: Math.max(250_000, Math.min(source.videoBitrate ?? Number.POSITIVE_INFINITY, recommended)),
      audioBitrate: recommendedAudioBitrate(isPortrait ? height : width, source.hasAudio ?? source.audioCodec !== undefined),
    }
  })

  return renditions.filter((rendition, index, all) =>
    rendition.width <= source.width
    && rendition.height <= source.height
    && all.findIndex(item => item.width === rendition.width && item.height === rendition.height) === index,
  )
}

function supportsCodec<T extends string>(available: T[], codec: T): boolean {
  return available.includes(codec)
}

export function buildVideoDeliveryPlan(
  source: VideoSourceProfile,
  options: VideoDeliveryOptions = {},
  capabilities: VideoRuntimeCapabilities = { videoEncoder: false, audioEncoder: false, videoCodecs: [], audioCodecs: [] },
): VideoDeliveryPlan {
  validateSource(source)
  const renditions = options.renditions ?? deriveVideoLadder(source, options)
  if (renditions.length === 0) throw new TypeError('Video delivery plan requires at least one rendition')
  if (renditions.some(rendition => rendition.width > source.width || rendition.height > source.height)) {
    throw new TypeError('Video renditions cannot upscale the source')
  }

  const formats: Array<'mp4' | 'webm'> = [...new Set(options.formats ?? ['mp4', 'webm'] as const)]
  const outputs = formats.map((container): PlannedVideoOutput => {
    const videoCodec: VideoCodec = container === 'mp4' ? 'h264' : 'vp9'
    const audioCodec: AudioCodec | undefined = source.hasAudio === false ? undefined : container === 'mp4' ? 'aac' : 'opus'
    const canCopyVideo = source.container === container && source.videoCodec === videoCodec
    const canCopyAudio = !audioCodec || source.audioCodec === audioCodec
    const action = canCopyVideo && canCopyAudio && renditions.length === 1
      && renditions[0].width === source.width && renditions[0].height === source.height
      ? 'copy'
      : 'transcode'
    const hasVideoEncoder = action === 'copy' || (capabilities.videoEncoder && supportsCodec(capabilities.videoCodecs, videoCodec))
    const hasAudioEncoder = !audioCodec || canCopyAudio || (capabilities.audioEncoder && supportsCodec(capabilities.audioCodecs, audioCodec))
    const available = hasVideoEncoder && hasAudioEncoder
    const reason = !hasVideoEncoder
      ? `No ${videoCodec} video encoder is available`
      : !hasAudioEncoder && audioCodec
        ? `No ${audioCodec} audio encoder is available`
        : undefined
    return { container, videoCodec, audioCodec, action, available, reason }
  })

  const segmentDuration = source.duration <= 30 ? 2 : source.duration <= 600 ? 4 : 6
  return {
    source,
    renditions,
    outputs,
    streaming: [...new Set(options.streaming ?? ['hls', 'dash'] as const)],
    segmentDuration,
    keyframeInterval: Math.max(1, Math.round(source.frameRate * segmentDuration)),
  }
}

export function assertVideoPlanExecutable(plan: VideoDeliveryPlan): void {
  const unavailable = plan.outputs.filter(output => !output.available)
  if (unavailable.length === 0) return
  throw new Error(unavailable.map(output => `${output.container}: ${output.reason}`).join('; '))
}

export async function detectVideoRuntimeCapabilities(): Promise<VideoRuntimeCapabilities> {
  const videoCodecs: VideoCodec[] = []
  const audioCodecs: AudioCodec[] = []
  const videoConfigs: Array<[VideoCodec, VideoEncoderConfig]> = [
    ['h264', { codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 6_000_000, framerate: 30 }],
    ['vp9', { codec: 'vp09.00.10.08', width: 1920, height: 1080, bitrate: 4_000_000, framerate: 30 }],
    ['av1', { codec: 'av01.0.08M.08', width: 1920, height: 1080, bitrate: 3_000_000, framerate: 30 }],
  ]
  const audioConfigs: Array<[AudioCodec, AudioEncoderConfig]> = [
    ['aac', { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 }],
    ['opus', { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 }],
  ]

  if (typeof VideoEncoder !== 'undefined') {
    for (const [codec, config] of videoConfigs) {
      const support = await VideoEncoder.isConfigSupported(config).catch(() => null)
      if (support?.supported) videoCodecs.push(codec)
    }
  }
  if (typeof AudioEncoder !== 'undefined') {
    for (const [codec, config] of audioConfigs) {
      const support = await AudioEncoder.isConfigSupported(config).catch(() => null)
      if (support?.supported) audioCodecs.push(codec)
    }
  }

  return {
    videoEncoder: videoCodecs.length > 0,
    audioEncoder: audioCodecs.length > 0,
    videoCodecs,
    audioCodecs,
  }
}

function formatVttTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Preview timestamps must be non-negative')
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function generatePreviewVtt(cues: readonly PreviewCue[]): string {
  let previousEnd = 0
  const output = ['WEBVTT', '']
  cues.forEach((cue, index) => {
    if (cue.endTime <= cue.startTime) throw new TypeError(`Preview cue ${index} must have a positive duration`)
    if (cue.startTime < previousEnd) throw new TypeError(`Preview cue ${index} overlaps the previous cue`)
    const hasSprite = [cue.x, cue.y, cue.width, cue.height].some(value => value !== undefined)
    if (hasSprite && [cue.x, cue.y, cue.width, cue.height].some(value => value === undefined || value! < 0)) {
      throw new TypeError(`Preview cue ${index} requires valid x, y, width, and height values`)
    }
    output.push(`${formatVttTime(cue.startTime)} --> ${formatVttTime(cue.endTime)}`)
    output.push(hasSprite ? `${cue.uri}#xywh=${cue.x},${cue.y},${cue.width},${cue.height}` : cue.uri, '')
    previousEnd = cue.endTime
  })
  return output.join('\n')
}

export function validateSegmentAlignment(
  timelines: readonly (readonly SegmentBoundary[])[],
  tolerance = 0.05,
): SegmentAlignmentIssue[] {
  if (tolerance < 0 || !Number.isFinite(tolerance)) throw new TypeError('Segment tolerance must be non-negative')
  const reference = timelines[0] ?? []
  const issues: SegmentAlignmentIssue[] = []
  timelines.slice(1).forEach((timeline, renditionIndex) => {
    const length = Math.max(reference.length, timeline.length)
    for (let segment = 0; segment < length; segment++) {
      const expected = reference[segment]?.startTime ?? Number.NaN
      const actual = timeline[segment]?.startTime ?? Number.NaN
      if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > tolerance) {
        issues.push({ rendition: renditionIndex + 1, segment, expected, actual })
      }
    }
  })
  return issues
}

/** Guard the packet-copy conversion path from silently relabeling unmodified encoded packets. */
export function assertPacketCopyConversion(
  videoTrack: VideoTrack | null,
  audioTrack: AudioTrack | null,
  options: ConversionOptions,
): void {
  const requested: string[] = []
  if (videoTrack) {
    if (options.videoCodec && options.videoCodec !== videoTrack.codec) requested.push(`video codec ${videoTrack.codec} to ${options.videoCodec}`)
    if (options.width !== undefined && options.width !== videoTrack.width) requested.push(`width ${videoTrack.width} to ${options.width}`)
    if (options.height !== undefined && options.height !== videoTrack.height) requested.push(`height ${videoTrack.height} to ${options.height}`)
    if (options.frameRate !== undefined && options.frameRate !== videoTrack.frameRate) requested.push(`frame rate ${videoTrack.frameRate ?? 'unknown'} to ${options.frameRate}`)
    if (options.videoBitrate !== undefined && options.videoBitrate !== videoTrack.bitrate) requested.push(`video bitrate ${videoTrack.bitrate ?? 'unknown'} to ${options.videoBitrate}`)
    if (options.quality) requested.push(`video quality ${options.quality.name}`)
  }
  if (audioTrack) {
    if (options.audioCodec && options.audioCodec !== audioTrack.codec) requested.push(`audio codec ${audioTrack.codec} to ${options.audioCodec}`)
    if (options.sampleRate !== undefined && options.sampleRate !== audioTrack.sampleRate) requested.push(`sample rate ${audioTrack.sampleRate} to ${options.sampleRate}`)
    if (options.channels !== undefined && options.channels !== audioTrack.channels) requested.push(`channels ${audioTrack.channels} to ${options.channels}`)
    if (options.audioBitrate !== undefined && options.audioBitrate !== audioTrack.bitrate) requested.push(`audio bitrate ${audioTrack.bitrate ?? 'unknown'} to ${options.audioBitrate}`)
  }
  if (requested.length > 0) {
    throw new Error(`Packet-copy conversion cannot perform ${requested.join(', ')}. Use a native encoder pipeline before muxing.`)
  }
}
