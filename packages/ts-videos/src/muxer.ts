/**
 * Base muxer class for writing container formats
 * Codec packages extend this to implement format-specific writing
 */

import type { Target } from './writer'
import { Writer } from './writer'
import type { VideoTrackConfig, AudioTrackConfig, SubtitleTrackConfig, EncodedPacket, Metadata } from './types'
import { AsyncMutex } from './utils'

export interface OutputVideoTrack {
  id: number
  type: 'video'
  config: VideoTrackConfig
}

export interface OutputAudioTrack {
  id: number
  type: 'audio'
  config: AudioTrackConfig
}

export interface OutputSubtitleTrack {
  id: number
  type: 'subtitle'
  config: SubtitleTrackConfig
}

export type OutputTrack = OutputVideoTrack | OutputAudioTrack | OutputSubtitleTrack

export abstract class Muxer {
  protected writer: Writer
  protected target: Target
  protected tracks: OutputTrack[] = []
  protected nextTrackId = 1
  protected mutex: AsyncMutex = new AsyncMutex()
  protected started = false
  protected finalized = false
  protected metadata: Metadata = {}
  protected firstTimestamp: number | null = null

  constructor(target: Target) {
    this.target = target
    this.writer = new Writer({ target })
  }

  abstract get formatName(): string
  abstract get mimeType(): string

  setMetadata(metadata: Metadata): void {
    this.metadata = { ...this.metadata, ...metadata }
  }

  addVideoTrack(config: VideoTrackConfig): OutputVideoTrack {
    if (this.started) {
      throw new Error('Cannot add tracks after muxer has started')
    }

    const track: OutputVideoTrack = {
      id: this.nextTrackId++,
      type: 'video',
      config,
    }

    this.tracks.push(track)
    this.onTrackAdded(track)
    return track
  }

  addAudioTrack(config: AudioTrackConfig): OutputAudioTrack {
    if (this.started) {
      throw new Error('Cannot add tracks after muxer has started')
    }

    const track: OutputAudioTrack = {
      id: this.nextTrackId++,
      type: 'audio',
      config,
    }

    this.tracks.push(track)
    this.onTrackAdded(track)
    return track
  }

  addSubtitleTrack(config: SubtitleTrackConfig): OutputSubtitleTrack {
    if (this.started) {
      throw new Error('Cannot add tracks after muxer has started')
    }

    const track: OutputSubtitleTrack = {
      id: this.nextTrackId++,
      type: 'subtitle',
      config,
    }

    this.tracks.push(track)
    this.onTrackAdded(track)
    return track
  }

  protected onTrackAdded(_track: OutputTrack): void {
    // Override in subclasses if needed
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.writeHeader()
  }

  protected abstract writeHeader(): Promise<void>

  async writePacket(trackId: number, packet: EncodedPacket): Promise<void> {
    return this.mutex.lock(async () => {
      if (!this.started) {
        await this.start()
      }

      if (this.finalized) {
        throw new Error('Cannot write packets after muxer has been finalized')
      }

      const track = this.tracks.find(t => t.id === trackId)
      if (!track) {
        throw new Error(`Track ${trackId} not found`)
      }

      if (this.firstTimestamp === null) {
        this.firstTimestamp = packet.timestamp
      }

      const normalizedTimestamp = packet.timestamp - (this.firstTimestamp ?? 0)
      const normalizedPacket = { ...packet, timestamp: normalizedTimestamp }

      if (track.type === 'video') {
        await this.writeVideoPacket(track, normalizedPacket)
      }
      else if (track.type === 'audio') {
        await this.writeAudioPacket(track, normalizedPacket)
      }
      else if (track.type === 'subtitle') {
        await this.writeSubtitlePacket(track, normalizedPacket)
      }
    })
  }

  protected abstract writeVideoPacket(track: OutputVideoTrack, packet: EncodedPacket): Promise<void>
  protected abstract writeAudioPacket(track: OutputAudioTrack, packet: EncodedPacket): Promise<void>
  protected abstract writeSubtitlePacket(track: OutputSubtitleTrack, packet: EncodedPacket): Promise<void>

  async finalize(): Promise<Uint8Array> {
    return this.mutex.lock(async () => {
      if (this.finalized) {
        throw new Error('Muxer already finalized')
      }

      if (!this.started) {
        await this.start()
      }

      await this.writeTrailer()
      this.finalized = true

      return this.writer.finalize()
    })
  }

  protected abstract writeTrailer(): Promise<void>

  async close(): Promise<void> {
    if (!this.finalized) {
      await this.finalize()
    }
    await this.target.close?.()
  }
}

export abstract class OutputFormat {
  abstract get name(): string
  abstract get mimeType(): string
  abstract get extension(): string

  abstract createMuxer(target: Target): Muxer
}
