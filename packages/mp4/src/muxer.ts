/**
 * MP4/MOV muxer implementation
 */

import type { Target, VideoTrackConfig, AudioTrackConfig, SubtitleTrackConfig, EncodedPacket } from 'ts-videos'
import { Muxer, Writer } from 'ts-videos'
import type { OutputVideoTrack, OutputAudioTrack, OutputSubtitleTrack } from 'ts-videos'
import { writeFourCC, encodeLanguageCode, TIMESCALE_1904_TO_1970 } from './boxes'

const GLOBAL_TIMESCALE = 1000

interface Mp4TrackData {
  track: OutputVideoTrack | OutputAudioTrack | OutputSubtitleTrack
  timescale: number
  samples: Mp4Sample[]
  chunkOffsets: number[]
  currentChunk: { samples: Mp4Sample[], offset: number } | null
}

interface Mp4Sample {
  data: Uint8Array
  timestamp: number
  duration: number
  isKeyframe: boolean
  compositionTimeOffset: number
  size: number
}

export interface Mp4MuxerOptions {
  fastStart?: boolean
  fragmented?: boolean
  brand?: string
}

export class Mp4Muxer extends Muxer {
  private trackData: Map<number, Mp4TrackData> = new Map()
  private options: Mp4MuxerOptions
  private mdatStart = 0
  private mdatSize = 0

  constructor(target: Target, options: Mp4MuxerOptions = {}) {
    super(target)
    this.options = {
      fastStart: options.fastStart ?? true,
      fragmented: options.fragmented ?? false,
      brand: options.brand ?? 'isom',
    }
  }

  get formatName(): string {
    return 'mp4'
  }

  get mimeType(): string {
    return 'video/mp4'
  }

  protected onTrackAdded(track: OutputVideoTrack | OutputAudioTrack | OutputSubtitleTrack): void {
    const timescale = track.type === 'video'
      ? Math.round((track.config.frameRate ?? 30) * 1000)
      : track.type === 'audio'
        ? track.config.sampleRate
        : 1000

    this.trackData.set(track.id, {
      track,
      timescale,
      samples: [],
      chunkOffsets: [],
      currentChunk: null,
    })
  }

  protected async writeHeader(): Promise<void> {
    await this.writeFtyp()

    if (!this.options.fastStart) {
      this.mdatStart = this.writer.position
      await this.writeMdatHeader(0)
    }
  }

  private async writeFtyp(): Promise<void> {
    const brands = [this.options.brand!, 'iso2', 'avc1', 'mp41']
    const size = 8 + 8 + brands.length * 4

    await this.writer.writeU32BE(size)
    await this.writer.writeFourCC('ftyp')
    await this.writer.writeFourCC(this.options.brand!)
    await this.writer.writeU32BE(0x200)

    for (const brand of brands) {
      await this.writer.writeFourCC(brand)
    }
  }

  private async writeMdatHeader(size: number): Promise<void> {
    if (size > 0xFFFFFFFF - 8) {
      await this.writer.writeU32BE(1)
      await this.writer.writeFourCC('mdat')
      await this.writer.writeU64BE(BigInt(size + 16))
    }
    else {
      await this.writer.writeU32BE(size + 8)
      await this.writer.writeFourCC('mdat')
    }
  }

  protected async writeVideoPacket(track: OutputVideoTrack, packet: EncodedPacket): Promise<void> {
    await this.writeSample(track.id, packet)
  }

  protected async writeAudioPacket(track: OutputAudioTrack, packet: EncodedPacket): Promise<void> {
    await this.writeSample(track.id, packet)
  }

  protected async writeSubtitlePacket(track: OutputSubtitleTrack, packet: EncodedPacket): Promise<void> {
    await this.writeSample(track.id, packet)
  }

