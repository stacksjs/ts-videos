/**
 * WebM/Matroska demuxer implementation
 */

import type { Source, Track, VideoTrack, AudioTrack, Metadata, EncodedPacket, VideoCodec, AudioCodec } from 'ts-videos'
import { Demuxer, Reader } from 'ts-videos'
import {
  EBML_IDS, TRACK_TYPES, CODEC_IDS, CONTAINER_ELEMENTS,
  readEbmlId, readEbmlSize, readEbmlUint, readEbmlFloat, readEbmlString,
} from './ebml'

interface TrackInfo {
  id: number
  uid: bigint
  type: number
  codecId: string
  codecPrivate?: Uint8Array
  defaultDuration?: number
  video?: {
    width: number
    height: number
    displayWidth?: number
    displayHeight?: number
  }
  audio?: {
    sampleRate: number
    channels: number
    bitDepth?: number
  }
  language?: string
  name?: string
  isDefault?: boolean
}

interface ClusterInfo {
  offset: number
  timestamp: number
}

interface BlockInfo {
  trackNumber: number
  timestamp: number
  data: Uint8Array
  isKeyframe: boolean
  duration?: number
}

export class WebmDemuxer extends Demuxer {
  private timestampScale = 1000000
  private duration = 0
  private trackInfos: TrackInfo[] = []
  private clusters: ClusterInfo[] = []
  private currentClusterIndex = 0
  private currentBlockIndex = 0
  private currentClusterBlocks: BlockInfo[] = []
  private segmentOffset = 0
  private isWebm = false
  private _initialized = false

  get formatName(): string {
    return this.isWebm ? 'webm' : 'mkv'
  }

  get mimeType(): string {
    const type = this.isWebm ? 'video/webm' : 'video/x-matroska'
    const videoTrack = this._tracks?.find(t => t.type === 'video')
    const audioTrack = this._tracks?.find(t => t.type === 'audio')

    const codecs: string[] = []
    if (videoTrack) codecs.push(this.getCodecMimeString(videoTrack))
    if (audioTrack) codecs.push(this.getCodecMimeString(audioTrack))

    return codecs.length > 0 ? `${type}; codecs="${codecs.join(', ')}"` : type
  }

  private getCodecMimeString(track: Track): string {
    if (track.type === 'video') {
      const codec = (track as VideoTrack).codec
      if (codec === 'vp8') return 'vp8'
      if (codec === 'vp9') return 'vp09.00.10.08'
      if (codec === 'av1') return 'av01.0.00M.08'
      if (codec === 'h264') return 'avc1'
      if (codec === 'h265') return 'hev1'
      return codec
    }
    if (track.type === 'audio') {
      const codec = (track as AudioTrack).codec
      if (codec === 'opus') return 'opus'
      if (codec === 'vorbis') return 'vorbis'
      if (codec === 'aac') return 'mp4a.40.2'
      return codec
    }
    return 'unknown'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.parseEbmlHeader()
    await this.parseSegment()
    await this.buildTracks()
  }

  private async parseEbmlHeader(): Promise<void> {
    this.reader.position = 0

    const idResult = await this.readEbmlElement()
    if (!idResult || idResult.id !== EBML_IDS.EBML) {
      throw new Error('Invalid EBML file: missing EBML header')
    }

    const headerData = await this.reader.readBytes(idResult.size)
    if (!headerData) throw new Error('Failed to read EBML header')

    let offset = 0
    while (offset < headerData.length) {
      const childId = readEbmlId(headerData, offset)
      if (!childId) break
      offset += childId.length

      const childSize = readEbmlSize(headerData, offset)
      if (!childSize) break
      offset += childSize.length

      if (childId.id === EBML_IDS.DocType) {
        const docType = readEbmlString(headerData.subarray(offset, offset + childSize.size))
        this.isWebm = docType === 'webm'
      }

      offset += childSize.size
    }
  }

