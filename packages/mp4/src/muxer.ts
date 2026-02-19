/**
 * MP4/MOV muxer implementation
 */

import type { Target } from 'ts-videos/writer'
import type { VideoTrackConfig, AudioTrackConfig, SubtitleTrackConfig, EncodedPacket } from 'ts-videos/types'
import { Muxer } from 'ts-videos/muxer'
import type { OutputVideoTrack, OutputAudioTrack, OutputSubtitleTrack } from 'ts-videos/muxer'
import { Writer } from 'ts-videos/writer'
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

export interface Mp4Chapter {
  title: string
  startTimeMs: number
}

export class Mp4Muxer extends Muxer {
  private trackData: Map<number, Mp4TrackData> = new Map()
  private options: Mp4MuxerOptions
  private mdatStart = 0
  private mdatSize = 0
  private chapters: Mp4Chapter[] = []
  private artwork: Uint8Array | null = null
  private artworkType: 'jpeg' | 'png' = 'jpeg'

  constructor(target: Target, options: Mp4MuxerOptions = {}) {
    super(target)
    this.options = {
      fastStart: options.fastStart ?? true,
      fragmented: options.fragmented ?? false,
      brand: options.brand ?? 'isom',
    }
  }

  addChapter(title: string, startTimeMs: number): void {
    this.chapters.push({ title, startTimeMs })
  }

