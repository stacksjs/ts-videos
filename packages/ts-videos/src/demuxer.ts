/**
 * Base demuxer class for reading container formats
 * Codec packages extend this to implement format-specific parsing
 */

import type { Source } from './reader'
import { Reader } from './reader'
import type { Track, VideoTrack, AudioTrack, SubtitleTrack, Metadata, EncodedPacket } from './types'

export abstract class Demuxer {
  protected reader: Reader
  protected source: Source
  protected _tracks: Track[] | null = null
  protected _metadata: Metadata | null = null
  protected _duration: number | null = null

  constructor(source: Source) {
    this.source = source
    this.reader = Reader.fromSource(source)
  }

  abstract get formatName(): string
  abstract get mimeType(): string

  abstract init(): Promise<void>

  async getTracks(): Promise<Track[]> {
    if (!this._tracks) {
      await this.init()
    }
    return this._tracks ?? []
  }

  async getVideoTracks(): Promise<VideoTrack[]> {
    const tracks = await this.getTracks()
    return tracks.filter((t): t is VideoTrack => t.type === 'video')
  }

  async getAudioTracks(): Promise<AudioTrack[]> {
    const tracks = await this.getTracks()
    return tracks.filter((t): t is AudioTrack => t.type === 'audio')
  }

  async getSubtitleTracks(): Promise<SubtitleTrack[]> {
    const tracks = await this.getTracks()
    return tracks.filter((t): t is SubtitleTrack => t.type === 'subtitle')
  }

  async getPrimaryVideoTrack(): Promise<VideoTrack | null> {
    const tracks = await this.getVideoTracks()
    return tracks.find(t => t.isDefault) ?? tracks[0] ?? null
  }

  async getPrimaryAudioTrack(): Promise<AudioTrack | null> {
    const tracks = await this.getAudioTracks()
    return tracks.find(t => t.isDefault) ?? tracks[0] ?? null
  }

  async getMetadata(): Promise<Metadata> {
    if (!this._metadata) {
      await this.init()
    }
    return this._metadata ?? {}
  }

  async getDuration(): Promise<number> {
    if (this._duration === null) {
      await this.init()
    }
    return this._duration ?? 0
  }

  abstract readPacket(trackId: number): Promise<EncodedPacket | null>

  abstract seek(timeInSeconds: number): Promise<void>

  async *packets(trackId: number): AsyncGenerator<EncodedPacket> {
    while (true) {
      const packet = await this.readPacket(trackId)
      if (!packet) break
      yield packet
    }
  }

  async *allPackets(): AsyncGenerator<{ trackId: number, packet: EncodedPacket }> {
    const tracks = await this.getTracks()
    const iterators = tracks.map(track => ({
      trackId: track.id,
      iterator: this.packets(track.id),
      currentPacket: null as EncodedPacket | null,
      done: false,
    }))

    for (const it of iterators) {
      const result = await it.iterator.next()
      if (!result.done) {
        it.currentPacket = result.value
      }
      else {
        it.done = true
      }
    }

    while (iterators.some(it => !it.done)) {
      let minIterator = null
      let minTimestamp = Number.POSITIVE_INFINITY

      for (const it of iterators) {
        if (!it.done && it.currentPacket && it.currentPacket.timestamp < minTimestamp) {
          minTimestamp = it.currentPacket.timestamp
          minIterator = it
        }
      }

      if (!minIterator || !minIterator.currentPacket) break

      yield { trackId: minIterator.trackId, packet: minIterator.currentPacket }

      const result = await minIterator.iterator.next()
      if (!result.done) {
        minIterator.currentPacket = result.value
      }
      else {
        minIterator.done = true
        minIterator.currentPacket = null
      }
    }
  }

  async close(): Promise<void> {
    await this.source.close?.()
  }
}

export abstract class InputFormat {
  abstract get name(): string
  abstract get mimeType(): string
  abstract get extensions(): string[]

  abstract canRead(source: Source): Promise<boolean>
  abstract createDemuxer(source: Source): Demuxer
}
