/**
 * MP3 codec package for ts-videos
 */

import type { Source, Target, AudioTrack, Metadata, EncodedPacket } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader, Writer } from 'ts-videos'

const MP3_SYNC_WORD = 0xFFE0
const MPEG_VERSIONS = [2.5, 0, 2, 1] as const
const LAYERS = [0, 3, 2, 1] as const

const BITRATES: Record<string, number[]> = {
  'V1L1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  'V1L2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  'V1L3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  'V2L1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
  'V2L2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  'V2L3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}

const SAMPLE_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000, 0],
  2: [22050, 24000, 16000, 0],
  2.5: [11025, 12000, 8000, 0],
}

const SAMPLES_PER_FRAME: Record<string, number> = {
  'V1L1': 384,
  'V1L2': 1152,
  'V1L3': 1152,
  'V2L1': 384,
  'V2L2': 1152,
  'V2L3': 576,
}

interface Mp3FrameHeader {
  version: number
  layer: number
  hasCRC: boolean
  bitrate: number
  sampleRate: number
  padding: boolean
  channels: number
  frameSize: number
  samplesPerFrame: number
  duration: number
}

interface Mp3Frame {
  header: Mp3FrameHeader
  offset: number
  data: Uint8Array
  timestamp: number
}

function parseFrameHeader(data: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset + 4 > data.length) return null

  const header = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

  if ((header & 0xFFE00000) !== 0xFFE00000) return null

  const versionBits = (header >> 19) & 0x03
  const layerBits = (header >> 17) & 0x03
  const protectionBit = (header >> 16) & 0x01
  const bitrateBits = (header >> 12) & 0x0F
  const sampleRateBits = (header >> 10) & 0x03
  const paddingBit = (header >> 9) & 0x01
  const channelBits = (header >> 6) & 0x03

  const version = MPEG_VERSIONS[versionBits]
  const layer = LAYERS[layerBits]

  if (version === 0 || layer === 0) return null

  const versionKey = version === 1 ? 'V1' : 'V2'
  const bitrateKey = `${versionKey}L${layer}`
  const bitrate = BITRATES[bitrateKey]?.[bitrateBits]
  const sampleRate = SAMPLE_RATES[version]?.[sampleRateBits]

  if (!bitrate || !sampleRate) return null

  const samplesPerFrame = SAMPLES_PER_FRAME[bitrateKey] ?? 1152
  const hasCRC = protectionBit === 0
  const padding = paddingBit === 1
  const channels = channelBits === 3 ? 1 : 2

  let frameSize: number
  if (layer === 1) {
    frameSize = Math.floor((12 * bitrate * 1000 / sampleRate + (padding ? 1 : 0)) * 4)
  }
  else {
    const slotSize = layer === 3 ? 1 : 1
    frameSize = Math.floor((samplesPerFrame / 8) * bitrate * 1000 / sampleRate + (padding ? slotSize : 0))
  }

  const duration = samplesPerFrame / sampleRate

  return {
    version,
    layer,
    hasCRC,
    bitrate: bitrate * 1000,
    sampleRate,
    padding,
    channels,
    frameSize,
    samplesPerFrame,
    duration,
  }
}

function parseID3v2Size(data: Uint8Array, offset: number): number {
  return ((data[offset] & 0x7F) << 21) |
         ((data[offset + 1] & 0x7F) << 14) |
         ((data[offset + 2] & 0x7F) << 7) |
         (data[offset + 3] & 0x7F)
}

export class Mp3Demuxer extends Demuxer {
  private frames: Mp3Frame[] = []
  private currentFrameIndex = 0
  private firstHeader: Mp3FrameHeader | null = null
  private id3v2Size = 0
  private _initialized = false

  get formatName(): string {
    return 'mp3'
  }

  get mimeType(): string {
    return 'audio/mpeg'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.skipID3v2()
    await this.scanFrames()
    await this.buildTrack()
  }

