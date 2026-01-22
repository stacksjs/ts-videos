/**
 * High-level Conversion API for transcoding media files
 */

import type { Input } from './input'
import type { Output } from './output'
import type { ConversionOptions, EncodedPacket } from './types'
import type { OutputVideoTrack, OutputAudioTrack } from './muxer'

export interface ConversionConfig {
  input: Input
  output: Output
  options?: ConversionOptions
}

export interface ConversionProgress {
  currentTime: number
  duration: number
  percentage: number
  framesProcessed: number
  samplesProcessed: number
}

export type ProgressCallback = (progress: ConversionProgress) => void

export class Conversion {
  private input: Input
  private output: Output
  private options: ConversionOptions
  private canceled = false
  private progressCallback: ProgressCallback | null = null

  private videoTrackMap: Map<number, OutputVideoTrack> = new Map()
  private audioTrackMap: Map<number, OutputAudioTrack> = new Map()

  private framesProcessed = 0
  private samplesProcessed = 0
  private lastProgressTime = 0

  private constructor(config: ConversionConfig) {
    this.input = config.input
    this.output = config.output
    this.options = config.options ?? {}
  }

  static async init(config: ConversionConfig): Promise<Conversion> {
    const conversion = new Conversion(config)
    await conversion.setup()
    return conversion
  }

  private async setup(): Promise<void> {
    const videoTrack = await this.input.getPrimaryVideoTrack()
    const audioTrack = await this.input.getPrimaryAudioTrack()

    if (videoTrack) {
      const outputVideoTrack = this.output.addVideoTrack({
        codec: this.options.videoCodec ?? videoTrack.codec,
        width: this.options.width ?? videoTrack.width,
        height: this.options.height ?? videoTrack.height,
        frameRate: this.options.frameRate ?? videoTrack.frameRate,
        bitrate: this.options.videoBitrate ?? videoTrack.bitrate,
        codecDescription: videoTrack.codecDescription,
        colorSpace: videoTrack.colorSpace,
        rotation: videoTrack.rotation,
      })
      this.videoTrackMap.set(videoTrack.id, outputVideoTrack)
    }

    if (audioTrack) {
      const outputAudioTrack = this.output.addAudioTrack({
        codec: this.options.audioCodec ?? audioTrack.codec,
        sampleRate: this.options.sampleRate ?? audioTrack.sampleRate,
        channels: this.options.channels ?? audioTrack.channels,
        bitrate: this.options.audioBitrate ?? audioTrack.bitrate,
        codecDescription: audioTrack.codecDescription,
      })
      this.audioTrackMap.set(audioTrack.id, outputAudioTrack)
    }

    if (this.options.preserveMetadata !== false) {
      const metadata = await this.input.getMetadata()
      this.output.setMetadata(metadata)
    }
  }

  onProgress(callback: ProgressCallback): this {
    this.progressCallback = callback
    return this
  }

  cancel(): void {
    this.canceled = true
  }

  async execute(): Promise<Uint8Array> {
    const duration = await this.input.getDuration()

    const startTime = this.options.startTime ?? 0
    const endTime = this.options.endTime ?? duration

    if (startTime > 0) {
      await this.input.seek(startTime)
    }

    for await (const { trackId, packet } of this.input.allPackets()) {
      if (this.canceled) {
        throw new ConversionCanceledError('Conversion was canceled')
      }

      if (packet.timestamp < startTime) {
        continue
      }

      if (packet.timestamp > endTime) {
        break
      }

      const adjustedPacket: EncodedPacket = {
        ...packet,
        timestamp: packet.timestamp - startTime,
      }

      const videoTrack = this.videoTrackMap.get(trackId)
      if (videoTrack) {
        await this.output.writeVideoPacket(videoTrack, adjustedPacket)
        this.framesProcessed++
        this.emitProgress(packet.timestamp, duration)
        continue
      }

      const audioTrack = this.audioTrackMap.get(trackId)
      if (audioTrack) {
        await this.output.writeAudioPacket(audioTrack, adjustedPacket)
        this.samplesProcessed++
        continue
      }
    }

    this.emitProgress(endTime, duration)

    return this.output.finalize()
  }

  private emitProgress(currentTime: number, duration: number): void {
    if (!this.progressCallback) return

    const now = Date.now()
    if (now - this.lastProgressTime < 100) return
    this.lastProgressTime = now

    const percentage = duration > 0 ? (currentTime / duration) * 100 : 0

    this.progressCallback({
      currentTime,
      duration,
      percentage: Math.min(100, Math.max(0, percentage)),
      framesProcessed: this.framesProcessed,
      samplesProcessed: this.samplesProcessed,
    })
  }

  async close(): Promise<void> {
    await this.input.close()
    await this.output.close()
  }
}

export class ConversionCanceledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionCanceledError'
  }
}

export async function convert(
  input: Input,
  output: Output,
  options?: ConversionOptions,
): Promise<Uint8Array> {
  const conversion = await Conversion.init({ input, output, options })
  try {
    return await conversion.execute()
  }
  finally {
    await conversion.close()
  }
}
