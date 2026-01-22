/**
 * WebM/Matroska muxer implementation
 */

import type { Target, VideoTrackConfig, AudioTrackConfig, SubtitleTrackConfig, EncodedPacket } from 'ts-videos'
import { Muxer, Writer, concatBytes } from 'ts-videos'
import type { OutputVideoTrack, OutputAudioTrack, OutputSubtitleTrack } from 'ts-videos'
import {
  EBML_IDS, TRACK_TYPES, CODEC_IDS,
  writeEbmlId, writeEbmlSize, writeEbmlUint, writeEbmlFloat, writeEbmlString,
} from './ebml'

const TIMESTAMP_SCALE = 1000000

interface WebmTrackData {
  track: OutputVideoTrack | OutputAudioTrack | OutputSubtitleTrack
  number: number
  uid: bigint
  codecId: string
}

interface ClusterData {
  timestamp: number
  blocks: Uint8Array[]
}

export interface WebmMuxerOptions {
  isWebm?: boolean
}

export class WebmMuxer extends Muxer {
  private trackData: Map<number, WebmTrackData> = new Map()
  private options: WebmMuxerOptions
  private clusters: ClusterData[] = []
  private currentCluster: ClusterData | null = null
  private nextTrackNumber = 1
  private segmentStartPos = 0
  private clusterDuration = 5000

  constructor(target: Target, options: WebmMuxerOptions = {}) {
    super(target)
    this.options = {
      isWebm: options.isWebm ?? true,
    }
  }

  get formatName(): string {
    return this.options.isWebm ? 'webm' : 'mkv'
  }

  get mimeType(): string {
    return this.options.isWebm ? 'video/webm' : 'video/x-matroska'
  }

