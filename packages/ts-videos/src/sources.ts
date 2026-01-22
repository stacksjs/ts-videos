/**
 * Media sources for providing data to output tracks
 * Similar to mediabunny's source system
 */

import type { VideoSample, AudioSample, SubtitleCue, EncodedPacket } from './types'

/**
 * Base source interface
 */
export interface MediaSource<T> {
  /**
   * Iterate over all items
   */
  items(): AsyncGenerator<T>

  /**
   * Close and release resources
   */
  close(): void
}

/**
 * VideoSampleSource - Provide video samples for encoding
 */
export class VideoSampleSource implements MediaSource<VideoSample> {
  private samples: VideoSample[] = []
  private generator: AsyncGenerator<VideoSample> | null = null

  constructor(source?: AsyncIterable<VideoSample> | VideoSample[]) {
    if (Array.isArray(source)) {
      this.samples = source
    } else if (source) {
      this.generator = source[Symbol.asyncIterator]() as AsyncGenerator<VideoSample>
    }
  }

  addSample(sample: VideoSample): void {
    this.samples.push(sample)
  }

  async *items(): AsyncGenerator<VideoSample> {
    if (this.generator) {
      yield* this.generator
    } else {
      for (const sample of this.samples) {
        yield sample
      }
    }
  }

  close(): void {
    for (const sample of this.samples) {
      if (sample.data instanceof VideoFrame) {
        sample.data.close()
      }
    }
    this.samples = []
  }
}

/**
 * AudioSampleSource - Provide audio samples for encoding
 */
export class AudioSampleSource implements MediaSource<AudioSample> {
  private samples: AudioSample[] = []
  private generator: AsyncGenerator<AudioSample> | null = null

  constructor(source?: AsyncIterable<AudioSample> | AudioSample[]) {
    if (Array.isArray(source)) {
      this.samples = source
    } else if (source) {
      this.generator = source[Symbol.asyncIterator]() as AsyncGenerator<AudioSample>
    }
  }

  addSample(sample: AudioSample): void {
    this.samples.push(sample)
  }

  async *items(): AsyncGenerator<AudioSample> {
    if (this.generator) {
      yield* this.generator
    } else {
      for (const sample of this.samples) {
        yield sample
      }
    }
  }

  close(): void {
    for (const sample of this.samples) {
      if (sample.data instanceof AudioData) {
        sample.data.close()
      }
    }
    this.samples = []
  }
}

/**
 * EncodedVideoPacketSource - Provide pre-encoded video packets (bypass encoding)
 */
export class EncodedVideoPacketSource implements MediaSource<EncodedPacket> {
  private packets: EncodedPacket[] = []
  private generator: AsyncGenerator<EncodedPacket> | null = null

  constructor(source?: AsyncIterable<EncodedPacket> | EncodedPacket[]) {
    if (Array.isArray(source)) {
      this.packets = source
    } else if (source) {
      this.generator = source[Symbol.asyncIterator]() as AsyncGenerator<EncodedPacket>
    }
  }

  addPacket(packet: EncodedPacket): void {
    this.packets.push(packet)
  }

  async *items(): AsyncGenerator<EncodedPacket> {
    if (this.generator) {
      yield* this.generator
    } else {
      for (const packet of this.packets) {
        yield packet
      }
    }
  }

  close(): void {
    this.packets = []
  }
}

/**
 * EncodedAudioPacketSource - Provide pre-encoded audio packets (bypass encoding)
 */
export class EncodedAudioPacketSource implements MediaSource<EncodedPacket> {
  private packets: EncodedPacket[] = []
  private generator: AsyncGenerator<EncodedPacket> | null = null

  constructor(source?: AsyncIterable<EncodedPacket> | EncodedPacket[]) {
    if (Array.isArray(source)) {
      this.packets = source
    } else if (source) {
      this.generator = source[Symbol.asyncIterator]() as AsyncGenerator<EncodedPacket>
    }
  }

  addPacket(packet: EncodedPacket): void {
    this.packets.push(packet)
  }

  async *items(): AsyncGenerator<EncodedPacket> {
    if (this.generator) {
      yield* this.generator
    } else {
      for (const packet of this.packets) {
        yield packet
      }
    }
  }

  close(): void {
    this.packets = []
  }
}

/**
 * CanvasSource - Capture frames from a canvas element
 */