  private async parseSegment(): Promise<void> {
    const idResult = await this.readEbmlElement()
    if (!idResult || idResult.id !== EBML_IDS.Segment) {
      throw new Error('Invalid EBML file: missing Segment')
    }

    this.segmentOffset = this.reader.position

    const segmentEnd = idResult.unknown ? Number.MAX_SAFE_INTEGER : this.reader.position + idResult.size

    while (this.reader.position < segmentEnd) {
      const elementStart = this.reader.position
      const element = await this.readEbmlElement()
      if (!element) break

      if (element.id === EBML_IDS.Info) {
        await this.parseInfo(element.size)
      }
      else if (element.id === EBML_IDS.Tracks) {
        await this.parseTracks(element.size)
      }
      else if (element.id === EBML_IDS.Cluster) {
        this.clusters.push({
          offset: elementStart,
          timestamp: 0,
        })
        await this.reader.skip(element.size)
      }
      else if (element.id === EBML_IDS.Cues) {
        await this.reader.skip(element.size)
      }
      else if (element.id === EBML_IDS.Tags) {
        await this.reader.skip(element.size)
      }
      else {
        await this.reader.skip(element.size)
      }
    }
  }

  private async readEbmlElement(): Promise<{ id: number, size: number, unknown: boolean } | null> {
    const startPos = this.reader.position

    const firstByte = await this.reader.readU8()
    if (firstByte === null) return null

    let idLength = 1
    let mask = 0x80
    while ((firstByte & mask) === 0 && idLength < 4) {
      mask >>= 1
      idLength++
    }

    this.reader.position = startPos
    const idBytes = await this.reader.readBytes(idLength)
    if (!idBytes) return null

    let id = 0
    for (let i = 0; i < idLength; i++) {
      id = (id << 8) | idBytes[i]
    }

    const sizeFirstByte = await this.reader.readU8()
    if (sizeFirstByte === null) return null

    let sizeLength = 1
    mask = 0x80
    while ((sizeFirstByte & mask) === 0 && sizeLength < 8) {
      mask >>= 1
      sizeLength++
    }

    this.reader.position = this.reader.position - 1
    const sizeBytes = await this.reader.readBytes(sizeLength)
    if (!sizeBytes) return null

    let size = sizeBytes[0] & (mask - 1)
    for (let i = 1; i < sizeLength; i++) {
      size = size * 256 + sizeBytes[i]
    }

    const maxValues = [0x7F, 0x3FFF, 0x1FFFFF, 0x0FFFFFFF]
    const unknown = sizeLength <= 4 && size === maxValues[sizeLength - 1]

    return { id, size, unknown }
  }

  private async parseInfo(size: number): Promise<void> {
    const endPos = this.reader.position + size

    while (this.reader.position < endPos) {
      const element = await this.readEbmlElement()
      if (!element) break

      if (element.id === EBML_IDS.TimestampScale) {
        const data = await this.reader.readBytes(element.size)
        if (data) this.timestampScale = readEbmlUint(data)
      }
      else if (element.id === EBML_IDS.Duration) {
        const data = await this.reader.readBytes(element.size)
        if (data) this.duration = readEbmlFloat(data)
      }
      else {
        await this.reader.skip(element.size)
      }
    }
  }

  private async parseTracks(size: number): Promise<void> {
    const endPos = this.reader.position + size

    while (this.reader.position < endPos) {
      const element = await this.readEbmlElement()
      if (!element) break

      if (element.id === EBML_IDS.TrackEntry) {
        const track = await this.parseTrackEntry(element.size)
        if (track) this.trackInfos.push(track)
      }
      else {
        await this.reader.skip(element.size)
      }
    }
  }

  private async parseTrackEntry(size: number): Promise<TrackInfo | null> {
    const endPos = this.reader.position + size
    const track: TrackInfo = {
      id: 0,
      uid: 0n,
      type: 0,
      codecId: '',
    }

    while (this.reader.position < endPos) {
      const element = await this.readEbmlElement()
      if (!element) break

      const data = await this.reader.readBytes(element.size)
      if (!data) break

      switch (element.id) {
        case EBML_IDS.TrackNumber:
          track.id = readEbmlUint(data)
          break
        case EBML_IDS.TrackUID:
          track.uid = BigInt(readEbmlUint(data))
          break
        case EBML_IDS.TrackType:
          track.type = readEbmlUint(data)
          break
        case EBML_IDS.CodecID:
          track.codecId = readEbmlString(data)
          break
        case EBML_IDS.CodecPrivate:
          track.codecPrivate = data
          break
        case EBML_IDS.DefaultDuration:
          track.defaultDuration = readEbmlUint(data)
          break
        case EBML_IDS.Language:
          track.language = readEbmlString(data)
          break
        case EBML_IDS.Name:
          track.name = readEbmlString(data)
          break
        case EBML_IDS.FlagDefault:
          track.isDefault = readEbmlUint(data) === 1
          break
        case EBML_IDS.Video:
          track.video = this.parseVideoData(data)
          break
        case EBML_IDS.Audio:
          track.audio = this.parseAudioData(data)
          break
      }
    }

    return track.id > 0 ? track : null
  }

