import type { InputFormat } from './demuxer'
import type { VideoDeliveryPlan, VideoRendition, PlannedVideoOutput } from './delivery'
import type { Input } from './input'
import type { Output } from './output'
import type { Source } from './reader'
import type { AudioCodec, AudioTrack, EncodedPacket, VideoCodec, VideoTrack } from './types'
import { Conversion } from './conversion'
import { assertVideoPlanExecutable } from './delivery'
import { FormatRegistry, registerFormat } from './formats'
import { Input as MediaInput } from './input'
import { Output as MediaOutput } from './output'
import { createSource } from './source'

export type NativeVideoCodec = 'h264' | 'vp9' | 'av1'
export type NativeVideoAudioCodec = 'aac' | 'opus'

export interface NativeVideoTranscodeOptions {
  videoCodec: NativeVideoCodec
  audioCodec?: NativeVideoAudioCodec
  width: number
  height: number
  videoBitrate: number
  audioBitrate?: number
  frameRate?: number
  keyframeInterval?: number
  batchSize?: number
  signal?: AbortSignal
}

export interface NativeVideoTranscodeResult {
  bytes: Uint8Array
  videoCodec: NativeVideoCodec
  audioCodec?: NativeVideoAudioCodec
  videoPackets: number
  audioPackets: number
  inputBytes: number
  outputBytes: number
}

export interface VideoDerivative {
  output: PlannedVideoOutput
  rendition: VideoRendition
  bytes: Uint8Array
}

export interface VideoDerivativeOptions {
  inputFactory?: () => Input
  outputFactory?: (_output: PlannedVideoOutput, _rendition: VideoRendition) => Output
  inputFormats?: InputFormat[]
  batchSize?: number
  signal?: AbortSignal
}

interface NativeVideoFrame {
  timestamp: number
  duration?: number | null
  close: () => void
}

interface NativeAudioData {
  timestamp: number
  duration?: number | null
  close: () => void
}

interface NativeEncodedChunk {
  type?: 'key' | 'delta'
  timestamp: number
  duration?: number | null
  byteLength: number
  copyTo: (_destination: Uint8Array) => void
}

