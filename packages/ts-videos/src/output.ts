/**
 * High-level Output abstraction for writing media files
 */

import type { Target } from './writer'
import type { VideoTrackConfig, AudioTrackConfig, SubtitleTrackConfig, EncodedPacket, Metadata } from './types'
import type { Muxer, OutputFormat, OutputVideoTrack, OutputAudioTrack, OutputSubtitleTrack } from './muxer'
import { createTarget } from './target'

export interface OutputOptions {
  format: OutputFormat
  target?: Target
}

export class Output {
  private format: OutputFormat
  private target: Target
  private _muxer: Muxer | null = null
  private disposed = false
  private videoTracks: OutputVideoTrack[] = []
  private audioTracks: OutputAudioTrack[] = []
  private subtitleTracks: OutputSubtitleTrack[] = []

  constructor(options: OutputOptions | OutputFormat) {
    if ('createMuxer' in options) {
      this.format = options as OutputFormat
      this.target = createTarget('buffer')
    }
    else {
      this.format = options.format
      this.target = options.target ?? createTarget('buffer')
    }
  }

  private getMuxer(): Muxer {
    if (this.disposed) {
      throw new Error('Output has been disposed')
    }

    if (!this._muxer) {
      this._muxer = this.format.createMuxer(this.target)
    }
    return this._muxer
  }

  getFormatName(): string {
    return this.format.name
  }

  getMimeType(): string {
    return this.format.mimeType
  }

  getExtension(): string {
    return this.format.extension
  }

  setMetadata(metadata: Metadata): void {
    const muxer = this.getMuxer()
    muxer.setMetadata(metadata)
  }

  addVideoTrack(config: VideoTrackConfig): OutputVideoTrack {
    const muxer = this.getMuxer()
    const track = muxer.addVideoTrack(config)
    this.videoTracks.push(track)
    return track
  }

  addAudioTrack(config: AudioTrackConfig): OutputAudioTrack {
    const muxer = this.getMuxer()
    const track = muxer.addAudioTrack(config)
    this.audioTracks.push(track)
    return track
  }

  addSubtitleTrack(config: SubtitleTrackConfig): OutputSubtitleTrack {
    const muxer = this.getMuxer()
    const track = muxer.addSubtitleTrack(config)
    this.subtitleTracks.push(track)
    return track
  }

  getVideoTracks(): OutputVideoTrack[] {
    return [...this.videoTracks]
  }

  getAudioTracks(): OutputAudioTrack[] {
    return [...this.audioTracks]
  }

  getSubtitleTracks(): OutputSubtitleTrack[] {
    return [...this.subtitleTracks]
  }

  async writePacket(trackId: number, packet: EncodedPacket): Promise<void> {
    const muxer = this.getMuxer()
    await muxer.writePacket(trackId, packet)
  }

  async writeVideoPacket(track: OutputVideoTrack, packet: EncodedPacket): Promise<void> {
    await this.writePacket(track.id, packet)
  }

  async writeAudioPacket(track: OutputAudioTrack, packet: EncodedPacket): Promise<void> {
    await this.writePacket(track.id, packet)
  }

  async finalize(): Promise<Uint8Array> {
    if (this.disposed) {
      throw new Error('Output has been disposed')
    }

    const muxer = this.getMuxer()
    return muxer.finalize()
  }

  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    if (this._muxer) {
      await this._muxer.close()
    }
    await this.target.close?.()
  }

  [Symbol.dispose](): void {
    this.close().catch(() => {})
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