  private async skipID3v2(): Promise<void> {
    this.reader.position = 0
    const header = await this.reader.readBytes(10)
    if (!header) return

    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
      this.id3v2Size = parseID3v2Size(header, 6) + 10
      if (header[5] & 0x10) {
        this.id3v2Size += 10
      }
    }
  }

  private async scanFrames(): Promise<void> {
    this.reader.position = this.id3v2Size
    let timestamp = 0

    const fileSize = await this.reader.getSize()
    const maxPos = fileSize ?? Number.MAX_SAFE_INTEGER

    while (this.reader.position < maxPos - 4) {
      const pos = this.reader.position
      const headerBytes = await this.reader.readBytes(4)
      if (!headerBytes) break

      const header = parseFrameHeader(headerBytes, 0)
      if (!header) {
        this.reader.position = pos + 1
        continue
      }

      if (!this.firstHeader) {
        this.firstHeader = header
      }

      this.reader.position = pos
      const frameData = await this.reader.readBytes(header.frameSize)
      if (!frameData) break

      this.frames.push({
        header,
        offset: pos,
        data: frameData,
        timestamp,
      })

      timestamp += header.duration
    }
  }

  private async buildTrack(): Promise<void> {
    if (!this.firstHeader) {
      this._tracks = []
      this._duration = 0
      this._metadata = {}
      return
    }

    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: 'mp3',
      sampleRate: this.firstHeader.sampleRate,
      channels: this.firstHeader.channels,
      bitrate: this.firstHeader.bitrate,
      isDefault: true,
    }

    this._tracks = [track]
    this._duration = this.frames.length > 0
      ? this.frames[this.frames.length - 1].timestamp + this.frames[this.frames.length - 1].header.duration
      : 0
    this._metadata = {}
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || this.currentFrameIndex >= this.frames.length) {
      return null
    }

    const frame = this.frames[this.currentFrameIndex]
    this.currentFrameIndex++

    return {
      data: frame.data,
      timestamp: frame.timestamp,
      duration: frame.header.duration,
      isKeyframe: true,
      trackId: 1,
    }
  }

  async seek(timeInSeconds: number): Promise<void> {
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i].timestamp >= timeInSeconds) {
        this.currentFrameIndex = Math.max(0, i - 1)
        return
      }
    }
    this.currentFrameIndex = this.frames.length
  }
}

export class Mp3Muxer extends Muxer {
  private frames: Uint8Array[] = []

  get formatName(): string {
    return 'mp3'
  }

  get mimeType(): string {
    return 'audio/mpeg'
  }

  protected async writeHeader(): Promise<void> {
    // No header needed for raw MP3
  }

  protected async writeVideoPacket(): Promise<void> {
    throw new Error('MP3 does not support video')
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.frames.push(packet.data)
  }

  protected async writeSubtitlePacket(): Promise<void> {
    throw new Error('MP3 does not support subtitles')
  }

  protected async writeTrailer(): Promise<void> {
    for (const frame of this.frames) {
      await this.writer.writeBytes(frame)
    }
  }
}

export class Mp3InputFormat extends InputFormat {
  get name(): string {
    return 'mp3'
  }

  get mimeType(): string {
    return 'audio/mpeg'
  }

  get extensions(): string[] {
    return ['mp3']
  }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0

    const header = await reader.readBytes(10)
    if (!header) return false

    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
      return true
    }

    if ((header[0] === 0xFF) && ((header[1] & 0xE0) === 0xE0)) {
      return parseFrameHeader(header, 0) !== null
    }

    return false
  }

  createDemuxer(source: Source): Demuxer {
    return new Mp3Demuxer(source)
  }
}

export class Mp3OutputFormat extends OutputFormat {
  get name(): string {
    return 'mp3'
  }

  get mimeType(): string {
    return 'audio/mpeg'
  }

  get extension(): string {
    return 'mp3'
  }

  createMuxer(target: Target): Muxer {
    return new Mp3Muxer(target)
  }
}

export const MP3 = new Mp3InputFormat()
export const MP3_OUTPUT = new Mp3OutputFormat()