interface NativeDecoderInstance {
  configure: (_config: Record<string, unknown>) => void
  decode: (_chunk: unknown) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeVideoEncoderInstance {
  configure: (_config: Record<string, unknown>) => void
  encode: (_frame: NativeVideoFrame, _options?: { keyFrame?: boolean }) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeAudioEncoderInstance {
  configure: (_config: Record<string, unknown>) => void
  encode: (_data: NativeAudioData) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeDecoderConstructor<T> {
  new (_init: { output: (_value: T) => void, error: (_error: Error) => void }): NativeDecoderInstance
  isConfigSupported: (_config: Record<string, unknown>) => Promise<{ supported?: boolean }>
}

interface NativeVideoEncoderConstructor {
  new (_init: { output: (_chunk: NativeEncodedChunk, _metadata?: NativeEncoderMetadata) => void, error: (_error: Error) => void }): NativeVideoEncoderInstance
  isConfigSupported: (_config: Record<string, unknown>) => Promise<{ supported?: boolean }>
}

interface NativeAudioEncoderConstructor {
  new (_init: { output: (_chunk: NativeEncodedChunk, _metadata?: NativeEncoderMetadata) => void, error: (_error: Error) => void }): NativeAudioEncoderInstance
  isConfigSupported: (_config: Record<string, unknown>) => Promise<{ supported?: boolean }>
}

interface NativeEncoderMetadata {
  decoderConfig?: { description?: ArrayBuffer | ArrayBufferView }
}

interface NativeEncodedChunkConstructor {
  new (_init: { type: 'key' | 'delta', timestamp: number, duration?: number, data: Uint8Array }): unknown
}

interface NativeVideoFrameConstructor {
  new (_source: unknown, _init: { timestamp: number, duration?: number }): NativeVideoFrame
}

interface NativeCanvasContext {
  drawImage: (_source: unknown, _x: number, _y: number, _width: number, _height: number) => void
}

interface NativeCanvas {
  getContext: (_kind: '2d', _options?: { alpha?: boolean }) => NativeCanvasContext | null
}

interface NativeCanvasConstructor {
  new (_width: number, _height: number): NativeCanvas
}

interface PendingPacket {
  kind: 'video' | 'audio'
  packet: EncodedPacket
}

interface NativeGlobals {
  VideoDecoder?: NativeDecoderConstructor<NativeVideoFrame>
  VideoEncoder?: NativeVideoEncoderConstructor
  EncodedVideoChunk?: NativeEncodedChunkConstructor
  AudioDecoder?: NativeDecoderConstructor<NativeAudioData>
  AudioEncoder?: NativeAudioEncoderConstructor
  EncodedAudioChunk?: NativeEncodedChunkConstructor
  VideoFrame?: NativeVideoFrameConstructor
  OffscreenCanvas?: NativeCanvasConstructor
}

function videoCodecString(codec: VideoCodec): string {
  if (codec === 'h264') return 'avc1.640028'
  if (codec === 'h265') return 'hvc1.1.6.L93.B0'
  if (codec === 'vp8') return 'vp8'
  if (codec === 'vp9') return 'vp09.00.10.08'
  if (codec === 'av1') return 'av01.0.08M.08'
  throw new TypeError(`Native video decoding is not configured for ${codec}`)
}

function audioCodecString(codec: AudioCodec): string {
  if (codec === 'aac') return 'mp4a.40.2'
  if (codec === 'opus') return 'opus'
  if (codec === 'mp3') return 'mp3'
  if (codec === 'flac') return 'flac'
  throw new TypeError(`Native audio decoding is not configured for ${codec}`)
}

function encodedVideoCodec(codec: NativeVideoCodec): string {
  if (codec === 'h264') return 'avc1.640028'
  if (codec === 'vp9') return 'vp09.00.10.08'
  return 'av01.0.08M.08'
}

function encodedAudioCodec(codec: NativeVideoAudioCodec): string {
  return codec === 'aac' ? 'mp4a.40.2' : 'opus'
}

function descriptionBytes(value?: ArrayBuffer | ArrayBufferView): Uint8Array | undefined {
  if (!value) return undefined
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
}

function asPacket(chunk: NativeEncodedChunk, trackId?: number): EncodedPacket {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)
  return {
    data,
    timestamp: chunk.timestamp / 1_000_000,
    duration: chunk.duration === undefined || chunk.duration === null ? undefined : chunk.duration / 1_000_000,
    isKeyframe: chunk.type !== 'delta',
    trackId,
  }
}

function decoderVideoConfig(track: VideoTrack): Record<string, unknown> {
  return {
    codec: videoCodecString(track.codec),
    codedWidth: track.width,
    codedHeight: track.height,
    description: track.codecDescription,
  }
}

function decoderAudioConfig(track: AudioTrack): Record<string, unknown> {
  return {
    codec: audioCodecString(track.codec),
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    description: track.codecDescription,
  }
}

/**
 * Decode, scale, and encode the primary video and audio tracks through native
 * WebCodecs while streaming encoded packets into the selected ts-videos muxer.
 */
export async function transcodeVideoWithWebCodecs(
  input: Input,
  output: Output,
  options: NativeVideoTranscodeOptions,
): Promise<NativeVideoTranscodeResult> {
  const globals = globalThis as unknown as NativeGlobals
  if (!globals.VideoDecoder || !globals.VideoEncoder || !globals.EncodedVideoChunk) {
    throw new Error('Native WebCodecs VideoDecoder and VideoEncoder are required')
  }
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) throw new Error('No video track found in input')
  const audioTrack = await input.getPrimaryAudioTrack()
  const transcodeAudio = Boolean(audioTrack && options.audioCodec && audioTrack.codec !== options.audioCodec)
  if (transcodeAudio && (!globals.AudioDecoder || !globals.AudioEncoder || !globals.EncodedAudioChunk)) {
    throw new Error('Native WebCodecs AudioDecoder and AudioEncoder are required for audio conversion')
  }
  if (audioTrack && !options.audioCodec) {
    throw new TypeError('An audio codec is required when the source contains audio')
  }
  if (!Number.isInteger(options.width) || options.width < 2 || !Number.isInteger(options.height) || options.height < 2) {
    throw new TypeError('Native video dimensions must be integers of at least 2 pixels')
  }
  if (options.width > videoTrack.width || options.height > videoTrack.height) {
    throw new TypeError('Native video transcoding does not upscale the source')
  }

  const resize = options.width !== videoTrack.width || options.height !== videoTrack.height
  if (resize && (!globals.OffscreenCanvas || !globals.VideoFrame)) {
    throw new Error('Native OffscreenCanvas and VideoFrame are required for video scaling')
  }
  const canvas = resize ? new globals.OffscreenCanvas!(options.width, options.height) : undefined
  const canvasContext = canvas?.getContext('2d', { alpha: false })
  if (resize && !canvasContext) throw new Error('A native 2D canvas context is required for video scaling')

  const frameRate = options.frameRate ?? videoTrack.frameRate ?? 30
  const videoDecoderConfig = decoderVideoConfig(videoTrack)
  const videoEncoderConfig: Record<string, unknown> = {
    codec: encodedVideoCodec(options.videoCodec),
    width: options.width,
    height: options.height,
    bitrate: options.videoBitrate,
    framerate: frameRate,
    latencyMode: 'quality',
  }
  const supportChecks: Array<Promise<{ supported?: boolean }>> = [
    globals.VideoDecoder.isConfigSupported(videoDecoderConfig),
    globals.VideoEncoder.isConfigSupported(videoEncoderConfig),
  ]
  let audioDecoderConfig: Record<string, unknown> | undefined
  let audioEncoderConfig: Record<string, unknown> | undefined
  if (audioTrack && transcodeAudio) {
    audioDecoderConfig = decoderAudioConfig(audioTrack)
    audioEncoderConfig = {
      codec: encodedAudioCodec(options.audioCodec!),
      sampleRate: audioTrack.sampleRate,
      numberOfChannels: audioTrack.channels,
      bitrate: options.audioBitrate ?? audioTrack.bitrate ?? (options.audioCodec === 'opus' ? 128_000 : 192_000),
    }
    supportChecks.push(globals.AudioDecoder!.isConfigSupported(audioDecoderConfig))
    supportChecks.push(globals.AudioEncoder!.isConfigSupported(audioEncoderConfig))
  }
  const support = await Promise.all(supportChecks)
  if (!support[0].supported) throw new Error(`Native ${videoTrack.codec} video decoding is unavailable`)
  if (!support[1].supported) throw new Error(`Native ${options.videoCodec} video encoding is unavailable`)
  if (transcodeAudio && !support[2].supported) throw new Error(`Native ${audioTrack!.codec} audio decoding is unavailable`)
  if (transcodeAudio && !support[3].supported) throw new Error(`Native ${options.audioCodec} audio encoding is unavailable`)

  output.setMetadata(await input.getMetadata())
  let fatalError: Error | undefined
  let videoDescription: Uint8Array | undefined
  const audioDescription: { value?: Uint8Array } = {
    value: transcodeAudio ? undefined : audioTrack?.codecDescription,
  }
  let videoReady = false
  let audioReady = !audioTrack || !transcodeAudio
  let outputVideoTrackId: number | undefined
  let outputAudioTrackId: number | undefined
  let videoPackets = 0
  let audioPackets = 0
  let inputBytes = 0
  let outputBytes = 0
  let frameIndex = 0
  let writes = Promise.resolve()
  const pending: PendingPacket[] = []

  const enqueue = (kind: PendingPacket['kind'], packet: EncodedPacket): void => {
    const trackId = kind === 'video' ? outputVideoTrackId : outputAudioTrackId
    if (trackId === undefined) {
      pending.push({ kind, packet })
      return
    }
    writes = writes.then(() => output.writePacket(trackId, { ...packet, trackId }))
  }
  const initializeOutput = (): void => {
    if (outputVideoTrackId !== undefined || !videoReady || !audioReady) return
    outputVideoTrackId = output.addVideoTrack({
      codec: options.videoCodec,
      width: options.width,
      height: options.height,
      frameRate,
      bitrate: options.videoBitrate,
      codecDescription: videoDescription,
      colorSpace: videoTrack.colorSpace,
      rotation: videoTrack.rotation,
    }).id
    if (audioTrack && options.audioCodec) {
      outputAudioTrackId = output.addAudioTrack({
        codec: options.audioCodec,
        sampleRate: audioTrack.sampleRate,
        channels: audioTrack.channels,
        bitrate: options.audioBitrate ?? audioTrack.bitrate,
        codecDescription: audioDescription.value,
      }).id
    }
    pending.sort((a, b) => a.packet.timestamp - b.packet.timestamp)
    for (const item of pending.splice(0)) enqueue(item.kind, item.packet)
  }

  const videoEncoder = new globals.VideoEncoder({
    output: (chunk, metadata) => {
      videoDescription ??= descriptionBytes(metadata?.decoderConfig?.description)
      videoReady = true
      const packet = asPacket(chunk)
      videoPackets++
      outputBytes += packet.data.byteLength
      enqueue('video', packet)
      initializeOutput()
    },
    error: error => { fatalError = error },
  })
  const videoDecoder = new globals.VideoDecoder({
    output: (frame) => {
      let encodedFrame = frame
      try {
        if (resize) {
          canvasContext!.drawImage(frame, 0, 0, options.width, options.height)
          encodedFrame = new globals.VideoFrame!(canvas, {
            timestamp: frame.timestamp,
            duration: frame.duration === undefined || frame.duration === null ? undefined : frame.duration,
          })
        }
        videoEncoder.encode(encodedFrame, {
          keyFrame: frameIndex % Math.max(1, Math.floor(options.keyframeInterval ?? frameRate * 4)) === 0,
        })
        frameIndex++
      }
      finally {
        if (encodedFrame !== frame) encodedFrame.close()
        frame.close()
      }
    },
    error: error => { fatalError = error },
  })

  const audioEncoder = transcodeAudio
    ? new globals.AudioEncoder!({
        output: (chunk, metadata) => {
          audioDescription.value ??= descriptionBytes(metadata?.decoderConfig?.description)
          audioReady = true
          const packet = asPacket(chunk)
          audioPackets++
          outputBytes += packet.data.byteLength
          enqueue('audio', packet)
          initializeOutput()
        },
        error: error => { fatalError = error },
      })
    : undefined
  const audioDecoder = transcodeAudio
    ? new globals.AudioDecoder!({
        output: (data) => {
          try {
            audioEncoder!.encode(data)
          }
          finally {
            data.close()
          }
        },
        error: error => { fatalError = error },
      })
    : undefined
  const batchSize = Math.max(1, Math.min(256, Math.floor(options.batchSize ?? 32)))

  const flush = async (): Promise<void> => {
    await videoDecoder.flush()
    await audioDecoder?.flush()
    await videoEncoder.flush()
    await audioEncoder?.flush()
    initializeOutput()
    await writes
    if (fatalError) throw fatalError
  }

  try {
    videoDecoder.configure(videoDecoderConfig)
    videoEncoder.configure(videoEncoderConfig)
    if (transcodeAudio) {
      audioDecoder!.configure(audioDecoderConfig!)
      audioEncoder!.configure(audioEncoderConfig!)
    }
    let queued = 0
    for await (const { trackId, packet } of input.allPackets()) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Video transcode aborted')
      if (trackId === videoTrack.id) {
        inputBytes += packet.data.byteLength
        videoDecoder.decode(new globals.EncodedVideoChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp: Math.round(packet.timestamp * 1_000_000),
          duration: packet.duration === undefined ? undefined : Math.round(packet.duration * 1_000_000),
          data: packet.data,
        }))
      }
      else if (audioTrack && trackId === audioTrack.id) {
        inputBytes += packet.data.byteLength
        if (transcodeAudio) {
          audioDecoder!.decode(new globals.EncodedAudioChunk!({
            type: 'key',
            timestamp: Math.round(packet.timestamp * 1_000_000),
            duration: packet.duration === undefined ? undefined : Math.round(packet.duration * 1_000_000),
            data: packet.data,
          }))
        }
        else {
          audioPackets++
          outputBytes += packet.data.byteLength
          enqueue('audio', packet)
        }
      }
      else {
        continue
      }
      queued++
      if (queued >= batchSize) {
        await flush()
        queued = 0
      }
    }
    await flush()
    if (!videoReady || videoPackets === 0 || outputVideoTrackId === undefined) {
      throw new Error('Native video encoder produced no packets')
    }
    if (transcodeAudio && (!audioReady || audioPackets === 0 || outputAudioTrackId === undefined)) {
      throw new Error('Native audio encoder produced no packets')
    }
    const bytes = await output.finalize()
    return {
      bytes,
      videoCodec: options.videoCodec,
      audioCodec: options.audioCodec,
      videoPackets,
      audioPackets,
      inputBytes,
      outputBytes,
    }
  }
  finally {
    videoDecoder.close()
    videoEncoder.close()
    audioDecoder?.close()
    audioEncoder?.close()
    await input.close()
  }
}