export class CanvasSource implements MediaSource<VideoSample> {
  private canvas: OffscreenCanvas | HTMLCanvasElement
  private frameRate: number
  private duration: number
  private frameCount: number

  constructor(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    options: { frameRate?: number, duration?: number, frameCount?: number } = {},
  ) {
    this.canvas = canvas
    this.frameRate = options.frameRate ?? 30
    this.duration = options.duration ?? 0
    this.frameCount = options.frameCount ?? (this.duration * this.frameRate)
  }

  async *items(): AsyncGenerator<VideoSample> {
    const frameDuration = 1 / this.frameRate

    for (let i = 0; i < this.frameCount; i++) {
      const timestamp = i * frameDuration

      // Create VideoFrame from canvas
      const frame = new VideoFrame(this.canvas, {
        timestamp: timestamp * 1_000_000, // microseconds
        duration: frameDuration * 1_000_000,
      })

      yield {
        data: frame,
        timestamp,
        duration: frameDuration,
        isKeyframe: i % 30 === 0, // Every 30 frames is a keyframe
      }
    }
  }

  close(): void {}
}

/**
 * MediaStreamVideoTrackSource - Capture from MediaStream (webcam, screen, etc.)
 */
export class MediaStreamVideoTrackSource implements MediaSource<VideoSample> {
  private track: MediaStreamTrack
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private stopped = false

  constructor(track: MediaStreamTrack) {
    if (track.kind !== 'video') {
      throw new Error('Track must be a video track')
    }
    this.track = track
  }

  async *items(): AsyncGenerator<VideoSample> {
    // @ts-ignore - MediaStreamTrackProcessor is experimental
    if (typeof MediaStreamTrackProcessor === 'undefined') {
      throw new Error('MediaStreamTrackProcessor not available')
    }

    // @ts-ignore
    const processor = new MediaStreamTrackProcessor({ track: this.track })
    this.reader = processor.readable.getReader()

    try {
      while (!this.stopped) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value) {
          yield {
            data: value,
            timestamp: value.timestamp / 1_000_000,
            duration: value.duration ? value.duration / 1_000_000 : undefined,
          }
        }
      }
    } finally {
      this.reader.releaseLock()
    }
  }

  close(): void {
    this.stopped = true
    this.track.stop()
  }
}

/**
 * MediaStreamAudioTrackSource - Capture from MediaStream (microphone, etc.)
 */
export class MediaStreamAudioTrackSource implements MediaSource<AudioSample> {
  private track: MediaStreamTrack
  private reader: ReadableStreamDefaultReader<AudioData> | null = null
  private stopped = false

  constructor(track: MediaStreamTrack) {
    if (track.kind !== 'audio') {
      throw new Error('Track must be an audio track')
    }
    this.track = track
  }

  async *items(): AsyncGenerator<AudioSample> {
    // @ts-ignore - MediaStreamTrackProcessor is experimental
    if (typeof MediaStreamTrackProcessor === 'undefined') {
      throw new Error('MediaStreamTrackProcessor not available')
    }

    // @ts-ignore
    const processor = new MediaStreamTrackProcessor({ track: this.track })
    this.reader = processor.readable.getReader()

    try {
      while (!this.stopped) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value) {
          // Convert AudioData to Float32Array
          const channels = value.numberOfChannels
          const frames = value.numberOfFrames
          const buffer = new Float32Array(channels * frames)

          for (let ch = 0; ch < channels; ch++) {
            const channelData = new Float32Array(frames)
            value.copyTo(channelData, { planeIndex: ch, format: 'f32-planar' })
            for (let i = 0; i < frames; i++) {
              buffer[i * channels + ch] = channelData[i]
            }
          }

          yield {
            data: buffer,
            timestamp: value.timestamp / 1_000_000,
            duration: value.duration ? value.duration / 1_000_000 : undefined,
            sampleRate: value.sampleRate,
            channels,
          }

          value.close()
        }
      }
    } finally {
      this.reader?.releaseLock()
    }
  }

  close(): void {
    this.stopped = true
    this.track.stop()
  }
}

/**
 * AudioBufferSource - Provide audio from Web Audio API AudioBuffer
 */
export class AudioBufferSource implements MediaSource<AudioSample> {
  private buffer: AudioBuffer
  private chunkSize: number

