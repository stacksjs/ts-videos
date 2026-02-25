/**
 * Media sinks for accessing decoded samples from input tracks
 * Similar to mediabunny's sink system
 */

import type { EncodedPacket, VideoSample, AudioSample } from './types'

/**
 * Base sink interface
 */
export interface Sink<T> {
  /**
   * Get item at timestamp
   */
  get(timestamp: number): Promise<T | null>

  /**
   * Iterate over items in range
   */
  items(start?: number, end?: number): AsyncGenerator<T>

  /**
   * Get items at specific timestamps
   */
  itemsAtTimestamps(timestamps: number[]): AsyncGenerator<T>

  /**
   * Close and release resources
   */
  close(): void
}

/**
 * EncodedPacketSink - Access raw encoded packets
 */
export class EncodedPacketSink implements Sink<EncodedPacket> {
  private packets: EncodedPacket[] = []
  private keyframeIndices: number[] = []

  constructor(private source: AsyncIterable<EncodedPacket>) {}

  async init(): Promise<void> {
    let index = 0
    for await (const packet of this.source) {
      if (packet.isKeyframe) {
        this.keyframeIndices.push(index)
      }
      this.packets.push(packet)
      index++
    }
  }

  async get(timestamp: number): Promise<EncodedPacket | null> {
    for (const packet of this.packets) {
      if (packet.timestamp >= timestamp) {
        return packet
      }
    }
    return null
  }

  async getKeyPacket(timestamp: number): Promise<EncodedPacket | null> {
    let lastKeyframe: EncodedPacket | null = null
    for (const packet of this.packets) {
      if (packet.isKeyframe && packet.timestamp <= timestamp) {
        lastKeyframe = packet
      }
      if (packet.timestamp > timestamp) break
    }
    return lastKeyframe
  }

  async getNextPacket(current: EncodedPacket): Promise<EncodedPacket | null> {
    const index = this.packets.indexOf(current)
    if (index >= 0 && index < this.packets.length - 1) {
      return this.packets[index + 1]
    }
    return null
  }

  async *items(start: number = 0, end: number = Infinity): AsyncGenerator<EncodedPacket> {
    for (const packet of this.packets) {
      if (packet.timestamp >= start && packet.timestamp <= end) {
        yield packet
      }
    }
  }

  async *itemsAtTimestamps(timestamps: number[]): AsyncGenerator<EncodedPacket> {
    for (const ts of timestamps) {
      const packet = await this.get(ts)
      if (packet) yield packet
    }
  }

  async *packets_(): AsyncGenerator<EncodedPacket> {
    for (const packet of this.packets) {
      yield packet
    }
  }

  getPacketCount(): number {
    return this.packets.length
  }

  getKeyframeCount(): number {
    return this.keyframeIndices.length
  }

  close(): void {
    this.packets = []
    this.keyframeIndices = []
  }
}

/**
 * VideoSampleSink - Access decoded video frames
 * Requires WebCodecs VideoDecoder
 */
export class VideoSampleSink implements Sink<VideoSample> {
  private decoder: VideoDecoder | null = null
  private samples: Map<number, VideoSample> = new Map()
  private pendingFrames: VideoFrame[] = []
  private codecConfig: VideoDecoderConfig | null = null

  constructor(
    private packetSource: AsyncIterable<EncodedPacket>,
    config?: VideoDecoderConfig,
  ) {
    this.codecConfig = config ?? null
  }

  async init(config?: VideoDecoderConfig): Promise<void> {
    if (config) this.codecConfig = config
    if (!this.codecConfig) {
      throw new Error('VideoDecoderConfig required')
    }

    // Check if VideoDecoder is available
    if (typeof VideoDecoder === 'undefined') {
      throw new Error('WebCodecs VideoDecoder not available')
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.pendingFrames.push(frame)
      },
      error: (e) => {
        console.error('VideoDecoder error:', e)
      },
    })

    this.decoder.configure(this.codecConfig)
  }

  async get(timestamp: number): Promise<VideoSample | null> {
    // Decode frames until we find the one at timestamp
    for await (const packet of this.packetSource) {
      if (!this.decoder) break

      const chunk = new EncodedVideoChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.timestamp * 1_000_000, // to microseconds
        data: packet.data,
      })

      this.decoder.decode(chunk)
      await this.decoder.flush()

      for (const frame of this.pendingFrames) {
        const frameTimestamp = frame.timestamp / 1_000_000 // to seconds
        if (Math.abs(frameTimestamp - timestamp) < 0.001) {
          const sample: VideoSample = {
            data: frame,
            timestamp: frameTimestamp,
            duration: frame.duration ? frame.duration / 1_000_000 : undefined,
          }
          this.pendingFrames = []
          return sample
        }
        frame.close()
      }
      this.pendingFrames = []

      if (packet.timestamp > timestamp + 1) break
    }

    return null
  }

  async *items(start: number = 0, end: number = Infinity): AsyncGenerator<VideoSample> {
    for await (const packet of this.packetSource) {
      if (packet.timestamp < start) continue
      if (packet.timestamp > end) break

      if (!this.decoder) break

      const chunk = new EncodedVideoChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.timestamp * 1_000_000,
        data: packet.data,
      })

      this.decoder.decode(chunk)
      await this.decoder.flush()

      for (const frame of this.pendingFrames) {
        yield {
          data: frame,
          timestamp: frame.timestamp / 1_000_000,
          duration: frame.duration ? frame.duration / 1_000_000 : undefined,
        }
      }
      this.pendingFrames = []
    }
  }

  async *itemsAtTimestamps(timestamps: number[]): AsyncGenerator<VideoSample> {
    for (const ts of timestamps) {
      const sample = await this.get(ts)
      if (sample) yield sample
    }
  }

  close(): void {
    if (this.decoder) {
      this.decoder.close()
      this.decoder = null
    }
    for (const frame of this.pendingFrames) {
      frame.close()
    }
    this.pendingFrames = []
    this.samples.clear()
  }
}

