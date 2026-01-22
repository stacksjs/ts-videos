/**
 * FLAC codec package for ts-videos
 */

import type { Source, Target, AudioTrack, EncodedPacket } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-videos'

const FLAC_MARKER = 0x664C6143
const STREAMINFO_TYPE = 0
const PADDING_TYPE = 1
const APPLICATION_TYPE = 2
const SEEKTABLE_TYPE = 3
const VORBIS_COMMENT_TYPE = 4
const CUESHEET_TYPE = 5
const PICTURE_TYPE = 6

interface FlacStreamInfo {
  minBlockSize: number
  maxBlockSize: number
  minFrameSize: number
  maxFrameSize: number
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: bigint
  md5: Uint8Array
}

interface FlacFrame {
  offset: number
  size: number
  timestamp: number
  blockSize: number
}

function parseStreamInfo(data: Uint8Array): FlacStreamInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const minBlockSize = view.getUint16(0, false)
  const maxBlockSize = view.getUint16(2, false)
  const minFrameSize = (view.getUint8(4) << 16) | (view.getUint8(5) << 8) | view.getUint8(6)
  const maxFrameSize = (view.getUint8(7) << 16) | (view.getUint8(8) << 8) | view.getUint8(9)

  const sampleRateHi = view.getUint16(10, false)
  const byte12 = view.getUint8(12)
  const sampleRate = (sampleRateHi << 4) | (byte12 >> 4)

  const channels = ((byte12 >> 1) & 0x07) + 1
  const bitsPerSample = ((byte12 & 0x01) << 4) | (view.getUint8(13) >> 4) + 1

  const totalSamplesHi = view.getUint8(13) & 0x0F
  const totalSamplesLo = view.getUint32(14, false)
  const totalSamples = (BigInt(totalSamplesHi) << 32n) | BigInt(totalSamplesLo)

  const md5 = data.subarray(18, 34)

  return {
    minBlockSize,
    maxBlockSize,
    minFrameSize,
    maxFrameSize,
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples,
    md5,
  }
}

export class FlacDemuxer extends Demuxer {
  private streamInfo: FlacStreamInfo | null = null
  private frames: FlacFrame[] = []
  private currentFrameIndex = 0
  private dataStart = 0
  private _initialized = false

  get formatName(): string {
    return 'flac'
  }

  get mimeType(): string {
    return 'audio/flac'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    this.reader.position = 0

    const marker = await this.reader.readU32BE()
    if (marker !== FLAC_MARKER) {
      throw new Error('Not a FLAC file')
    }

    let isLast = false
    while (!isLast) {
      const header = await this.reader.readU8()
      if (header === null) break

      isLast = (header & 0x80) !== 0
      const blockType = header & 0x7F
      const blockSize = await this.reader.readU24BE()
      if (blockSize === null) break

      if (blockType === STREAMINFO_TYPE) {
        const data = await this.reader.readBytes(blockSize)
        if (data) this.streamInfo = parseStreamInfo(data)
      }
      else {
        await this.reader.skip(blockSize)
      }
    }

    this.dataStart = this.reader.position

    if (!this.streamInfo) {
      throw new Error('No STREAMINFO block found')
    }

    await this.scanFrames()
    await this.buildTrack()
  }