  protected onTrackAdded(track: OutputVideoTrack | OutputAudioTrack | OutputSubtitleTrack): void {
    const trackNumber = this.nextTrackNumber++
    const uid = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))

    let codecId = ''
    if (track.type === 'video') {
      codecId = this.getVideoCodecId(track.config.codec)
    }
    else if (track.type === 'audio') {
      codecId = this.getAudioCodecId(track.config.codec)
    }

    this.trackData.set(track.id, {
      track,
      number: trackNumber,
      uid,
      codecId,
    })
  }

  private getVideoCodecId(codec: string): string {
    switch (codec) {
      case 'vp8': return CODEC_IDS.VP8
      case 'vp9': return CODEC_IDS.VP9
      case 'av1': return CODEC_IDS.AV1
      case 'h264': return CODEC_IDS.H264
      case 'h265': return CODEC_IDS.H265
      default: return CODEC_IDS.VP9
    }
  }

  private getAudioCodecId(codec: string): string {
    switch (codec) {
      case 'opus': return CODEC_IDS.OPUS
      case 'vorbis': return CODEC_IDS.VORBIS
      case 'aac': return CODEC_IDS.AAC
      case 'mp3': return CODEC_IDS.MP3
      case 'flac': return CODEC_IDS.FLAC
      default: return CODEC_IDS.OPUS
    }
  }

  protected async writeHeader(): Promise<void> {
    await this.writeEbmlHeader()
    await this.writeSegmentHeader()
  }

  private async writeEbmlHeader(): Promise<void> {
    const docType = this.options.isWebm ? 'webm' : 'matroska'

    const elements: Uint8Array[] = [
      this.createEbmlElement(EBML_IDS.EBMLVersion, writeEbmlUint(1)),
      this.createEbmlElement(EBML_IDS.EBMLReadVersion, writeEbmlUint(1)),
      this.createEbmlElement(EBML_IDS.EBMLMaxIDLength, writeEbmlUint(4)),
      this.createEbmlElement(EBML_IDS.EBMLMaxSizeLength, writeEbmlUint(8)),
      this.createEbmlElement(EBML_IDS.DocType, writeEbmlString(docType)),
      this.createEbmlElement(EBML_IDS.DocTypeVersion, writeEbmlUint(4)),
      this.createEbmlElement(EBML_IDS.DocTypeReadVersion, writeEbmlUint(2)),
    ]

    const ebmlContent = concatBytes(...elements)
    const ebml = this.createEbmlElement(EBML_IDS.EBML, ebmlContent)
    await this.writer.writeBytes(ebml)
  }

  private async writeSegmentHeader(): Promise<void> {
    const segmentId = writeEbmlId(EBML_IDS.Segment)
    const unknownSize = new Uint8Array([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])

    await this.writer.writeBytes(segmentId)
    await this.writer.writeBytes(unknownSize)

    this.segmentStartPos = this.writer.position

    await this.writeInfo()
    await this.writeTracks()
  }

  private async writeInfo(): Promise<void> {
    const elements: Uint8Array[] = [
      this.createEbmlElement(EBML_IDS.TimestampScale, writeEbmlUint(TIMESTAMP_SCALE)),
      this.createEbmlElement(EBML_IDS.MuxingApp, writeEbmlString('ts-videos')),
      this.createEbmlElement(EBML_IDS.WritingApp, writeEbmlString('ts-videos')),
    ]

    const infoContent = concatBytes(...elements)
    const info = this.createEbmlElement(EBML_IDS.Info, infoContent)
    await this.writer.writeBytes(info)
  }

  private async writeTracks(): Promise<void> {
    const trackEntries: Uint8Array[] = []

    for (const data of this.trackData.values()) {
      const entry = this.createTrackEntry(data)
      trackEntries.push(entry)
    }

    const tracksContent = concatBytes(...trackEntries)
    const tracks = this.createEbmlElement(EBML_IDS.Tracks, tracksContent)
    await this.writer.writeBytes(tracks)
  }

  private createTrackEntry(data: WebmTrackData): Uint8Array {
    const track = data.track
    const elements: Uint8Array[] = [
      this.createEbmlElement(EBML_IDS.TrackNumber, writeEbmlUint(data.number)),
      this.createEbmlElement(EBML_IDS.TrackUID, writeEbmlUint(Number(data.uid))),
      this.createEbmlElement(EBML_IDS.CodecID, writeEbmlString(data.codecId)),
    ]

    if (track.type === 'video') {
      elements.push(this.createEbmlElement(EBML_IDS.TrackType, writeEbmlUint(TRACK_TYPES.VIDEO)))

      const videoElements: Uint8Array[] = [
        this.createEbmlElement(EBML_IDS.PixelWidth, writeEbmlUint(track.config.width)),
        this.createEbmlElement(EBML_IDS.PixelHeight, writeEbmlUint(track.config.height)),
      ]

      const videoContent = concatBytes(...videoElements)
      elements.push(this.createEbmlElement(EBML_IDS.Video, videoContent))

      if (track.config.codecDescription) {
        elements.push(this.createEbmlElement(EBML_IDS.CodecPrivate, track.config.codecDescription))
      }

      if (track.config.frameRate) {
        const duration = Math.round(1000000000 / track.config.frameRate)
        elements.push(this.createEbmlElement(EBML_IDS.DefaultDuration, writeEbmlUint(duration)))
      }
    }
    else if (track.type === 'audio') {
      elements.push(this.createEbmlElement(EBML_IDS.TrackType, writeEbmlUint(TRACK_TYPES.AUDIO)))

      const audioElements: Uint8Array[] = [
        this.createEbmlElement(EBML_IDS.SamplingFrequency, writeEbmlFloat(track.config.sampleRate, 8)),
        this.createEbmlElement(EBML_IDS.Channels, writeEbmlUint(track.config.channels)),
      ]

      if (track.config.bitsPerSample) {
        audioElements.push(this.createEbmlElement(EBML_IDS.BitDepth, writeEbmlUint(track.config.bitsPerSample)))
      }

      const audioContent = concatBytes(...audioElements)
      elements.push(this.createEbmlElement(EBML_IDS.Audio, audioContent))

      if (track.config.codecDescription) {
        elements.push(this.createEbmlElement(EBML_IDS.CodecPrivate, track.config.codecDescription))
      }
    }
    else {
      elements.push(this.createEbmlElement(EBML_IDS.TrackType, writeEbmlUint(TRACK_TYPES.SUBTITLE)))
    }

    const entryContent = concatBytes(...elements)
    return this.createEbmlElement(EBML_IDS.TrackEntry, entryContent)
  }

  protected async writeVideoPacket(track: OutputVideoTrack, packet: EncodedPacket): Promise<void> {
    await this.writeBlock(track.id, packet)
  }

  protected async writeAudioPacket(track: OutputAudioTrack, packet: EncodedPacket): Promise<void> {
    await this.writeBlock(track.id, packet)
  }

  protected async writeSubtitlePacket(track: OutputSubtitleTrack, packet: EncodedPacket): Promise<void> {
    await this.writeBlock(track.id, packet)
  }

  private async writeBlock(trackId: number, packet: EncodedPacket): Promise<void> {
    const data = this.trackData.get(trackId)
    if (!data) return

    const timestampMs = Math.round(packet.timestamp * 1000)

    if (!this.currentCluster || timestampMs - this.currentCluster.timestamp > this.clusterDuration) {
      if (this.currentCluster) {
        await this.flushCluster()
      }
      this.currentCluster = {
        timestamp: timestampMs,
        blocks: [],
      }
    }

    const relativeTimestamp = timestampMs - this.currentCluster.timestamp
    const block = this.createSimpleBlock(data.number, relativeTimestamp, packet)
    this.currentCluster.blocks.push(block)
  }

  private createSimpleBlock(trackNumber: number, relativeTimestamp: number, packet: EncodedPacket): Uint8Array {
    const trackNumBytes = writeEbmlSize(trackNumber)

    const timecodeHi = (relativeTimestamp >> 8) & 0xFF
    const timecodeLo = relativeTimestamp & 0xFF

    let flags = 0
    if (packet.isKeyframe) flags |= 0x80

    const header = new Uint8Array([
      ...trackNumBytes,
      timecodeHi,
      timecodeLo,
      flags,
    ])

    const blockData = concatBytes(header, packet.data)
    return this.createEbmlElement(EBML_IDS.SimpleBlock, blockData)
  }

  private async flushCluster(): Promise<void> {
    if (!this.currentCluster || this.currentCluster.blocks.length === 0) return

    const elements: Uint8Array[] = [
      this.createEbmlElement(EBML_IDS.Timestamp, writeEbmlUint(this.currentCluster.timestamp)),
      ...this.currentCluster.blocks,
    ]

    const clusterContent = concatBytes(...elements)
    const cluster = this.createEbmlElement(EBML_IDS.Cluster, clusterContent)
    await this.writer.writeBytes(cluster)

    this.clusters.push(this.currentCluster)
    this.currentCluster = null
  }

  protected async writeTrailer(): Promise<void> {
    await this.flushCluster()
  }

  private createEbmlElement(id: number, data: Uint8Array): Uint8Array {
    const idBytes = writeEbmlId(id)
    const sizeBytes = writeEbmlSize(data.length)
    return concatBytes(idBytes, sizeBytes, data)
  }
}
