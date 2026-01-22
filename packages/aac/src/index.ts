/**
 * AAC/ADTS codec package for ts-videos
 */

import type { Source, Target, AudioTrack, EncodedPacket } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-videos'

const ADTS_SYNC = 0xFFF
const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

interface AdtsHeader {
  profile: number
  sampleRateIndex: number
  sampleRate: number
  channels: number
  frameLength: number
  hasCRC: boolean
}

function parseAdtsHeader(data: Uint8Array, offset: number): AdtsHeader | null {
  if (offset + 7 > data.length) return null

  const sync = ((data[offset] << 4) | (data[offset + 1] >> 4))
  if (sync !== ADTS_SYNC) return null

  const hasCRC = (data[offset + 1] & 0x01) === 0
  const profile = ((data[offset + 2] >> 6) & 0x03) + 1
  const sampleRateIndex = (data[offset + 2] >> 2) & 0x0F
  const channels = ((data[offset + 2] & 0x01) << 2) | ((data[offset + 3] >> 6) & 0x03)
  const frameLength = ((data[offset + 3] & 0x03) << 11) | (data[offset + 4] << 3) | ((data[offset + 5] >> 5) & 0x07)

  if (sampleRateIndex >= AAC_SAMPLE_RATES.length) return null

  return {
    profile,
    sampleRateIndex,
    sampleRate: AAC_SAMPLE_RATES[sampleRateIndex],
    channels: channels === 0 ? 2 : channels,
    frameLength,
    hasCRC,
  }
}

interface AacFrame {
  offset: number
  size: number
  timestamp: number
  header: AdtsHeader
}

export class AacDemuxer extends Demuxer {
  private frames: AacFrame[] = []
  private currentFrameIndex = 0
  private firstHeader: AdtsHeader | null = null
  private _initialized = false

  get formatName(): string {
    return 'aac'
  }

  get mimeType(): string {
    return 'audio/aac'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.scanFrames()
    await this.buildTrack()
  }

  private async scanFrames(): Promise<void> {
    this.reader.position = 0
    let timestamp = 0

    const fileSize = await this.reader.getSize()
    const maxPos = fileSize ?? Number.MAX_SAFE_INTEGER

    while (this.reader.position < maxPos - 7) {
      const pos = this.reader.position
      const headerBytes = await this.reader.readBytes(7)
      if (!headerBytes) break

      const header = parseAdtsHeader(headerBytes, 0)
      if (!header) {
        this.reader.position = pos + 1
        continue
      }

      if (!this.firstHeader) {
        this.firstHeader = header
      }

      const duration = 1024 / header.sampleRate

      this.frames.push({
        offset: pos,
        size: header.frameLength,
        timestamp,
        header,
      })

      timestamp += duration
      this.reader.position = pos + header.frameLength
    }
  }

  private async buildTrack(): Promise<void> {
    if (!this.firstHeader) {
      this._tracks = []
      this._duration = 0
      this._metadata = {}
      return
    }

    const codecDescription = new Uint8Array([
      (this.firstHeader.profile << 3) | (this.firstHeader.sampleRateIndex >> 1),
      ((this.firstHeader.sampleRateIndex & 0x01) << 7) | (this.firstHeader.channels << 3),
    ])

    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: 'aac',
      sampleRate: this.firstHeader.sampleRate,
      channels: this.firstHeader.channels,
      isDefault: true,
      codecDescription,
    }

    this._tracks = [track]
    this._duration = this.frames.length > 0
      ? this.frames[this.frames.length - 1].timestamp + (1024 / this.firstHeader.sampleRate)
      : 0
    this._metadata = {}
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || this.currentFrameIndex >= this.frames.length) {
      return null
    }

    const frame = this.frames[this.currentFrameIndex]
    this.currentFrameIndex++

    this.reader.position = frame.offset
    const data = await this.reader.readBytes(frame.size)
    if (!data) return null

    const headerSize = frame.header.hasCRC ? 9 : 7
    const rawData = data.subarray(headerSize)

    return {
      data: rawData,
      timestamp: frame.timestamp,
      duration: 1024 / frame.header.sampleRate,
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

export class AacMuxer extends Muxer {
  private frames: Uint8Array[] = []
  private sampleRate = 44100
  private channels = 2
  private profile = 2

  get formatName(): string {
    return 'aac'
  }

  get mimeType(): string {
    return 'audio/aac'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number, codecDescription?: Uint8Array } }): void {
    if (track.type === 'audio') {
      this.sampleRate = track.config.sampleRate
      this.channels = track.config.channels
      if (track.config.codecDescription && track.config.codecDescription.length >= 2) {
        this.profile = (track.config.codecDescription[0] >> 3) & 0x1F
      }
    }
  }

  protected async writeHeader(): Promise<void> {}

  protected async writeVideoPacket(): Promise<void> {
    throw new Error('AAC does not support video')
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    const sampleRateIndex = AAC_SAMPLE_RATES.indexOf(this.sampleRate)
    const frameLength = packet.data.byteLength + 7

    const header = new Uint8Array([
      0xFF,
      0xF1,
      ((this.profile - 1) << 6) | (sampleRateIndex << 2) | ((this.channels >> 2) & 0x01),
      ((this.channels & 0x03) << 6) | ((frameLength >> 11) & 0x03),
      (frameLength >> 3) & 0xFF,
      ((frameLength & 0x07) << 5) | 0x1F,
      0xFC,
    ])

    const frame = new Uint8Array(frameLength)
    frame.set(header, 0)
    frame.set(packet.data, 7)

    this.frames.push(frame)
  }

  protected async writeSubtitlePacket(): Promise<void> {
    throw new Error('AAC does not support subtitles')
  }

  protected async writeTrailer(): Promise<void> {
    for (const frame of this.frames) {
      await this.writer.writeBytes(frame)
    }
  }
}

export class AacInputFormat extends InputFormat {
  get name(): string { return 'aac' }
  get mimeType(): string { return 'audio/aac' }
  get extensions(): string[] { return ['aac', 'adts'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const header = await reader.readBytes(7)
    if (!header) return false
    return parseAdtsHeader(header, 0) !== null
  }

  createDemuxer(source: Source): Demuxer {
    return new AacDemuxer(source)
  }
}

export class AacOutputFormat extends OutputFormat {
  get name(): string { return 'aac' }
  get mimeType(): string { return 'audio/aac' }
  get extension(): string { return 'aac' }

  createMuxer(target: Target): Muxer {
    return new AacMuxer(target)
  }
}

export const AAC = new AacInputFormat()
export const AAC_OUTPUT = new AacOutputFormat()