  private async scanFrames(): Promise<void> {
    if (!this.streamInfo) return

    const fileSize = await this.reader.getSize()
    if (!fileSize) return

    this.reader.position = this.dataStart
    let timestamp = 0
    let samplePosition = 0

    while (this.reader.position < fileSize - 2) {
      const pos = this.reader.position
      const sync = await this.reader.readU16BE()
      if (sync === null) break

      if ((sync & 0xFFFE) !== 0xFFF8) {
        this.reader.position = pos + 1
        continue
      }

      this.reader.position = pos

      const headerBytes = await this.reader.readBytes(16)
      if (!headerBytes) break

      let blockSize = 0
      const blockSizeCode = (headerBytes[2] >> 4) & 0x0F

      if (blockSizeCode === 0) blockSize = 0
      else if (blockSizeCode === 1) blockSize = 192
      else if (blockSizeCode >= 2 && blockSizeCode <= 5) blockSize = 576 * (1 << (blockSizeCode - 2))
      else if (blockSizeCode === 6) blockSize = headerBytes[4] + 1
      else if (blockSizeCode === 7) blockSize = ((headerBytes[4] << 8) | headerBytes[5]) + 1
      else blockSize = 256 * (1 << (blockSizeCode - 8))

      if (blockSize === 0) blockSize = this.streamInfo.maxBlockSize

      let frameEnd = pos + this.streamInfo.maxFrameSize
      if (frameEnd > fileSize) frameEnd = fileSize

      this.reader.position = pos + 5
      while (this.reader.position < frameEnd - 2) {
        const nextSync = await this.reader.readU16BE()
        if (nextSync === null) break
        if ((nextSync & 0xFFFE) === 0xFFF8) {
          frameEnd = this.reader.position - 2
          break
        }
        this.reader.position--
      }

      const frameSize = frameEnd - pos

      this.frames.push({
        offset: pos,
        size: frameSize,
        timestamp,
        blockSize,
      })

      timestamp = samplePosition / this.streamInfo.sampleRate
      samplePosition += blockSize

      this.reader.position = frameEnd
    }
  }

  private async buildTrack(): Promise<void> {
    if (!this.streamInfo) {
      this._tracks = []
      this._duration = 0
      this._metadata = {}
      return
    }

    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: 'flac',
      sampleRate: this.streamInfo.sampleRate,
      channels: this.streamInfo.channels,
      bitsPerSample: this.streamInfo.bitsPerSample,
      isDefault: true,
    }

    this._tracks = [track]
    this._duration = Number(this.streamInfo.totalSamples) / this.streamInfo.sampleRate
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

    const duration = this.streamInfo ? frame.blockSize / this.streamInfo.sampleRate : 0

    return {
      data,
      timestamp: frame.timestamp,
      duration,
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

export class FlacMuxer extends Muxer {
  private frames: Uint8Array[] = []
  private streamInfo: Uint8Array | null = null

  get formatName(): string {
    return 'flac'
  }

  get mimeType(): string {
    return 'audio/flac'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number, bitsPerSample?: number, codecDescription?: Uint8Array } }): void {
    if (track.type === 'audio' && track.config.codecDescription) {
      this.streamInfo = track.config.codecDescription
    }
  }

  protected async writeHeader(): Promise<void> {}

  protected async writeVideoPacket(): Promise<void> {
    throw new Error('FLAC does not support video')
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.frames.push(packet.data)
  }

  protected async writeSubtitlePacket(): Promise<void> {
    throw new Error('FLAC does not support subtitles')
  }

  protected async writeTrailer(): Promise<void> {
    await this.writer.writeU32BE(FLAC_MARKER)

    if (this.streamInfo) {
      await this.writer.writeU8(0x80 | STREAMINFO_TYPE)
      await this.writer.writeU24BE(this.streamInfo.byteLength)
      await this.writer.writeBytes(this.streamInfo)
    }

    for (const frame of this.frames) {
      await this.writer.writeBytes(frame)
    }
  }
}

export class FlacInputFormat extends InputFormat {
  get name(): string { return 'flac' }
  get mimeType(): string { return 'audio/flac' }
  get extensions(): string[] { return ['flac'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const marker = await reader.readU32BE()
    return marker === FLAC_MARKER
  }

  createDemuxer(source: Source): Demuxer {
    return new FlacDemuxer(source)
  }
}

export class FlacOutputFormat extends OutputFormat {
  get name(): string { return 'flac' }
  get mimeType(): string { return 'audio/flac' }
  get extension(): string { return 'flac' }

  createMuxer(target: Target): Muxer {
    return new FlacMuxer(target)
  }
}

export const FLAC = new FlacInputFormat()
export const FLAC_OUTPUT = new FlacOutputFormat()