function defaultInput(source: string | Uint8Array | ArrayBuffer, formats?: InputFormat[]): Input {
  return new MediaInput({
    source: createSource(source),
    formats: formats ?? FormatRegistry.getInputFormats(),
  })
}

async function ensureDefaultFormats(inputs: boolean, outputs: boolean): Promise<void> {
  const [mp4, webm] = await Promise.all([
    import('@ts-videos/mp4'),
    import('@ts-videos/webm'),
  ])
  if (inputs) {
    const names = new Set(FormatRegistry.getInputFormats().map(format => format.name))
    for (const format of [new mp4.Mp4InputFormat(), new mp4.MovInputFormat(), new webm.WebmInputFormat(), new webm.MkvInputFormat()]) {
      if (!names.has(format.name)) registerFormat(format)
    }
  }
  if (outputs) {
    const names = new Set(FormatRegistry.getOutputFormats().map(format => format.name))
    for (const format of [new mp4.Mp4OutputFormat(), new webm.WebmOutputFormat()]) {
      if (!names.has(format.name)) registerFormat(format)
    }
  }
}

function defaultOutput(planned: PlannedVideoOutput): Output {
  const format = FormatRegistry.getOutputFormatByExtension(planned.container)
  if (!format) throw new Error(`No ${planned.container} output format is registered`)
  return new MediaOutput(format)
}