  constructor(buffer: AudioBuffer, chunkSize = 4096) {
    this.buffer = buffer
    this.chunkSize = chunkSize
  }

  async *items(): AsyncGenerator<AudioSample> {
    const channels = this.buffer.numberOfChannels
    const sampleRate = this.buffer.sampleRate
    const totalFrames = this.buffer.length

    let offset = 0
    while (offset < totalFrames) {
      const frames = Math.min(this.chunkSize, totalFrames - offset)
      const data = new Float32Array(channels * frames)

      for (let ch = 0; ch < channels; ch++) {
        const channelData = this.buffer.getChannelData(ch)
        for (let i = 0; i < frames; i++) {
          data[i * channels + ch] = channelData[offset + i]
        }
      }

      yield {
        data,
        timestamp: offset / sampleRate,
        duration: frames / sampleRate,
        sampleRate,
        channels,
      }

      offset += frames
    }
  }

  close(): void {}
}

/**
 * TextSubtitleSource - Provide subtitle cues
 */
export class TextSubtitleSource implements MediaSource<SubtitleCue> {
  private cues: SubtitleCue[] = []

  constructor(cues?: SubtitleCue[]) {
    if (cues) this.cues = cues
  }

  addCue(cue: SubtitleCue): void {
    this.cues.push(cue)
    // Keep sorted by start time
    this.cues.sort((a, b) => a.startTime - b.startTime)
  }

  parseSRT(content: string): void {
    const blocks = content.trim().split(/\n\n+/)

    for (const block of blocks) {
      const lines = block.split('\n')
      if (lines.length < 3) continue

      const timeLine = lines[1]
      const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/)
      if (!timeMatch) continue

      const startTime = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 +
                       Number(timeMatch[3]) + Number(timeMatch[4]) / 1000
      const endTime = Number(timeMatch[5]) * 3600 + Number(timeMatch[6]) * 60 +
                     Number(timeMatch[7]) + Number(timeMatch[8]) / 1000

      const text = lines.slice(2).join('\n')

      this.cues.push({
        id: lines[0],
        startTime,
        endTime,
        text,
      })
    }
  }

  parseVTT(content: string): void {
    const lines = content.split('\n')
    let i = 0

    // Skip WebVTT header
    while (i < lines.length && !lines[i].includes('-->')) {
      i++
    }

    while (i < lines.length) {
      const line = lines[i].trim()

      if (line.includes('-->')) {
        const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})(.*)/)
        if (timeMatch) {
          const startTime = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 +
                           Number(timeMatch[3]) + Number(timeMatch[4]) / 1000
          const endTime = Number(timeMatch[5]) * 3600 + Number(timeMatch[6]) * 60 +
                         Number(timeMatch[7]) + Number(timeMatch[8]) / 1000
          const settings = timeMatch[9]?.trim()

          // Collect text lines
          const textLines: string[] = []
          i++
          while (i < lines.length && lines[i].trim() !== '') {
            textLines.push(lines[i])
            i++
          }

          this.cues.push({
            startTime,
            endTime,
            text: textLines.join('\n'),
            settings,
          })
        }
      }
      i++
    }
  }

  async *items(): AsyncGenerator<SubtitleCue> {
    for (const cue of this.cues) {
      yield cue
    }
  }

  toVTT(): string {
    const lines = ['WEBVTT', '']

    for (const cue of this.cues) {
      if (cue.id) lines.push(cue.id)

      const startTime = this.formatVTTTime(cue.startTime)
      const endTime = this.formatVTTTime(cue.endTime)
      const settings = cue.settings ? ` ${cue.settings}` : ''

      lines.push(`${startTime} --> ${endTime}${settings}`)
      lines.push(cue.text)
      lines.push('')
    }

    return lines.join('\n')
  }

  toSRT(): string {
    const lines: string[] = []

    this.cues.forEach((cue, index) => {
      lines.push(String(index + 1))

      const startTime = this.formatSRTTime(cue.startTime)
      const endTime = this.formatSRTTime(cue.endTime)

      lines.push(`${startTime} --> ${endTime}`)
      lines.push(cue.text)
      lines.push('')
    })

    return lines.join('\n')
  }

  private formatVTTTime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
  }

  private formatSRTTime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
  }

  close(): void {
    this.cues = []
  }
}