  setArtwork(data: Uint8Array, type: 'jpeg' | 'png' = 'jpeg'): void {
    this.artwork = data
    this.artworkType = type
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
    const brands = [this.options.brand!, 'isom', 'iso2', 'mp42']
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

      // Build chapter text samples for mdat
      const chapterSamples = this.chapters.length > 0 ? this.buildChapterTextSamples() : []

      let mdatSize = 0
      for (const data of this.trackData.values()) {
        for (const sample of data.samples) {
          mdatSize += sample.size
        }
      }
      for (const cs of chapterSamples) {
        mdatSize += cs.data.byteLength
      }

      await this.writeMdatHeader(mdatSize)

      // Write user track samples
      for (const data of this.trackData.values()) {
        for (const sample of data.samples) {
          await this.writer.writeBytes(sample.data)
        }
      }

      // Write chapter text samples
      for (const cs of chapterSamples) {
        await this.writer.writeBytes(cs.data)
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

    // Calculate user track data size (for chapter track offset)
    let userDataSize = 0
    for (const data of this.trackData.values()) {
      for (const sample of data.samples) {
        userDataSize += sample.size
      }
    }

    // Chapter track setup
    const hasChapters = this.chapters.length > 0
    const chapterTrackId = hasChapters ? this.tracks.length + 1 : 0
    const chapterSamples = hasChapters ? this.buildChapterTextSamples() : []

    // Build user tracks (with tref on audio tracks if chapters exist)
    for (const data of this.trackData.values()) {
      const trefTarget = data.track.type === 'audio' && hasChapters ? chapterTrackId : undefined
      const trak = await this.buildTrak(data, mdatOffset, trefTarget)
      traks.push(trak)
    }

    // Build chapter text track
    if (hasChapters && chapterSamples.length > 0) {
      const chapterDataOffset = mdatOffset + userDataSize
      const chapterTrak = await this.buildChapterTrak(chapterTrackId, chapterSamples, chapterDataOffset)
      traks.push(chapterTrak)
    }

    const udta = await this.buildUdta()

    let moovContentSize = mvhd.byteLength + traks.reduce((sum, t) => sum + t.byteLength, 0)
    if (udta) moovContentSize += udta.byteLength
    const moovSize = moovContentSize + 8

    await writer.writeU32BE(moovSize)
    await writer.writeFourCC('moov')
    await writer.writeBytes(mvhd)

    for (const trak of traks) {
      await writer.writeBytes(trak)
    }

    if (udta) {
      await writer.writeBytes(udta)
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

    const size = 108
    const hasChapterTrack = this.chapters.length > 0

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

    // next_track_id: user tracks + optional chapter track + 1
    await writer.writeU32BE(this.tracks.length + 1 + (hasChapterTrack ? 1 : 0))

    return writer.getBuffer()
  }

  private async buildTrak(data: Mp4TrackData, mdatOffset: number, chapterTrackId?: number): Promise<Uint8Array> {
    const writer = new Writer()

    const tkhd = await this.buildTkhd(data)
    const tref = chapterTrackId ? await this.buildTref(chapterTrackId) : null
    const mdia = await this.buildMdia(data, mdatOffset)

    let trakSize = 8 + tkhd.byteLength + mdia.byteLength
    if (tref) trakSize += tref.byteLength

    await writer.writeU32BE(trakSize)
    await writer.writeFourCC('trak')
    await writer.writeBytes(tkhd)
    if (tref) await writer.writeBytes(tref)
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

    const size = 32

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
    const size = 32 + nameBytes.byteLength

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

  // ── Track reference (tref) for chapter track ──

  private async buildTref(chapterTrackId: number): Promise<Uint8Array> {
    const writer = new Writer()
    // tref: 8 (header) + chap: 12 (8 header + 4 track_id)
    await writer.writeU32BE(20)
    await writer.writeFourCC('tref')
    await writer.writeU32BE(12)
    await writer.writeFourCC('chap')
    await writer.writeU32BE(chapterTrackId)
    return writer.getBuffer()
  }

  // ── Chapter text track ──

  private buildChapterTextSamples(): { data: Uint8Array, durationMs: number }[] {
    if (this.chapters.length === 0) return []

    // Find total audio duration from track data
    let totalDurationMs = 0
    for (const data of this.trackData.values()) {
      const lastSample = data.samples[data.samples.length - 1]
      if (lastSample) {
        totalDurationMs = Math.max(totalDurationMs,
          Math.round((lastSample.timestamp + lastSample.duration) * 1000))
      }
    }

    const encoder = new TextEncoder()
    const samples: { data: Uint8Array, durationMs: number }[] = []

    for (let i = 0; i < this.chapters.length; i++) {
      const chapter = this.chapters[i]
      const nextStartMs = i + 1 < this.chapters.length
        ? this.chapters[i + 1].startTimeMs
        : totalDurationMs
      const durationMs = Math.max(1, Math.round(nextStartMs - chapter.startTimeMs))

      // QuickTime text sample: 2-byte BE length prefix + UTF-8 text
      const titleBytes = encoder.encode(chapter.title)
      const sampleData = new Uint8Array(2 + titleBytes.length)
      sampleData[0] = (titleBytes.length >> 8) & 0xFF
      sampleData[1] = titleBytes.length & 0xFF
      sampleData.set(titleBytes, 2)

      samples.push({ data: sampleData, durationMs })
    }

    return samples
  }

  private async buildTextSampleEntry(): Promise<Uint8Array> {
    const writer = new Writer()
    // QuickTime text sample description (60 bytes total)
    await writer.writeU32BE(60)
    await writer.writeFourCC('text')
    // reserved (6 bytes)
    await writer.writeU32BE(0)
    await writer.writeU16BE(0)
    // data reference index
    await writer.writeU16BE(1)
    // display flags
    await writer.writeU32BE(0)
    // text justification (1 = center)
    await writer.writeU32BE(1)
    // background color (R, G, B — 2 bytes each)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    // default text box (top, left, bottom, right)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)
    // reserved (8 bytes)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    // font number
    await writer.writeU16BE(0)
    // font face
    await writer.writeU16BE(0)
    // reserved (1 byte)
    await writer.writeU8(0)
    // reserved (2 bytes)
    await writer.writeU16BE(0)
    // foreground color (white)
    await writer.writeU16BE(0xFFFF)
    await writer.writeU16BE(0xFFFF)
    await writer.writeU16BE(0xFFFF)
    // font name (Pascal string — 0 length = empty)
    await writer.writeU8(0)
    return writer.getBuffer()
  }

  private async buildChapterTrak(
    trackId: number,
    chapterSamples: { data: Uint8Array, durationMs: number }[],
    mdatOffset: number,
  ): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970
    const timescale = 1000
    const encoder = new TextEncoder()

    // Calculate total duration
    let totalDurationMs = 0
    for (const s of chapterSamples) totalDurationMs += s.durationMs

    // ── tkhd (92 bytes) ──
    const tkhdWriter = new Writer()
    await tkhdWriter.writeU32BE(92)
    await tkhdWriter.writeFourCC('tkhd')
    await tkhdWriter.writeU8(0) // version
    await tkhdWriter.writeU8(0)
    await tkhdWriter.writeU8(0)
    await tkhdWriter.writeU8(0x01) // flags = track_enabled
    await tkhdWriter.writeU32BE(Number(now & 0xFFFFFFFFn))
    await tkhdWriter.writeU32BE(Number(now & 0xFFFFFFFFn))
    await tkhdWriter.writeU32BE(trackId)
    await tkhdWriter.writeU32BE(0) // reserved
    await tkhdWriter.writeU32BE(totalDurationMs) // duration in movie timescale
    await tkhdWriter.writeU32BE(0) // reserved
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU16BE(0) // layer
    await tkhdWriter.writeU16BE(0) // alternate group
    await tkhdWriter.writeU16BE(0) // volume (0 for text)
    await tkhdWriter.writeU16BE(0) // reserved
    // Identity matrix (36 bytes)
    await tkhdWriter.writeU32BE(0x00010000)
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU32BE(0x00010000)
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU32BE(0)
    await tkhdWriter.writeU32BE(0x40000000)
    await tkhdWriter.writeU32BE(0) // width
    await tkhdWriter.writeU32BE(0) // height
    const tkhd = tkhdWriter.getBuffer()

    // ── mdhd (32 bytes) ──
    const mdhdWriter = new Writer()
    await mdhdWriter.writeU32BE(32)
    await mdhdWriter.writeFourCC('mdhd')
    await mdhdWriter.writeU32BE(0) // version + flags
    await mdhdWriter.writeU32BE(Number(now & 0xFFFFFFFFn))
    await mdhdWriter.writeU32BE(Number(now & 0xFFFFFFFFn))
    await mdhdWriter.writeU32BE(timescale)
    await mdhdWriter.writeU32BE(totalDurationMs)
    await mdhdWriter.writeU16BE(encodeLanguageCode('und'))
    await mdhdWriter.writeU16BE(0)
    const mdhd = mdhdWriter.getBuffer()

    // ── hdlr for text ──
    const hdlrNameBytes = encoder.encode('ChapterHandler\0')
    const hdlrWriter = new Writer()
    await hdlrWriter.writeU32BE(32 + hdlrNameBytes.byteLength)
    await hdlrWriter.writeFourCC('hdlr')
    await hdlrWriter.writeU32BE(0) // version+flags
    await hdlrWriter.writeU32BE(0) // pre_defined
    await hdlrWriter.writeFourCC('text')
    await hdlrWriter.writeU32BE(0)
    await hdlrWriter.writeU32BE(0)
    await hdlrWriter.writeU32BE(0)
    await hdlrWriter.writeBytes(hdlrNameBytes)
    const hdlr = hdlrWriter.getBuffer()

    // ── nmhd (12 bytes) ──
    const nmhdWriter = new Writer()
    await nmhdWriter.writeU32BE(12)
    await nmhdWriter.writeFourCC('nmhd')
    await nmhdWriter.writeU32BE(0)
    const nmhd = nmhdWriter.getBuffer()

    // ── dinf (reuse existing) ──
    const dinf = await this.buildDinf()

    // ── stsd with text sample entry ──
    const textEntry = await this.buildTextSampleEntry()
    const stsdWriter = new Writer()
    await stsdWriter.writeU32BE(16 + textEntry.byteLength)
    await stsdWriter.writeFourCC('stsd')
    await stsdWriter.writeU32BE(0)
    await stsdWriter.writeU32BE(1)
    await stsdWriter.writeBytes(textEntry)
    const stsd = stsdWriter.getBuffer()

    // ── stts (time-to-sample) ──
    const sttsEntries: { count: number, delta: number }[] = []
    let lastDelta = -1
    for (const s of chapterSamples) {
      if (s.durationMs === lastDelta && sttsEntries.length > 0) {
        sttsEntries[sttsEntries.length - 1].count++
      }
      else {
        sttsEntries.push({ count: 1, delta: s.durationMs })
        lastDelta = s.durationMs
      }
    }
    const sttsWriter = new Writer()
    await sttsWriter.writeU32BE(16 + sttsEntries.length * 8)
    await sttsWriter.writeFourCC('stts')
    await sttsWriter.writeU32BE(0)
    await sttsWriter.writeU32BE(sttsEntries.length)
    for (const e of sttsEntries) {
      await sttsWriter.writeU32BE(e.count)
      await sttsWriter.writeU32BE(e.delta)
    }
    const stts = sttsWriter.getBuffer()

    // ── stsc (1 sample per chunk) ──
    const stscWriter = new Writer()
    await stscWriter.writeU32BE(28)
    await stscWriter.writeFourCC('stsc')
    await stscWriter.writeU32BE(0)
    await stscWriter.writeU32BE(1)
    await stscWriter.writeU32BE(1) // first_chunk
    await stscWriter.writeU32BE(1) // samples_per_chunk
    await stscWriter.writeU32BE(1) // sample_description_index
    const stsc = stscWriter.getBuffer()

    // ── stsz (sample sizes) ──
    const stszWriter = new Writer()
    await stszWriter.writeU32BE(20 + chapterSamples.length * 4)
    await stszWriter.writeFourCC('stsz')
    await stszWriter.writeU32BE(0)
    await stszWriter.writeU32BE(0) // default sample size = 0 (variable)
    await stszWriter.writeU32BE(chapterSamples.length)
    for (const s of chapterSamples) {
      await stszWriter.writeU32BE(s.data.byteLength)
    }
    const stsz = stszWriter.getBuffer()

    // ── stco (chunk offsets) ──
    const stcoWriter = new Writer()
    await stcoWriter.writeU32BE(16 + chapterSamples.length * 4)
    await stcoWriter.writeFourCC('stco')
    await stcoWriter.writeU32BE(0)
    await stcoWriter.writeU32BE(chapterSamples.length)
    let offset = mdatOffset
    for (const s of chapterSamples) {
      await stcoWriter.writeU32BE(offset)
      offset += s.data.byteLength
    }
    const stco = stcoWriter.getBuffer()

    // ── Assemble stbl ──
    const stblSize = 8 + stsd.byteLength + stts.byteLength + stsc.byteLength + stsz.byteLength + stco.byteLength
    const stblWriter = new Writer()
    await stblWriter.writeU32BE(stblSize)
    await stblWriter.writeFourCC('stbl')
    await stblWriter.writeBytes(stsd)
    await stblWriter.writeBytes(stts)
    await stblWriter.writeBytes(stsc)
    await stblWriter.writeBytes(stsz)
    await stblWriter.writeBytes(stco)
    const stbl = stblWriter.getBuffer()

    // ── Assemble minf ──
    const minfSize = 8 + nmhd.byteLength + dinf.byteLength + stbl.byteLength
    const minfWriter = new Writer()
    await minfWriter.writeU32BE(minfSize)
    await minfWriter.writeFourCC('minf')
    await minfWriter.writeBytes(nmhd)
    await minfWriter.writeBytes(dinf)
    await minfWriter.writeBytes(stbl)
    const minf = minfWriter.getBuffer()

    // ── Assemble mdia ──
    const mdiaSize = 8 + mdhd.byteLength + hdlr.byteLength + minf.byteLength
    const mdiaWriter = new Writer()
    await mdiaWriter.writeU32BE(mdiaSize)
    await mdiaWriter.writeFourCC('mdia')
    await mdiaWriter.writeBytes(mdhd)
    await mdiaWriter.writeBytes(hdlr)
    await mdiaWriter.writeBytes(minf)
    const mdia = mdiaWriter.getBuffer()

    // ── Assemble trak ──
    const trakSize = 8 + tkhd.byteLength + mdia.byteLength
    await writer.writeU32BE(trakSize)
    await writer.writeFourCC('trak')
    await writer.writeBytes(tkhd)
    await writer.writeBytes(mdia)

    return writer.getBuffer()
  }

  // ── Metadata (udta/meta/ilst) and chapters (chpl) ──

  private async buildUdta(): Promise<Uint8Array | null> {
    const hasMetadata = this.metadata && Object.keys(this.metadata).length > 0
    const hasArtwork = this.artwork !== null
    const hasChapters = this.chapters.length > 0

    if (!hasMetadata && !hasArtwork && !hasChapters) return null

    const writer = new Writer()
    const children: Uint8Array[] = []

    // Nero chapters (chpl) — placed before meta in udta
    if (hasChapters) {
      children.push(await this.buildChpl())
    }

    // meta box containing ilst
    if (hasMetadata || hasArtwork) {
      children.push(await this.buildMeta())
    }

    const contentSize = children.reduce((sum, c) => sum + c.byteLength, 0)
    await writer.writeU32BE(contentSize + 8)
    await writer.writeFourCC('udta')
    for (const child of children) {
      await writer.writeBytes(child)
    }

    return writer.getBuffer()
  }

  private async buildMeta(): Promise<Uint8Array> {
    const writer = new Writer()

    const hdlr = await this.buildMetaHdlr()
    const ilst = await this.buildIlst()

    const contentSize = 4 + hdlr.byteLength + ilst.byteLength // 4 for version+flags
    await writer.writeU32BE(contentSize + 8)
    await writer.writeFourCC('meta')
    await writer.writeU32BE(0) // version + flags
    await writer.writeBytes(hdlr)
    await writer.writeBytes(ilst)

    return writer.getBuffer()
  }

  private async buildMetaHdlr(): Promise<Uint8Array> {
    const writer = new Writer()
    // hdlr for metadata: handler_type = 'mdir', name = '' (Apple style)
    const size = 33
    await writer.writeU32BE(size)
    await writer.writeFourCC('hdlr')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(0) // pre_defined
    await writer.writeFourCC('mdir')
    await writer.writeFourCC('appl')
    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(0) // reserved
    await writer.writeU8(0) // null-terminated empty name

    return writer.getBuffer()
  }

  private async buildIlst(): Promise<Uint8Array> {
    const writer = new Writer()
    const items: Uint8Array[] = []

    const m = this.metadata
    if (m.title) items.push(buildIlstTextItem('\xa9nam', m.title as string))
    if (m.artist) items.push(buildIlstTextItem('\xa9ART', m.artist as string))
    if (m.albumArtist) items.push(buildIlstTextItem('aART', m.albumArtist as string))
    if (m.album) items.push(buildIlstTextItem('\xa9alb', m.album as string))
    if (m.genre) items.push(buildIlstTextItem('\xa9gen', m.genre as string))
    if (m.year) items.push(buildIlstTextItem('\xa9day', String(m.year)))
    if (m.composer) items.push(buildIlstTextItem('\xa9wrt', m.composer as string))
    if (m.copyright) items.push(buildIlstTextItem('cprt', m.copyright as string))
    if (m.comment) items.push(buildIlstTextItem('\xa9cmt', m.comment as string))
    if (m.encodedBy) items.push(buildIlstTextItem('\xa9too', m.encodedBy as string))
    // Custom audiobook metadata
    if (m.narrator) items.push(buildIlstTextItem('\xa9nrt', m.narrator as string))
    if (m.publisher) items.push(buildIlstTextItem('\xa9pub', m.publisher as string))
    if (m.description) items.push(buildIlstTextItem('desc', m.description as string))

    // Cover art
    if (this.artwork) {
      const dataType = this.artworkType === 'png' ? 14 : 13
      items.push(buildIlstDataItem('covr', this.artwork, dataType))
    }

    const contentSize = items.reduce((sum, i) => sum + i.byteLength, 0)
    await writer.writeU32BE(contentSize + 8)
    await writer.writeFourCC('ilst')
    for (const item of items) {
      await writer.writeBytes(item)
    }

    return writer.getBuffer()
  }

  private async buildChpl(): Promise<Uint8Array> {
    const writer = new Writer()
    const encoder = new TextEncoder()

    // Build chapter entries
    const entries: Uint8Array[] = []
    for (const ch of this.chapters) {
      const titleBytes = encoder.encode(ch.title)
      const titleLen = Math.min(titleBytes.length, 255)
      // timestamp in 10MHz units (100ns per tick)
      const timestamp = BigInt(Math.round(ch.startTimeMs * 10000))
      const entryBuf = new Uint8Array(8 + 1 + titleLen)
      const view = new DataView(entryBuf.buffer)
      view.setBigUint64(0, timestamp)
      entryBuf[8] = titleLen
      entryBuf.set(titleBytes.subarray(0, titleLen), 9)
      entries.push(entryBuf)
    }

    const entriesSize = entries.reduce((sum, e) => sum + e.byteLength, 0)
    // chpl: version(1) + flags(3) + reserved(4) + count(4) + entries
    const contentSize = 12 + entriesSize
    await writer.writeU32BE(contentSize + 8)
    await writer.writeFourCC('chpl')
    await writer.writeU8(1) // version
    await writer.writeU8(0) // flags
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(this.chapters.length) // chapter count
    for (const entry of entries) {
      await writer.writeBytes(entry)
    }

    return writer.getBuffer()
  }
}

// ── ilst atom helpers (module-level) ──

function buildIlstTextItem(tag: string, value: string): Uint8Array {
  const encoder = new TextEncoder()
  const valueBytes = encoder.encode(value)
  // item: [size:4][tag:4] > data: [size:4]['data':4][type:4=1][locale:4=0][value]
  const dataSize = 16 + valueBytes.length
  const itemSize = 8 + dataSize
  const buf = new Uint8Array(itemSize)
  const view = new DataView(buf.buffer)

  // Item header
  view.setUint32(0, itemSize)
  buf[4] = tag.charCodeAt(0) & 0xFF
  buf[5] = tag.charCodeAt(1) & 0xFF
  buf[6] = tag.charCodeAt(2) & 0xFF
  buf[7] = tag.charCodeAt(3) & 0xFF

  // Data atom
  view.setUint32(8, dataSize)
  buf[12] = 0x64 // d
  buf[13] = 0x61 // a
  buf[14] = 0x74 // t
  buf[15] = 0x61 // a
  view.setUint32(16, 1) // type = UTF-8
  view.setUint32(20, 0) // locale
  buf.set(valueBytes, 24)

  return buf
}

function buildIlstDataItem(tag: string, data: Uint8Array, dataType: number): Uint8Array {
  const dataSize = 16 + data.length
  const itemSize = 8 + dataSize
  const buf = new Uint8Array(itemSize)
  const view = new DataView(buf.buffer)

  // Item header
  view.setUint32(0, itemSize)
  buf[4] = tag.charCodeAt(0) & 0xFF
  buf[5] = tag.charCodeAt(1) & 0xFF
  buf[6] = tag.charCodeAt(2) & 0xFF
  buf[7] = tag.charCodeAt(3) & 0xFF

  // Data atom
  view.setUint32(8, dataSize)
  buf[12] = 0x64 // d
  buf[13] = 0x61 // a
  buf[14] = 0x74 // t
  buf[15] = 0x61 // a
  view.setUint32(16, dataType)
  view.setUint32(20, 0) // locale
  buf.set(data, 24)

  return buf
}