/** Execute every container and rendition in a delivery plan from one source. */
export async function generateVideoDerivatives(
  source: string | Uint8Array | ArrayBuffer | Source,
  plan: VideoDeliveryPlan,
  options: VideoDerivativeOptions = {},
): Promise<VideoDerivative[]> {
  assertVideoPlanExecutable(plan)
  if (!options.inputFactory || !options.outputFactory) {
    await ensureDefaultFormats(!options.inputFactory, !options.outputFactory)
  }
  if (!options.inputFactory && typeof source === 'object' && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) {
    throw new TypeError('Video derivatives from a custom source require an inputFactory')
  }
  const derivatives: VideoDerivative[] = []
  for (const planned of plan.outputs) {
    for (const rendition of plan.renditions) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Video derivative generation aborted')
      const input = options.inputFactory?.() ?? defaultInput(source as string | Uint8Array | ArrayBuffer, options.inputFormats)
      const output = options.outputFactory?.(planned, rendition) ?? defaultOutput(planned)
      const isSourceSize = rendition.width === plan.source.width && rendition.height === plan.source.height
      if (planned.action === 'copy' && isSourceSize) {
        const conversion = await Conversion.init({ input, output })
        try {
          derivatives.push({ output: planned, rendition, bytes: await conversion.execute() })
        }
        finally {
          await conversion.close()
        }
        continue
      }
      const result = await transcodeVideoWithWebCodecs(input, output, {
        videoCodec: planned.videoCodec as NativeVideoCodec,
        audioCodec: planned.audioCodec as NativeVideoAudioCodec | undefined,
        width: rendition.width,
        height: rendition.height,
        videoBitrate: rendition.videoBitrate,
        audioBitrate: rendition.audioBitrate || undefined,
        frameRate: rendition.frameRate,
        keyframeInterval: plan.keyframeInterval,
        batchSize: options.batchSize,
        signal: options.signal,
      })
      derivatives.push({ output: planned, rendition, bytes: result.bytes })
    }
  }
  return derivatives
}
