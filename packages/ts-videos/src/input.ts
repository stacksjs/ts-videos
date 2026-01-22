/**
 * High-level Input abstraction for reading media files
 */

import type { Source } from './reader'
import type { Track, VideoTrack, AudioTrack, SubtitleTrack, Metadata, EncodedPacket } from './types'
import type { Demuxer, InputFormat } from './demuxer'
import { createSource } from './source'

export interface InputOptions {
  source?: Source
  formats?: InputFormat[]
}

export class Input {
  private source: Source
  private formats: InputFormat[]
  private _demuxer: Demuxer | null = null
  private _demuxerPromise: Promise<Demuxer> | null = null
  private _format: InputFormat | null = null
  private disposed = false

  constructor(input: Uint8Array | ArrayBuffer | Blob | string | ReadableStream<Uint8Array> | InputOptions) {
    if (input instanceof Uint8Array || input instanceof ArrayBuffer || typeof input === 'string') {
      this.source = createSource(input)
      this.formats = []
    }
    else if (typeof Blob !== 'undefined' && input instanceof Blob) {
      this.source = createSource(input)
      this.formats = []
    }
    else if (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream) {
      this.source = createSource(input)
      this.formats = []
    }
    else {
      const options = input as InputOptions
      if (!options.source) {
        throw new Error('Input source is required')
      }
      this.source = options.source
      this.formats = options.formats ?? []
    }
  }

  setFormats(formats: InputFormat[]): void {
    this.formats = formats
  }

  private async getDemuxer(): Promise<Demuxer> {
    if (this.disposed) {
      throw new Error('Input has been disposed')
    }

    if (this._demuxer) {
      return this._demuxer
    }

    return this._demuxerPromise ??= (async () => {
      for (const format of this.formats) {
        const canRead = await format.canRead(this.source)
        if (canRead) {
          this._format = format
          this._demuxer = format.createDemuxer(this.source)
          await this._demuxer.init()
          return this._demuxer
        }
      }
      throw new Error('Input has an unsupported or unrecognizable format')
    })()
  }

  async getFormat(): Promise<InputFormat | null> {
    await this.getDemuxer()
    return this._format
  }

  async getFormatName(): Promise<string> {
    const demuxer = await this.getDemuxer()
    return demuxer.formatName
  }

  async getMimeType(): Promise<string> {
    const demuxer = await this.getDemuxer()
    return demuxer.mimeType
  }

  async getTracks(): Promise<Track[]> {
    const demuxer = await this.getDemuxer()
    return demuxer.getTracks()
  }

  async getVideoTracks(): Promise<VideoTrack[]> {
    const demuxer = await this.getDemuxer()
    return demuxer.getVideoTracks()
  }

  async getAudioTracks(): Promise<AudioTrack[]> {
    const demuxer = await this.getDemuxer()
    return demuxer.getAudioTracks()
  }

  async getSubtitleTracks(): Promise<SubtitleTrack[]> {
    const demuxer = await this.getDemuxer()
    return demuxer.getSubtitleTracks()
  }

  async getPrimaryVideoTrack(): Promise<VideoTrack | null> {
    const demuxer = await this.getDemuxer()
    return demuxer.getPrimaryVideoTrack()
  }

  async getPrimaryAudioTrack(): Promise<AudioTrack | null> {
    const demuxer = await this.getDemuxer()
    return demuxer.getPrimaryAudioTrack()
  }

  async getMetadata(): Promise<Metadata> {
    const demuxer = await this.getDemuxer()
    return demuxer.getMetadata()
  }

  async getDuration(): Promise<number> {
    const demuxer = await this.getDemuxer()
    return demuxer.getDuration()
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    const demuxer = await this.getDemuxer()
    return demuxer.readPacket(trackId)
  }

  async seek(timeInSeconds: number): Promise<void> {
    const demuxer = await this.getDemuxer()
    return demuxer.seek(timeInSeconds)
  }

  async *packets(trackId: number): AsyncGenerator<EncodedPacket> {
    const demuxer = await this.getDemuxer()
    yield* demuxer.packets(trackId)
  }

  async *allPackets(): AsyncGenerator<{ trackId: number, packet: EncodedPacket }> {
    const demuxer = await this.getDemuxer()
    yield* demuxer.allPackets()
  }

  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    if (this._demuxer) {
      await this._demuxer.close()
    }
    await this.source.close?.()
  }

  [Symbol.dispose](): void {
    this.close().catch(() => {})
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