  private async writeSample(trackId: number, packet: EncodedPacket): Promise<void> {
    const data = this.trackData.get(trackId)
    if (!data) return

    const sample: Mp4Sample = {
      data: packet.data,
      timestamp: packet.timestamp,
      duration: packet.duration ?? 0,
      isKeyframe: packet.isKeyframe,
      compositionTimeOffset: packet.compositionTimeOffset ?? 0,
      size: packet.data.byteLength,
    }

    if (this.options.fastStart) {
      data.samples.push(sample)
    }
    else {
      const offset = this.writer.position
      await this.writer.writeBytes(packet.data)
      this.mdatSize += packet.data.byteLength

      sample.size = packet.data.byteLength
      data.samples.push(sample)

      if (!data.currentChunk) {
        data.currentChunk = { samples: [], offset }
        data.chunkOffsets.push(offset)
      }
      data.currentChunk.samples.push(sample)
    }
  }

  protected async writeTrailer(): Promise<void> {
    if (this.options.fastStart) {
      const moovData = await this.buildMoov(0)

      this.mdatStart = this.writer.position + moovData.byteLength + 8
      await this.adjustChunkOffsets(this.mdatStart)

      const finalMoov = await this.buildMoov(this.mdatStart)
      await this.writer.writeBytes(finalMoov)

      let mdatSize = 0
      for (const data of this.trackData.values()) {
        for (const sample of data.samples) {
          mdatSize += sample.size
        }
      }

      await this.writeMdatHeader(mdatSize)

      for (const data of this.trackData.values()) {
        for (const sample of data.samples) {
          await this.writer.writeBytes(sample.data)
        }
      }
    }
    else {
      const moov = await this.buildMoov(this.mdatStart + 8)
      await this.writer.writeBytes(moov)
    }
  }

  private async adjustChunkOffsets(mdatStart: number): Promise<void> {
    let offset = mdatStart
    for (const data of this.trackData.values()) {
      data.chunkOffsets = []
      for (const sample of data.samples) {
        data.chunkOffsets.push(offset)
        offset += sample.size
      }
    }
  }

  private async buildMoov(mdatOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    const mvhd = await this.buildMvhd()
    const traks: Uint8Array[] = []

    for (const data of this.trackData.values()) {
      const trak = await this.buildTrak(data, mdatOffset)
      traks.push(trak)
    }

    const moovContentSize = mvhd.byteLength + traks.reduce((sum, t) => sum + t.byteLength, 0)
    const moovSize = moovContentSize + 8

    await writer.writeU32BE(moovSize)
    await writer.writeFourCC('moov')
    await writer.writeBytes(mvhd)

    for (const trak of traks) {
      await writer.writeBytes(trak)
    }

    return writer.getBuffer()
  }

  private async buildMvhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970

    let maxDuration = 0n
    for (const data of this.trackData.values()) {
      const lastSample = data.samples[data.samples.length - 1]
      if (lastSample) {
        const duration = BigInt(Math.round((lastSample.timestamp + lastSample.duration) * GLOBAL_TIMESCALE))
        if (duration > maxDuration) maxDuration = duration
      }
    }