/**
 * AudioSampleSink - Access decoded audio samples
 * Requires WebCodecs AudioDecoder
 */
export class AudioSampleSink implements Sink<AudioSample> {
  private decoder: AudioDecoder | null = null
  private samples: AudioSample[] = []
  private pendingData: AudioData[] = []
  private codecConfig: AudioDecoderConfig | null = null

  constructor(
    private packetSource: AsyncIterable<EncodedPacket>,
    config?: AudioDecoderConfig,
  ) {
    this.codecConfig = config ?? null
  }

  async init(config?: AudioDecoderConfig): Promise<void> {
    if (config) this.codecConfig = config
    if (!this.codecConfig) {
      throw new Error('AudioDecoderConfig required')
    }

    if (typeof AudioDecoder === 'undefined') {
      throw new Error('WebCodecs AudioDecoder not available')
    }

    this.decoder = new AudioDecoder({
      output: (data) => {
        this.pendingData.push(data)
      },
      error: (e) => {
        console.error('AudioDecoder error:', e)
      },
    })

    this.decoder.configure(this.codecConfig)
  }

  async get(timestamp: number): Promise<AudioSample | null> {
    for await (const packet of this.packetSource) {
      if (!this.decoder) break

      const chunk = new EncodedAudioChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.timestamp * 1_000_000,
        data: packet.data,
      })

      this.decoder.decode(chunk)
      await this.decoder.flush()

      for (const data of this.pendingData) {
        const dataTimestamp = data.timestamp / 1_000_000
        if (Math.abs(dataTimestamp - timestamp) < 0.01) {
          const sample = this.audioDataToSample(data)
          this.pendingData = []
          return sample
        }
        data.close()
      }
      this.pendingData = []

      if (packet.timestamp > timestamp + 1) break
    }

    return null
  }

  private audioDataToSample(data: AudioData): AudioSample {
    const channels = data.numberOfChannels
    const frames = data.numberOfFrames
    const buffer = new Float32Array(channels * frames)

    for (let ch = 0; ch < channels; ch++) {
      const channelData = new Float32Array(frames)
      data.copyTo(channelData, { planeIndex: ch, format: 'f32-planar' })
      for (let i = 0; i < frames; i++) {
        buffer[i * channels + ch] = channelData[i]
      }
    }

    return {
      data: buffer,
      timestamp: data.timestamp / 1_000_000,
      duration: data.duration ? data.duration / 1_000_000 : undefined,
      sampleRate: data.sampleRate,
      channels,
    }
  }

  async *items(start: number = 0, end: number = Infinity): AsyncGenerator<AudioSample> {
    for await (const packet of this.packetSource) {
      if (packet.timestamp < start) continue
      if (packet.timestamp > end) break

      if (!this.decoder) break

      const chunk = new EncodedAudioChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.timestamp * 1_000_000,
        data: packet.data,
      })

      this.decoder.decode(chunk)
      await this.decoder.flush()

      for (const data of this.pendingData) {
        yield this.audioDataToSample(data)
        data.close()
      }
      this.pendingData = []
    }
  }

  async *itemsAtTimestamps(timestamps: number[]): AsyncGenerator<AudioSample> {
    for (const ts of timestamps) {
      const sample = await this.get(ts)
      if (sample) yield sample
    }
  }

  close(): void {
    if (this.decoder) {
      this.decoder.close()
      this.decoder = null
    }
    for (const data of this.pendingData) {
      data.close()
    }
    this.pendingData = []
    this.samples = []
  }
}

/**
 * CanvasSink - Render decoded video frames to canvas
 */
