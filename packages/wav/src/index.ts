/**
 * WAV/RIFF codec package for ts-videos
 */

import type { Source, Target, AudioTrack, EncodedPacket, AudioCodec } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader, Writer } from 'ts-videos'

const RIFF_HEADER = 0x52494646
const WAVE_FORMAT = 0x57415645
const FMT_CHUNK = 0x666D7420
const DATA_CHUNK = 0x64617461

interface WavFormat {
  audioFormat: number
  channels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitsPerSample: number
}

function getCodecFromFormat(format: number, bits: number): AudioCodec {
  if (format === 1) {
    if (bits === 16) return 'pcm_s16le'
    if (bits === 24) return 'pcm_s24le'
    if (bits === 32) return 'pcm_s32le'
    return 'pcm_s16le'
  }
  if (format === 3) return 'pcm_f32le'
  if (format === 6) return 'pcm_alaw'
  if (format === 7) return 'pcm_mulaw'
  return 'unknown'
}

export class WavDemuxer extends Demuxer {
  private format: WavFormat | null = null
  private dataOffset = 0
  private dataSize = 0
  private currentOffset = 0
  private chunkSize = 4096
  private _initialized = false

  get formatName(): string {
    return 'wav'
  }

  get mimeType(): string {
    return 'audio/wav'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    this.reader.position = 0

    const riff = await this.reader.readU32BE()
    if (riff !== RIFF_HEADER) throw new Error('Not a RIFF file')

    await this.reader.skip(4)

    const wave = await this.reader.readU32BE()
    if (wave !== WAVE_FORMAT) throw new Error('Not a WAVE file')

    while (true) {
      const chunkId = await this.reader.readU32BE()
      const chunkSize = await this.reader.readU32LE()
      if (chunkId === null || chunkSize === null) break

      if (chunkId === FMT_CHUNK) {
        this.format = {
          audioFormat: (await this.reader.readU16LE()) ?? 1,
          channels: (await this.reader.readU16LE()) ?? 2,
          sampleRate: (await this.reader.readU32LE()) ?? 44100,
          byteRate: (await this.reader.readU32LE()) ?? 176400,
          blockAlign: (await this.reader.readU16LE()) ?? 4,
          bitsPerSample: (await this.reader.readU16LE()) ?? 16,
        }
        if (chunkSize > 16) {
          await this.reader.skip(chunkSize - 16)
        }
      }
      else if (chunkId === DATA_CHUNK) {
        this.dataOffset = this.reader.position
        this.dataSize = chunkSize
        break
      }
      else {
        await this.reader.skip(chunkSize)
      }
    }

    if (!this.format) throw new Error('No fmt chunk found')

    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: getCodecFromFormat(this.format.audioFormat, this.format.bitsPerSample),
      sampleRate: this.format.sampleRate,
      channels: this.format.channels,
      bitsPerSample: this.format.bitsPerSample,
      bitrate: this.format.byteRate * 8,
      isDefault: true,
    }

    this._tracks = [track]
    this._duration = this.dataSize / this.format.byteRate
    this._metadata = {}
    this.currentOffset = 0
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || !this.format || this.currentOffset >= this.dataSize) {
      return null
    }

    const remaining = this.dataSize - this.currentOffset
    const toRead = Math.min(this.chunkSize, remaining)

    this.reader.position = this.dataOffset + this.currentOffset
    const data = await this.reader.readBytes(toRead)
    if (!data) return null

    const timestamp = this.currentOffset / this.format.byteRate
    const duration = toRead / this.format.byteRate

    this.currentOffset += toRead

    return {
      data,
      timestamp,
      duration,
      isKeyframe: true,
      trackId: 1,
    }
  }

  async seek(timeInSeconds: number): Promise<void> {
    if (!this.format) return
    const byteOffset = Math.floor(timeInSeconds * this.format.byteRate)
    const aligned = byteOffset - (byteOffset % this.format.blockAlign)
    this.currentOffset = Math.max(0, Math.min(aligned, this.dataSize))
  }
}

export class WavMuxer extends Muxer {
  private samples: Uint8Array[] = []
  private format: WavFormat | null = null

  get formatName(): string {
    return 'wav'
  }

  get mimeType(): string {
    return 'audio/wav'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number, bitsPerSample?: number } }): void {
    if (track.type === 'audio') {
      const bits = track.config.bitsPerSample ?? 16
      this.format = {
        audioFormat: 1,
        channels: track.config.channels,
        sampleRate: track.config.sampleRate,
        byteRate: track.config.sampleRate * track.config.channels * (bits / 8),
        blockAlign: track.config.channels * (bits / 8),
        bitsPerSample: bits,
      }
    }
  }

  protected async writeHeader(): Promise<void> {}

  protected async writeVideoPacket(): Promise<void> {
    throw new Error('WAV does not support video')
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.samples.push(packet.data)
  }

  protected async writeSubtitlePacket(): Promise<void> {
    throw new Error('WAV does not support subtitles')
  }

  protected async writeTrailer(): Promise<void> {
    if (!this.format) throw new Error('No audio track configured')

    const dataSize = this.samples.reduce((sum, s) => sum + s.byteLength, 0)
    const fileSize = 36 + dataSize

    await this.writer.writeU32BE(RIFF_HEADER)
    await this.writer.writeU32LE(fileSize)
    await this.writer.writeU32BE(WAVE_FORMAT)

    await this.writer.writeU32BE(FMT_CHUNK)
    await this.writer.writeU32LE(16)
    await this.writer.writeU16LE(this.format.audioFormat)
    await this.writer.writeU16LE(this.format.channels)
    await this.writer.writeU32LE(this.format.sampleRate)
    await this.writer.writeU32LE(this.format.byteRate)
    await this.writer.writeU16LE(this.format.blockAlign)
    await this.writer.writeU16LE(this.format.bitsPerSample)

    await this.writer.writeU32BE(DATA_CHUNK)
    await this.writer.writeU32LE(dataSize)

    for (const sample of this.samples) {
      await this.writer.writeBytes(sample)
    }
  }
}

export class WavInputFormat extends InputFormat {
  get name(): string { return 'wav' }
  get mimeType(): string { return 'audio/wav' }
  get extensions(): string[] { return ['wav', 'wave'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const riff = await reader.readU32BE()
    if (riff !== RIFF_HEADER) return false
    await reader.skip(4)
    const wave = await reader.readU32BE()
    return wave === WAVE_FORMAT
  }

  createDemuxer(source: Source): Demuxer {
    return new WavDemuxer(source)
  }
}

export class WavOutputFormat extends OutputFormat {
  get name(): string { return 'wav' }
  get mimeType(): string { return 'audio/wav' }
  get extension(): string { return 'wav' }

  createMuxer(target: Target): Muxer {
    return new WavMuxer(target)
  }
}

export const WAV = new WavInputFormat()
export const WAV_OUTPUT = new WavOutputFormat()