    const size = 108 + 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('mvhd')
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0)

    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(GLOBAL_TIMESCALE)
    await writer.writeU32BE(Number(maxDuration & 0xFFFFFFFFn))

    await writer.writeU32BE(0x00010000)
    await writer.writeU16BE(0x0100)
    await writer.writeU16BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)

    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x40000000)

    for (let i = 0; i < 6; i++) {
      await writer.writeU32BE(0)
    }

    await writer.writeU32BE(this.tracks.length + 1)

    return writer.getBuffer()
  }

  private async buildTrak(data: Mp4TrackData, mdatOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    const tkhd = await this.buildTkhd(data)
    const mdia = await this.buildMdia(data, mdatOffset)

    const trakSize = 8 + tkhd.byteLength + mdia.byteLength

    await writer.writeU32BE(trakSize)
    await writer.writeFourCC('trak')
    await writer.writeBytes(tkhd)
    await writer.writeBytes(mdia)

    return writer.getBuffer()
  }

  private async buildTkhd(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970

    const lastSample = data.samples[data.samples.length - 1]
    const duration = lastSample
      ? BigInt(Math.round((lastSample.timestamp + lastSample.duration) * GLOBAL_TIMESCALE))
      : 0n

    const size = 84 + 8
    const track = data.track

    let width = 0
    let height = 0
    let volume = 0

    if (track.type === 'video') {
      width = track.config.width
      height = track.config.height
    }
    else if (track.type === 'audio') {
      volume = 0x0100
    }

    await writer.writeU32BE(size)
    await writer.writeFourCC('tkhd')
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0x03)

    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(track.id)
    await writer.writeU32BE(0)
    await writer.writeU32BE(Number(duration & 0xFFFFFFFFn))

    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(volume)
    await writer.writeU16BE(0)

    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x40000000)

    await writer.writeU32BE(width << 16)
    await writer.writeU32BE(height << 16)

    return writer.getBuffer()
  }

  private async buildMdia(data: Mp4TrackData, mdatOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    const mdhd = await this.buildMdhd(data)
    const hdlr = await this.buildHdlr(data)
    const minf = await this.buildMinf(data, mdatOffset)

    const mdiaSize = 8 + mdhd.byteLength + hdlr.byteLength + minf.byteLength

    await writer.writeU32BE(mdiaSize)
    await writer.writeFourCC('mdia')
    await writer.writeBytes(mdhd)
    await writer.writeBytes(hdlr)
    await writer.writeBytes(minf)

    return writer.getBuffer()
  }

  private async buildMdhd(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970

    const lastSample = data.samples[data.samples.length - 1]
    const duration = lastSample
      ? BigInt(Math.round((lastSample.timestamp + lastSample.duration) * data.timescale))
      : 0n

    const size = 32 + 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('mdhd')
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0)

    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(data.timescale)
    await writer.writeU32BE(Number(duration & 0xFFFFFFFFn))

    await writer.writeU16BE(encodeLanguageCode('und'))
    await writer.writeU16BE(0)

    return writer.getBuffer()
  }

  private async buildHdlr(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    let handlerType = ''
    let name = ''

    if (data.track.type === 'video') {
      handlerType = 'vide'
      name = 'VideoHandler'
    }
    else if (data.track.type === 'audio') {
      handlerType = 'soun'
      name = 'SoundHandler'
    }
    else {
      handlerType = 'text'
      name = 'SubtitleHandler'
    }

    const nameBytes = new TextEncoder().encode(name + '\0')
    const size = 32 + nameBytes.byteLength + 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('hdlr')
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeFourCC(handlerType)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeBytes(nameBytes)

    return writer.getBuffer()
  }

  private async buildMinf(data: Mp4TrackData, mdatOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    let xmhd: Uint8Array
    if (data.track.type === 'video') {
      xmhd = await this.buildVmhd()
    }
    else if (data.track.type === 'audio') {
      xmhd = await this.buildSmhd()
    }
    else {
      xmhd = await this.buildNmhd()
    }

    const dinf = await this.buildDinf()
    const stbl = await this.buildStbl(data, mdatOffset)

    const minfSize = 8 + xmhd.byteLength + dinf.byteLength + stbl.byteLength

    await writer.writeU32BE(minfSize)
    await writer.writeFourCC('minf')
    await writer.writeBytes(xmhd)
    await writer.writeBytes(dinf)
    await writer.writeBytes(stbl)

    return writer.getBuffer()
  }

  private async buildVmhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 20

    await writer.writeU32BE(size)
    await writer.writeFourCC('vmhd')
    await writer.writeU32BE(0x01)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)

    return writer.getBuffer()
  }

  private async buildSmhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 16

    await writer.writeU32BE(size)
    await writer.writeFourCC('smhd')
    await writer.writeU32BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)

    return writer.getBuffer()
  }

  private async buildNmhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 12

    await writer.writeU32BE(size)
    await writer.writeFourCC('nmhd')
    await writer.writeU32BE(0)

    return writer.getBuffer()
  }

  private async buildDinf(): Promise<Uint8Array> {
    const writer = new Writer()

    const dref = await this.buildDref()
    const dinfSize = 8 + dref.byteLength

    await writer.writeU32BE(dinfSize)
    await writer.writeFourCC('dinf')
    await writer.writeBytes(dref)

    return writer.getBuffer()
  }

  private async buildDref(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 28

    await writer.writeU32BE(size)
    await writer.writeFourCC('dref')
    await writer.writeU32BE(0)
    await writer.writeU32BE(1)

    await writer.writeU32BE(12)
    await writer.writeFourCC('url ')
    await writer.writeU32BE(0x01)

    return writer.getBuffer()
  }

  private async buildStbl(data: Mp4TrackData, mdatOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    const stsd = await this.buildStsd(data)
    const stts = await this.buildStts(data)
    const stsc = await this.buildStsc(data)
    const stsz = await this.buildStsz(data)
    const stco = await this.buildStco(data, mdatOffset)

    let stss: Uint8Array | null = null
    let ctts: Uint8Array | null = null

    if (data.track.type === 'video') {
      stss = await this.buildStss(data)
      ctts = await this.buildCtts(data)
    }

    let stblSize = 8 + stsd.byteLength + stts.byteLength + stsc.byteLength + stsz.byteLength + stco.byteLength
    if (stss) stblSize += stss.byteLength
    if (ctts) stblSize += ctts.byteLength

    await writer.writeU32BE(stblSize)
    await writer.writeFourCC('stbl')
    await writer.writeBytes(stsd)
    await writer.writeBytes(stts)
    if (ctts) await writer.writeBytes(ctts)
    await writer.writeBytes(stsc)
    await writer.writeBytes(stsz)
    await writer.writeBytes(stco)
    if (stss) await writer.writeBytes(stss)

    return writer.getBuffer()
  }

  private async buildStsd(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    let entry: Uint8Array
    if (data.track.type === 'video') {
      entry = await this.buildVideoSampleEntry(data.track)
    }
    else if (data.track.type === 'audio') {
      entry = await this.buildAudioSampleEntry(data.track)
    }
    else {
      entry = new Uint8Array(0)
    }

    const size = 16 + entry.byteLength

    await writer.writeU32BE(size)
    await writer.writeFourCC('stsd')
    await writer.writeU32BE(0)
    await writer.writeU32BE(1)
    await writer.writeBytes(entry)

    return writer.getBuffer()
  }

  private async buildVideoSampleEntry(track: OutputVideoTrack): Promise<Uint8Array> {
    const writer = new Writer()
    const config = track.config

    let codecBox = ''
    if (config.codec === 'h264') codecBox = 'avc1'
    else if (config.codec === 'h265') codecBox = 'hev1'
    else if (config.codec === 'vp9') codecBox = 'vp09'
    else if (config.codec === 'av1') codecBox = 'av01'
    else codecBox = 'mp4v'

    const codecConfig = config.codecDescription ?? new Uint8Array(0)
    const configBoxType = config.codec === 'h264' ? 'avcC' : config.codec === 'h265' ? 'hvcC' : 'avcC'
    const configBoxSize = codecConfig.byteLength > 0 ? 8 + codecConfig.byteLength : 0

    const size = 86 + configBoxSize

    await writer.writeU32BE(size)
    await writer.writeFourCC(codecBox)
    await writer.writeU32BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(1)

    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)

    await writer.writeU16BE(config.width)
    await writer.writeU16BE(config.height)
    await writer.writeU32BE(0x00480000)
    await writer.writeU32BE(0x00480000)
    await writer.writeU32BE(0)
    await writer.writeU16BE(1)

    const compressorName = new Uint8Array(32)
    await writer.writeBytes(compressorName)

    await writer.writeU16BE(0x0018)
    await writer.writeI16BE(-1)

    if (configBoxSize > 0) {
      await writer.writeU32BE(configBoxSize)
      await writer.writeFourCC(configBoxType)
      await writer.writeBytes(codecConfig)
    }

    return writer.getBuffer()
  }

  private async buildAudioSampleEntry(track: OutputAudioTrack): Promise<Uint8Array> {
    const writer = new Writer()
    const config = track.config

    let codecBox = 'mp4a'
    if (config.codec === 'opus') codecBox = 'Opus'
    else if (config.codec === 'flac') codecBox = 'fLaC'

    const codecConfig = config.codecDescription ?? new Uint8Array(0)
    const configBoxSize = codecConfig.byteLength > 0 ? 8 + codecConfig.byteLength : 0

    const size = 36 + configBoxSize

    await writer.writeU32BE(size)
    await writer.writeFourCC(codecBox)
    await writer.writeU32BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(1)

    await writer.writeU32BE(0)
    await writer.writeU32BE(0)

    await writer.writeU16BE(config.channels)
    await writer.writeU16BE(config.bitsPerSample ?? 16)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU32BE(config.sampleRate << 16)

    if (configBoxSize > 0) {
      await writer.writeU32BE(configBoxSize)
      await writer.writeFourCC('esds')
      await writer.writeBytes(codecConfig)
    }

    return writer.getBuffer()
  }

  private async buildStts(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const entries: { sampleCount: number, sampleDelta: number }[] = []
    let lastDelta = -1

    for (const sample of data.samples) {
      const delta = Math.round(sample.duration * data.timescale)
      if (delta === lastDelta && entries.length > 0) {
        entries[entries.length - 1].sampleCount++
      }
      else {
        entries.push({ sampleCount: 1, sampleDelta: delta })
        lastDelta = delta
      }
    }

    const size = 16 + entries.length * 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('stts')
    await writer.writeU32BE(0)
    await writer.writeU32BE(entries.length)

    for (const entry of entries) {
      await writer.writeU32BE(entry.sampleCount)
      await writer.writeU32BE(entry.sampleDelta)
    }

    return writer.getBuffer()
  }

  private async buildCtts(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const entries: { sampleCount: number, sampleOffset: number }[] = []
    let lastOffset = Number.MIN_SAFE_INTEGER

    for (const sample of data.samples) {
      const offset = Math.round(sample.compositionTimeOffset * data.timescale)
      if (offset === lastOffset && entries.length > 0) {
        entries[entries.length - 1].sampleCount++
      }
      else {
        entries.push({ sampleCount: 1, sampleOffset: offset })
        lastOffset = offset
      }
    }

    if (entries.length === 0 || (entries.length === 1 && entries[0].sampleOffset === 0)) {
      return new Uint8Array(0)
    }

    const size = 16 + entries.length * 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('ctts')
    await writer.writeU32BE(0)
    await writer.writeU32BE(entries.length)

    for (const entry of entries) {
      await writer.writeU32BE(entry.sampleCount)
      await writer.writeU32BE(entry.sampleOffset)
    }

    return writer.getBuffer()
  }

  private async buildStsc(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const size = 28

    await writer.writeU32BE(size)
    await writer.writeFourCC('stsc')
    await writer.writeU32BE(0)
    await writer.writeU32BE(1)
    await writer.writeU32BE(1)
    await writer.writeU32BE(1)
    await writer.writeU32BE(1)

    return writer.getBuffer()
  }

  private async buildStsz(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const size = 20 + data.samples.length * 4

    await writer.writeU32BE(size)
    await writer.writeFourCC('stsz')
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(data.samples.length)

    for (const sample of data.samples) {
      await writer.writeU32BE(sample.size)
    }

    return writer.getBuffer()
  }

  private async buildStco(data: Mp4TrackData, mdatOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    let offset = mdatOffset
    const offsets: number[] = []

    for (const sample of data.samples) {
      offsets.push(offset)
      offset += sample.size
    }

    const size = 16 + offsets.length * 4

    await writer.writeU32BE(size)
    await writer.writeFourCC('stco')
    await writer.writeU32BE(0)
    await writer.writeU32BE(offsets.length)

    for (const o of offsets) {
      await writer.writeU32BE(o)
    }

    return writer.getBuffer()
  }

  private async buildStss(data: Mp4TrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const keyframes: number[] = []
    for (let i = 0; i < data.samples.length; i++) {
      if (data.samples[i].isKeyframe) {
        keyframes.push(i + 1)
      }
    }

    if (keyframes.length === data.samples.length) {
      return new Uint8Array(0)
    }

    const size = 16 + keyframes.length * 4

    await writer.writeU32BE(size)
    await writer.writeFourCC('stss')
    await writer.writeU32BE(0)
    await writer.writeU32BE(keyframes.length)

    for (const k of keyframes) {
      await writer.writeU32BE(k)
    }

    return writer.getBuffer()
  }
}