export class CanvasSink {
  private videoSink: VideoSampleSink
  private canvasPool: OffscreenCanvas[] = []

  constructor(
    packetSource: AsyncIterable<EncodedPacket>,
    private width: number,
    private height: number,
    config?: VideoDecoderConfig,
  ) {
    this.videoSink = new VideoSampleSink(packetSource, config)
  }

  async init(config?: VideoDecoderConfig): Promise<void> {
    await this.videoSink.init(config)
  }

  async getCanvas(timestamp: number): Promise<OffscreenCanvas | null> {
    const sample = await this.videoSink.get(timestamp)
    if (!sample || !(sample.data instanceof VideoFrame)) return null

    const canvas = this.getOrCreateCanvas()
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      sample.data.close()
      return null
    }

    ctx.drawImage(sample.data, 0, 0, this.width, this.height)
    sample.data.close()

    return canvas
  }

  async *canvases(start: number = 0, end: number = Infinity): AsyncGenerator<{ canvas: OffscreenCanvas, timestamp: number }> {
    for await (const sample of this.videoSink.items(start, end)) {
      if (!(sample.data instanceof VideoFrame)) continue

      const canvas = this.getOrCreateCanvas()
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        sample.data.close()
        continue
      }

      ctx.drawImage(sample.data, 0, 0, this.width, this.height)
      sample.data.close()

      yield { canvas, timestamp: sample.timestamp }
    }
  }

  async *canvasesAtTimestamps(timestamps: number[]): AsyncGenerator<{ canvas: OffscreenCanvas, timestamp: number }> {
    for (const ts of timestamps) {
      const canvas = await this.getCanvas(ts)
      if (canvas) yield { canvas, timestamp: ts }
    }
  }

  private getOrCreateCanvas(): OffscreenCanvas {
    if (this.canvasPool.length > 0) {
      return this.canvasPool.pop()!
    }
    return new OffscreenCanvas(this.width, this.height)
  }

  returnCanvas(canvas: OffscreenCanvas): void {
    if (this.canvasPool.length < 10) {
      this.canvasPool.push(canvas)
    }
  }

  close(): void {
    this.videoSink.close()
    this.canvasPool = []
  }
}

/**
 * AudioBufferSink - Convert decoded audio to Web Audio API AudioBuffer
 */
export class AudioBufferSink {
  private audioSink: AudioSampleSink
  private audioContext: BaseAudioContext | null = null

  constructor(
    packetSource: AsyncIterable<EncodedPacket>,
    audioContext?: BaseAudioContext,
    config?: AudioDecoderConfig,
  ) {
    this.audioSink = new AudioSampleSink(packetSource, config)
    this.audioContext = audioContext ?? null
  }

  async init(config?: AudioDecoderConfig, audioContext?: BaseAudioContext): Promise<void> {
    if (audioContext) this.audioContext = audioContext
    await this.audioSink.init(config)
  }

  async getBuffer(timestamp: number): Promise<AudioBuffer | null> {
    if (!this.audioContext) {
      throw new Error('AudioContext required')
    }

    const sample = await this.audioSink.get(timestamp)
    if (!sample || !(sample.data instanceof Float32Array)) return null

    const channels = sample.channels ?? 2
    const sampleRate = sample.sampleRate ?? 44100
    const frames = sample.data.length / channels

    const buffer = this.audioContext.createBuffer(channels, frames, sampleRate)

    for (let ch = 0; ch < channels; ch++) {
      const channelData = buffer.getChannelData(ch)
      for (let i = 0; i < frames; i++) {
        channelData[i] = sample.data[i * channels + ch]
      }
    }

    return buffer
  }

  async *buffers(start: number = 0, end: number = Infinity): AsyncGenerator<{ buffer: AudioBuffer, timestamp: number }> {
    if (!this.audioContext) {
      throw new Error('AudioContext required')
    }

    for await (const sample of this.audioSink.items(start, end)) {
      if (!(sample.data instanceof Float32Array)) continue

      const channels = sample.channels ?? 2
      const sampleRate = sample.sampleRate ?? 44100
      const frames = sample.data.length / channels

      const buffer = this.audioContext.createBuffer(channels, frames, sampleRate)

      for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch)
        for (let i = 0; i < frames; i++) {
          channelData[i] = sample.data[i * channels + ch]
        }
      }

      yield { buffer, timestamp: sample.timestamp }
    }
  }

  async *buffersAtTimestamps(timestamps: number[]): AsyncGenerator<{ buffer: AudioBuffer, timestamp: number }> {
    for (const ts of timestamps) {
      const buffer = await this.getBuffer(ts)
      if (buffer) yield { buffer, timestamp: ts }
    }
  }

  close(): void {
    this.audioSink.close()
  }
}