  private parseVideoData(data: Uint8Array): { width: number, height: number, displayWidth?: number, displayHeight?: number } {
    const result = { width: 0, height: 0, displayWidth: undefined as number | undefined, displayHeight: undefined as number | undefined }
    let offset = 0

    while (offset < data.length) {
      const id = readEbmlId(data, offset)
      if (!id) break
      offset += id.length

      const size = readEbmlSize(data, offset)
      if (!size) break
      offset += size.length

      const elementData = data.subarray(offset, offset + size.size)

      switch (id.id) {
        case EBML_IDS.PixelWidth:
          result.width = readEbmlUint(elementData)
          break
        case EBML_IDS.PixelHeight:
          result.height = readEbmlUint(elementData)
          break
        case EBML_IDS.DisplayWidth:
          result.displayWidth = readEbmlUint(elementData)
          break
        case EBML_IDS.DisplayHeight:
          result.displayHeight = readEbmlUint(elementData)
          break
      }

      offset += size.size
    }

    return result
  }

  private parseAudioData(data: Uint8Array): { sampleRate: number, channels: number, bitDepth?: number } {
    const result = { sampleRate: 0, channels: 0, bitDepth: undefined as number | undefined }
    let offset = 0

    while (offset < data.length) {
      const id = readEbmlId(data, offset)
      if (!id) break
      offset += id.length

      const size = readEbmlSize(data, offset)
      if (!size) break
      offset += size.length

      const elementData = data.subarray(offset, offset + size.size)

      switch (id.id) {
        case EBML_IDS.SamplingFrequency:
          result.sampleRate = Math.round(readEbmlFloat(elementData))
          break
        case EBML_IDS.Channels:
          result.channels = readEbmlUint(elementData)
          break
        case EBML_IDS.BitDepth:
          result.bitDepth = readEbmlUint(elementData)
          break
      }

      offset += size.size
    }

    return result
  }

  private async buildTracks(): Promise<void> {
    this._tracks = []

    for (let i = 0; i < this.trackInfos.length; i++) {
      const info = this.trackInfos[i]

      if (info.type === TRACK_TYPES.VIDEO && info.video) {
        const track: VideoTrack = {
          type: 'video',
          id: info.id,
          index: i,
          codec: this.getVideoCodec(info.codecId),
          width: info.video.width,
          height: info.video.height,
          displayWidth: info.video.displayWidth,
          displayHeight: info.video.displayHeight,
          frameRate: info.defaultDuration ? 1000000000 / info.defaultDuration : undefined,
          language: info.language,
          title: info.name,
          isDefault: info.isDefault,
          codecDescription: info.codecPrivate,
        }
        this._tracks.push(track)
      }
      else if (info.type === TRACK_TYPES.AUDIO && info.audio) {
        const track: AudioTrack = {
          type: 'audio',
          id: info.id,
          index: i,
          codec: this.getAudioCodec(info.codecId),
          sampleRate: info.audio.sampleRate,
          channels: info.audio.channels,
          bitsPerSample: info.audio.bitDepth,
          language: info.language,
          title: info.name,
          isDefault: info.isDefault,
          codecDescription: info.codecPrivate,
        }
        this._tracks.push(track)
      }
    }

    this._duration = this.duration * this.timestampScale / 1000000000
    this._metadata = {}
  }

  private getVideoCodec(codecId: string): VideoCodec {
    switch (codecId) {
      case CODEC_IDS.VP8: return 'vp8'
      case CODEC_IDS.VP9: return 'vp9'
      case CODEC_IDS.AV1: return 'av1'
      case CODEC_IDS.H264: return 'h264'
      case CODEC_IDS.H265: return 'h265'
      case CODEC_IDS.THEORA: return 'theora'
      default: return 'unknown'
    }
  }

