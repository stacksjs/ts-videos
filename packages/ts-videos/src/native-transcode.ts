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
  /** How many packets a codec may hold before the transcoder waits for it. */
  batchSize?: number
  signal?: AbortSignal
  /**
   * What becomes of a rotation flag (a phone held upright). `keep`, the
   * default, encodes the stored frame and carries the flag onto the output.
   * `bake` draws every frame the way it is shown: `width` and `height` are
   * then the upright size, and the output needs no flag to play the right
   * way up.
   */
  orientation?: 'keep' | 'bake'
  /** Drop frames so the output has at most this many a second (a 60 fps phone clip at 30). */
  maxFrameRate?: number
  /** Also answer a JPEG of one output frame: `at` seconds in (default a tenth of the clip, at most 1 s). */
  poster?: boolean | { at?: number, quality?: number }
  /** How far the encoder has got through the clip. */
  onProgress?: (_progress: NativeVideoTranscodeProgress) => void
}

export interface NativeVideoTranscodeProgress {
  /** 0 to 1. */
  ratio: number
  seconds: number
  duration: number
}

export interface NativeVideoTranscodeResult {
  bytes: Uint8Array
  videoCodec: NativeVideoCodec
  audioCodec?: NativeVideoAudioCodec
  videoPackets: number
  audioPackets: number
  inputBytes: number
  outputBytes: number
  /** The output frame, as encoded. */
  width: number
  height: number
  frameRate: number
  /** Seconds. */
  duration: number
  /** The JPEG asked for with `poster`. */
  poster?: Blob
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
  decodeQueueSize?: number
  configure: (_config: Record<string, unknown>) => void
  decode: (_chunk: unknown) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeVideoEncoderInstance {
  encodeQueueSize?: number
  configure: (_config: Record<string, unknown>) => void
  encode: (_frame: NativeVideoFrame, _options?: { keyFrame?: boolean }) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeAudioEncoderInstance {
  encodeQueueSize?: number
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
  setTransform?: (_a: number, _b: number, _c: number, _d: number, _e: number, _f: number) => void
  translate?: (_x: number, _y: number) => void
  rotate?: (_angle: number) => void
}

interface NativeCanvas {
  getContext: (_kind: '2d', _options?: { alpha?: boolean }) => NativeCanvasContext | null
  convertToBlob?: (_options?: { type?: string, quality?: number }) => Promise<Blob>
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

function decoderAudioConfig(track: AudioTrack): Record<string, unknown> {
  return {
    codec: audioCodecString(track.codec),
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    description: track.codecDescription,
  }
}

/** Whether a track's colour is HDR (PQ or HLG), which an 8-bit H.264 output cannot carry. */
function isHdr(track: VideoTrack): boolean {
  const transfer = track.colorSpace?.transfer
  return transfer === 'smpte2084' || transfer === 'arib-std-b67'
}

const hex = (value: number, width = 2): string => value.toString(16).padStart(width, '0')

/**
 * The codec string a decoder is configured with, read from the track's own
 * avcC or hvcC record where there is one. A fixed string names one profile and
 * level, so an iPhone's HEVC Main 10 clip, or H.264 above level 4.0, was
 * refused by `isConfigSupported` although the browser decodes it.
 */
export function videoDecoderCodec(track: Pick<VideoTrack, 'codec' | 'codecDescription'>): string {
  const record = track.codecDescription
  if (track.codec === 'h264' && record && record.byteLength >= 4 && record[0] === 1) {
    return `avc1.${hex(record[1])}${hex(record[2])}${hex(record[3])}`
  }
  if (track.codec === 'h265' && record && record.byteLength >= 13 && record[0] === 1) {
    const space = ['', 'A', 'B', 'C'][record[1] >> 6]
    const tier = (record[1] & 0x20) ? 'H' : 'L'
    const profile = record[1] & 0x1F
    // The compatibility flags are written bit-reversed, without leading zeros.
    let flags = ((record[2] << 24) | (record[3] << 16) | (record[4] << 8) | record[5]) >>> 0
    let reversed = 0
    for (let bit = 0; bit < 32; bit++) {
      reversed = ((reversed << 1) | (flags & 1)) >>> 0
      flags >>>= 1
    }
    const constraints = Array.from(record.subarray(6, 12))
    while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop()
    const tail = constraints.map(byte => `.${byte.toString(16).toUpperCase()}`).join('')
    return `hvc1.${space}${profile}.${reversed.toString(16).toUpperCase()}.${tier}${record[12]}${tail}`
  }
  return videoCodecString(track.codec)
}

/**
 * The frame a track shows: its stored size turned by its rotation flag. A
 * phone held upright stores 1920x1080 with a quarter turn, and shows 1080x1920.
 */
export function videoDisplaySize(track: Pick<VideoTrack, 'width' | 'height' | 'rotation'>): { width: number, height: number } {
  const quarter = track.rotation === 90 || track.rotation === 270
  return quarter ? { width: track.height, height: track.width } : { width: track.width, height: track.height }
}

/**
 * The largest even-sized frame of the same shape that fits a box given by its
 * long and short edge, whichever way up the source is. Never larger than the
 * source: 1920x1080 in a 1280x720 box is 1280x720, 1080x1920 is 720x1280, and
 * 640x360 stays as it is.
 */
export function fitVideoSize(source: { width: number, height: number }, box: { long: number, short: number }): { width: number, height: number } {
  const long = Math.max(source.width, source.height)
  const short = Math.min(source.width, source.height)
  if (!(long > 0) || !(short > 0)) throw new TypeError('A video size needs a width and a height')
  const scale = Math.min(1, box.long / long, box.short / short)
  const even = (value: number): number => Math.max(2, Math.floor(value * scale / 2 + 1e-6) * 2)
  return { width: even(source.width), height: even(source.height) }
}

const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Decode, scale, and encode the primary video and audio tracks through native
 * WebCodecs while streaming encoded packets into the selected ts-videos muxer.
 *
 * The codecs are fed as fast as they take packets and no faster: the loop
 * waits while a decoder or encoder queue is full. It used to flush both every
 * few packets instead, and a flushed decoder accepts only a key frame next, so
 * any clip longer than one batch failed on its first delta frame.
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
  const rotation = videoTrack.rotation ?? 0
  const bake = options.orientation === 'bake' && rotation !== 0
  const quarter = rotation === 90 || rotation === 270
  // Baked, the output is the frame as it is shown; kept, it is the frame as it is stored.
  const source = bake ? videoDisplaySize(videoTrack) : { width: videoTrack.width, height: videoTrack.height }
  if (options.width > source.width || options.height > source.height) {
    throw new TypeError('Native video transcoding does not upscale the source')
  }

  const resize = options.width !== source.width || options.height !== source.height
  const wantsPoster = Boolean(options.poster)
  const canDraw = Boolean(globals.OffscreenCanvas && globals.VideoFrame)
  if ((resize || bake || wantsPoster) && !canDraw) {
    throw new Error('Native OffscreenCanvas and VideoFrame are required for video scaling')
  }
  // An HDR frame handed straight to an 8-bit encoder comes out washed out; drawn, the browser tone-maps it.
  const draw = resize || bake || wantsPoster || (canDraw && isHdr(videoTrack))
  const canvas = draw ? new globals.OffscreenCanvas!(options.width, options.height) : undefined
  const canvasContext = canvas?.getContext('2d', { alpha: false })
  if (draw && !canvasContext) throw new Error('A native 2D canvas context is required for video scaling')

  const sourceFrameRate = videoTrack.frameRate ?? options.frameRate ?? 30
  const capped = options.maxFrameRate !== undefined && sourceFrameRate > options.maxFrameRate * 1.05
  const frameRate = options.frameRate ?? (capped ? options.maxFrameRate! : sourceFrameRate)
  // Microseconds a kept frame must follow the last by; a millisecond of slack for timestamps that wobble.
  const minimumGap = capped ? 1_000_000 / options.maxFrameRate! - 1000 : 0
  // Seconds, for progress and the poster's moment; 0 when the container does not say.
  const duration = typeof (input as Partial<Input>).getDuration === 'function' ? await input.getDuration().catch(() => 0) : 0
  const videoDecoderConfig: Record<string, unknown> = {
    codec: videoDecoderCodec(videoTrack),
    codedWidth: videoTrack.width,
    codedHeight: videoTrack.height,
    description: videoTrack.codecDescription,
  }
  const videoEncoderConfig: Record<string, unknown> = {
    codec: encodedVideoCodec(options.videoCodec),
    width: options.width,
    height: options.height,
    bitrate: options.videoBitrate,
    framerate: frameRate,
    latencyMode: 'quality',
    // Length-prefixed samples and an avcC record, which is what an MP4 holds.
    ...(options.videoCodec === 'h264' ? { avc: { format: 'avc' } } : {}),
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
  const fail = (error: unknown): void => { fatalError ??= error instanceof Error ? error : new Error(String(error)) }
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
  let firstFrameAt: number | undefined
  let lastKeptAt: number | undefined
  let lastEncodedAt = 0
  let reported = -1
  let heldVideo: EncodedPacket | undefined
  let lastGap: number | undefined
  let poster: Promise<Blob> | undefined
  let writes = Promise.resolve()
  const pending: PendingPacket[] = []
  const posterOptions = typeof options.poster === 'object' ? options.poster : {}
  const posterAt = (posterOptions.at ?? Math.min(1, duration * 0.1)) * 1_000_000
  const takePoster = (): void => {
    poster ??= canvas!.convertToBlob!({ type: 'image/jpeg', quality: posterOptions.quality ?? 0.82 })
    // Read at the end; until then a failure must not count as unhandled.
    poster.catch(() => {})
  }

  const enqueue = (kind: PendingPacket['kind'], packet: EncodedPacket): void => {
    const trackId = kind === 'video' ? outputVideoTrackId : outputAudioTrackId
    if (trackId === undefined) {
      pending.push({ kind, packet })
      return
    }
    writes = writes.then(() => output.writePacket(trackId, { ...packet, trackId })).catch(fail)
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
      // A drawn frame is 8-bit sRGB-range BT.709 whatever the source was.
      colorSpace: draw ? { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' } : videoTrack.colorSpace,
      rotation: bake ? 0 : videoTrack.rotation,
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
  const emitVideo = (packet: EncodedPacket): void => {
    videoPackets++
    outputBytes += packet.data.byteLength
    enqueue('video', packet)
  }
  const report = (seconds: number): void => {
    if (!options.onProgress || !(duration > 0)) return
    const ratio = Math.max(0, Math.min(1, seconds / duration))
    if (ratio - reported < 0.005 && ratio < 1) return
    reported = ratio
    options.onProgress({ ratio, seconds: Math.min(seconds, duration), duration })
  }

  const videoEncoder = new globals.VideoEncoder({
    output: (chunk, metadata) => {
      videoDescription ??= descriptionBytes(metadata?.decoderConfig?.description)
      const packet = asPacket(chunk)
      // A sample's length is the time to the next one. The muxer writes lengths
      // and nothing else, and a frame that had neighbours dropped is longer than
      // its own stated duration, so each packet waits for the one after it.
      if (heldVideo) {
        const gap = packet.timestamp - heldVideo.timestamp
        if (gap > 0) {
          heldVideo.duration = gap
          lastGap = gap
        }
        emitVideo(heldVideo)
      }
      heldVideo = packet
      videoReady = true
      initializeOutput()
      report(packet.timestamp - (firstFrameAt ?? 0) / 1_000_000)
    },
    error: fail,
  })
  const videoDecoder = new globals.VideoDecoder({
    output: (frame) => {
      let encodedFrame = frame
      try {
        if (fatalError) return
        firstFrameAt ??= frame.timestamp
        if (minimumGap && lastKeptAt !== undefined && frame.timestamp - lastKeptAt < minimumGap) return
        lastKeptAt = frame.timestamp
        if (draw) {
          if (bake) {
            // Turned about the middle of the output; a quarter turn draws the stored frame with its edges swapped.
            canvasContext!.setTransform!(1, 0, 0, 1, 0, 0)
            canvasContext!.translate!(options.width / 2, options.height / 2)
            canvasContext!.rotate!(rotation * Math.PI / 180)
            const width = quarter ? options.height : options.width
            const height = quarter ? options.width : options.height
            canvasContext!.drawImage(frame, -width / 2, -height / 2, width, height)
          }
          else {
            canvasContext!.drawImage(frame, 0, 0, options.width, options.height)
          }
          if (wantsPoster && !poster && frame.timestamp - firstFrameAt >= posterAt) takePoster()
          encodedFrame = new globals.VideoFrame!(canvas, {
            timestamp: frame.timestamp,
            duration: frame.duration === undefined || frame.duration === null ? undefined : frame.duration,
          })
        }
        videoEncoder.encode(encodedFrame, {
          keyFrame: frameIndex % Math.max(1, Math.floor(options.keyframeInterval ?? frameRate * 4)) === 0,
        })
        frameIndex++
        lastEncodedAt = frame.timestamp
      }
      catch (error) {
        fail(error)
      }
      finally {
        if (encodedFrame !== frame) encodedFrame.close()
        frame.close()
      }
    },
    error: fail,
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
        error: fail,
      })
    : undefined
  const audioDecoder = transcodeAudio
    ? new globals.AudioDecoder!({
        output: (data) => {
          try {
            if (!fatalError) audioEncoder!.encode(data)
          }
          catch (error) {
            fail(error)
          }
          finally {
            data.close()
          }
        },
        error: fail,
      })
    : undefined
  // How many packets a codec may hold before the loop waits for it: a decoded 4K frame is 12 MB.
  const queueLimit = Math.max(1, Math.min(256, Math.floor(options.batchSize ?? 8)))
  const busy = (): boolean =>
    (videoDecoder.decodeQueueSize ?? 0) > queueLimit
    || (videoEncoder.encodeQueueSize ?? 0) > queueLimit
    || (audioDecoder?.decodeQueueSize ?? 0) > queueLimit * 4
    || (audioEncoder?.encodeQueueSize ?? 0) > queueLimit * 4
  const aborted = (): void => {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Video transcode aborted')
    if (fatalError) throw fatalError
  }

  try {
    videoDecoder.configure(videoDecoderConfig)
    videoEncoder.configure(videoEncoderConfig)
    if (transcodeAudio) {
      audioDecoder!.configure(audioDecoderConfig!)
      audioEncoder!.configure(audioEncoderConfig!)
    }
    let fed = 0
    for await (const { trackId, packet } of input.allPackets()) {
      aborted()
      if (trackId === videoTrack.id) {
        inputBytes += packet.data.byteLength
        videoDecoder.decode(new globals.EncodedVideoChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          // When it is shown, not when it is decoded: with B-frames the two differ, and frames come out by this.
          timestamp: Math.round((packet.timestamp + (packet.compositionTimeOffset ?? 0)) * 1_000_000),
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
      // Codec callbacks run between tasks, so give them one now and then even when nothing is full.
      if (++fed % 16 === 0) await nextTask()
      while (busy()) {
        aborted()
        await nextTask()
      }
    }
    await videoDecoder.flush()
    await audioDecoder?.flush()
    await videoEncoder.flush()
    await audioEncoder?.flush()
    if (heldVideo) {
      // The last frame has no next one to measure to. It is shown as long as the
      // one before it was: its own stated length is the source's, which is half
      // that when every other frame was dropped.
      heldVideo.duration = lastGap ?? (heldVideo.duration && heldVideo.duration > 0 ? heldVideo.duration : 1 / frameRate)
      emitVideo(heldVideo)
      heldVideo = undefined
    }
    initializeOutput()
    await writes
    aborted()
    if (!videoReady || videoPackets === 0 || outputVideoTrackId === undefined) {
      throw new Error('Native video encoder produced no packets')
    }
    if (transcodeAudio && (!audioReady || audioPackets === 0 || outputAudioTrackId === undefined)) {
      throw new Error('Native audio encoder produced no packets')
    }
    // A clip shorter than the poster's moment still gets one: its last frame.
    if (wantsPoster && !poster && frameIndex > 0) takePoster()
    const posterBlob = poster ? await poster.catch(() => undefined) : undefined
    const bytes = await output.finalize()
    report(duration)
    return {
      bytes,
      videoCodec: options.videoCodec,
      audioCodec: options.audioCodec,
      videoPackets,
      audioPackets,
      inputBytes,
      outputBytes,
      width: options.width,
      height: options.height,
      frameRate,
      duration: duration > 0 ? duration : (lastEncodedAt - (firstFrameAt ?? 0)) / 1_000_000 + 1 / frameRate,
      poster: posterBlob,
    }
  }
  finally {
    for (const codec of [videoDecoder, videoEncoder, audioDecoder, audioEncoder]) {
      // Already closed after an error of its own.
      try { codec?.close() }
      catch {}
    }
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

export interface UploadVideoOptions {
  /** The box the output fits, by its long and short edge whichever way up the clip is. Default 1280 by 720. */
  maxLongEdge?: number
  maxShortEdge?: number
  /** Default 30. */
  maxFrameRate?: number
  /** Bits a second for the video. Default: by the output's size and frame rate, about 2.5 Mbit/s at 720p30. */
  videoBitrate?: number
  /** Bits a second for sound that has to be re-encoded. Default 128 kbit/s. Sound already AAC is copied. */
  audioBitrate?: number
  /** A JPEG of one frame beside the video. Default true. */
  poster?: boolean | { at?: number, quality?: number }
  signal?: AbortSignal
  onProgress?: (_progress: NativeVideoTranscodeProgress) => void
  inputFormats?: InputFormat[]
}

export interface UploadVideo {
  /** An MP4 (H.264, AAC or silent) with its index at the front, upright, or the file itself when `unchanged`. */
  video: Blob
  /** A JPEG of one frame in the video's own shape; absent when the file was left as it is. */
  poster?: Blob
  /** True when the file already was what this makes, and is returned untouched. */
  unchanged: boolean
  width: number
  height: number
  /** Seconds. */
  duration: number
  frameRate: number
  sourceBytes: number
}

/** Whether this runtime can re-encode video at all: a browser with WebCodecs and a canvas off the page. */
export function canPrepareVideoForUpload(): boolean {
  const globals = globalThis as unknown as NativeGlobals
  return Boolean(globals.VideoDecoder && globals.VideoEncoder && globals.EncodedVideoChunk && globals.VideoFrame && globals.OffscreenCanvas)
}

/** Bits a second that hold an H.264 picture of this size and rate: 2.5 Mbit/s at 1280x720 and 30 fps. */
export function uploadVideoBitrate(width: number, height: number, frameRate: number): number {
  return Math.max(400_000, Math.round(width * height * Math.min(frameRate, 30) * 0.09 / 10_000) * 10_000)
}

/**
 * Makes a picked clip ready to send: an H.264 and AAC MP4 that fits 1280 by
 * 720, at most 30 frames a second, upright without a rotation flag, SDR, with
 * its index at the front so it starts playing before it has arrived, and a
 * JPEG poster of the same shape. A two-minute 4K phone clip of 400 MB comes
 * out near 40 MB.
 *
 * In a browser, on the device, with its own codecs (WebCodecs): nothing is
 * sent anywhere. A clip that is already inside those limits is answered as it
 * is (`unchanged`). It throws when the browser cannot decode the clip or
 * encode H.264; send the original then.
 */
export async function prepareVideoForUpload(file: Blob, options: UploadVideoOptions = {}): Promise<UploadVideo> {
  if (!canPrepareVideoForUpload()) throw new Error('Native WebCodecs VideoDecoder and VideoEncoder are required')
  if (!options.inputFormats) await ensureDefaultFormats(true, false)
  const input = new MediaInput({ source: createSource(file), formats: options.inputFormats ?? FormatRegistry.getInputFormats() })
  let handedOver = false
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track found in input')
    const audio = await input.getPrimaryAudioTrack()
    const shown = videoDisplaySize(track)
    const size = fitVideoSize(shown, { long: options.maxLongEdge ?? 1280, short: options.maxShortEdge ?? 720 })
    const maxFrameRate = options.maxFrameRate ?? 30
    const sourceRate = track.frameRate ?? maxFrameRate
    const frameRate = sourceRate > maxFrameRate * 1.05 ? maxFrameRate : sourceRate
    const videoBitrate = options.videoBitrate ?? uploadVideoBitrate(size.width, size.height, frameRate)
    const duration = await input.getDuration().catch(() => 0)
    const audioBitrate = audio ? options.audioBitrate ?? 128_000 : 0

    // Already an upright SDR H.264 MP4 of this size, rate and weight: encoding it again would only cost quality.
    const format = await input.getFormatName().catch(() => '')
    const fits = size.width === shown.width && size.height === shown.height
    const light = duration > 0 && file.size * 8 / duration <= (videoBitrate + audioBitrate) * 1.25
    if (format === 'mp4' && track.codec === 'h264' && (!audio || audio.codec === 'aac') && !track.rotation && !isHdr(track) && fits && frameRate === sourceRate && light) {
      return { video: file, unchanged: true, width: shown.width, height: shown.height, duration, frameRate, sourceBytes: file.size }
    }

    const mp4 = await import('@ts-videos/mp4')
    const output = new MediaOutput({ format: new mp4.Mp4OutputFormat({ fastStart: true }) })
    handedOver = true
    const result = await transcodeVideoWithWebCodecs(input, output, {
      videoCodec: 'h264',
      audioCodec: audio ? 'aac' : undefined,
      width: size.width,
      height: size.height,
      videoBitrate,
      audioBitrate: audio ? audioBitrate : undefined,
      maxFrameRate,
      // A key frame every two seconds: a demonstration is scrubbed back and forth.
      keyframeInterval: Math.max(1, Math.round(frameRate * 2)),
      orientation: 'bake',
      poster: options.poster ?? true,
      signal: options.signal,
      onProgress: options.onProgress,
    })
    return {
      video: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }),
      poster: result.poster,
      unchanged: false,
      width: result.width,
      height: result.height,
      duration: result.duration,
      frameRate: result.frameRate,
      sourceBytes: file.size,
    }
  }
  finally {
    // The transcoder closes the input it was given; before that point it is still ours.
    if (!handedOver) await input.close()
  }
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