  private getAudioCodec(codecId: string): AudioCodec {
    switch (codecId) {
      case CODEC_IDS.OPUS: return 'opus'
      case CODEC_IDS.VORBIS: return 'vorbis'
      case CODEC_IDS.AAC: return 'aac'
      case CODEC_IDS.MP3: return 'mp3'
      case CODEC_IDS.FLAC: return 'flac'
      case CODEC_IDS.PCM_INT_LE: return 'pcm_s16le'
      case CODEC_IDS.PCM_INT_BE: return 'pcm_s16be'
      default: return 'unknown'
    }
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    while (true) {
      if (this.currentBlockIndex < this.currentClusterBlocks.length) {
        const block = this.currentClusterBlocks[this.currentBlockIndex]
        this.currentBlockIndex++

        if (block.trackNumber === trackId) {
          return {
            data: block.data,
            timestamp: block.timestamp * this.timestampScale / 1000000000,
            duration: block.duration ? block.duration * this.timestampScale / 1000000000 : undefined,
            isKeyframe: block.isKeyframe,
            trackId,
          }
        }
        continue
      }

      if (this.currentClusterIndex >= this.clusters.length) {
        return null
      }

      await this.loadCluster(this.currentClusterIndex)
      this.currentClusterIndex++
      this.currentBlockIndex = 0
    }
  }

  private async loadCluster(index: number): Promise<void> {
    const cluster = this.clusters[index]
    this.reader.position = cluster.offset

    const element = await this.readEbmlElement()
    if (!element || element.id !== EBML_IDS.Cluster) return

    const clusterEnd = this.reader.position + element.size
    let clusterTimestamp = 0

    this.currentClusterBlocks = []

    while (this.reader.position < clusterEnd) {
      const childElement = await this.readEbmlElement()
      if (!childElement) break

      if (childElement.id === EBML_IDS.Timestamp) {
        const data = await this.reader.readBytes(childElement.size)
        if (data) {
          clusterTimestamp = readEbmlUint(data)
          cluster.timestamp = clusterTimestamp
        }
      }
      else if (childElement.id === EBML_IDS.SimpleBlock) {
        const data = await this.reader.readBytes(childElement.size)
        if (data) {
          const block = this.parseSimpleBlock(data, clusterTimestamp)
          if (block) this.currentClusterBlocks.push(block)
        }
      }
      else if (childElement.id === EBML_IDS.BlockGroup) {
        const blockGroupEnd = this.reader.position + childElement.size
        let blockData: Uint8Array | null = null
        let blockDuration: number | undefined

        while (this.reader.position < blockGroupEnd) {
          const bgElement = await this.readEbmlElement()
          if (!bgElement) break

          if (bgElement.id === EBML_IDS.Block) {
            blockData = await this.reader.readBytes(bgElement.size)
          }
          else if (bgElement.id === EBML_IDS.BlockDuration) {
            const durData = await this.reader.readBytes(bgElement.size)
            if (durData) blockDuration = readEbmlUint(durData)
          }
          else {
            await this.reader.skip(bgElement.size)
          }
        }

        if (blockData) {
          const block = this.parseBlock(blockData, clusterTimestamp, false)
          if (block) {
            block.duration = blockDuration
            this.currentClusterBlocks.push(block)
          }
        }
      }
      else {
        await this.reader.skip(childElement.size)
      }
    }
  }

  private parseSimpleBlock(data: Uint8Array, clusterTimestamp: number): BlockInfo | null {
    const trackNumSize = readEbmlSize(data, 0)
    if (!trackNumSize) return null

    const trackNumber = trackNumSize.size
    let offset = trackNumSize.length

    if (offset + 3 > data.length) return null

    const timecode = (data[offset] << 8) | data[offset + 1]
    offset += 2

    const flags = data[offset]
    offset++

    const isKeyframe = (flags & 0x80) !== 0
    const _isInvisible = (flags & 0x08) !== 0
    const _lacing = (flags >> 1) & 0x03

    const frameData = data.subarray(offset)

    return {
      trackNumber,
      timestamp: clusterTimestamp + timecode,
      data: frameData,
      isKeyframe,
    }
  }

  private parseBlock(data: Uint8Array, clusterTimestamp: number, isKeyframe: boolean): BlockInfo | null {
    const result = this.parseSimpleBlock(data, clusterTimestamp)
    if (result) {
      result.isKeyframe = isKeyframe
    }
    return result
  }

  async seek(timeInSeconds: number): Promise<void> {
    const targetTimestamp = Math.round(timeInSeconds * 1000000000 / this.timestampScale)

    let targetCluster = 0
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      if (this.clusters[i].timestamp <= targetTimestamp) {
        targetCluster = i
        break
      }
    }

    this.currentClusterIndex = targetCluster
    this.currentBlockIndex = 0
    this.currentClusterBlocks = []
  }
}
