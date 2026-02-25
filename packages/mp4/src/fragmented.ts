/**
 * Fragmented MP4 (fMP4) muxer implementation
 * Supports streaming output with movie fragments (moof + mdat)
 */

import type { Target } from 'ts-videos/writer'
import type { EncodedPacket } from 'ts-videos/types'
import { Muxer } from 'ts-videos/muxer'
import type { OutputVideoTrack, OutputAudioTrack, OutputSubtitleTrack } from 'ts-videos/muxer'
import { Writer } from 'ts-videos/writer'
import { encodeLanguageCode, TIMESCALE_1904_TO_1970 } from './boxes'

const GLOBAL_TIMESCALE = 1000

/**
 * Fragmented MP4 options
 */
export interface FragmentedMp4Options {
  /** Fragment duration in seconds (default: 2) */
  fragmentDuration?: number
  /** Brand identifier */
  brand?: string
  /** Enable CMAF compatibility */
  cmaf?: boolean
  /** Enable low-latency mode (smaller fragments) */
  lowLatency?: boolean
}

interface FragmentTrackData {
  track: OutputVideoTrack | OutputAudioTrack | OutputSubtitleTrack
  timescale: number
  samples: FragmentSample[]
  baseMediaDecodeTime: bigint
  defaultSampleDuration: number
  defaultSampleSize: number
  defaultSampleFlags: number
}

interface FragmentSample {
  data: Uint8Array
  timestamp: number
  duration: number
  isKeyframe: boolean
  compositionTimeOffset: number
  size: number
}

/**
 * FragmentedMp4Muxer - Generate fragmented MP4 files for streaming
 */
export class FragmentedMp4Muxer extends Muxer {
  private trackData: Map<number, FragmentTrackData> = new Map()
  private options: Required<FragmentedMp4Options>
  private sequenceNumber = 1
  private fragmentStartTime = 0
  private initialized = false

  constructor(target: Target, options: FragmentedMp4Options = {}) {
    super(target)
    this.options = {
      fragmentDuration: options.fragmentDuration ?? 2,
      brand: options.brand ?? 'iso5',
      cmaf: options.cmaf ?? false,
      lowLatency: options.lowLatency ?? false,
    }

    if (this.options.lowLatency) {
      this.options.fragmentDuration = Math.min(0.5, this.options.fragmentDuration)
    }
  }

  get formatName(): string {
    return 'fmp4'
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
      baseMediaDecodeTime: 0n,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: track.type === 'video' ? 0x10000 : 0, // depends on other samples
    })
  }

  protected async writeHeader(): Promise<void> {
    await this.writeFtyp()
    await this.writeMoov()
    this.initialized = true
  }

  private async writeFtyp(): Promise<void> {
    const brands = this.options.cmaf
      ? ['cmfc', 'iso6', 'mp41']
      : [this.options.brand, 'iso5', 'iso6', 'mp41', 'avc1']

    const size = 8 + 8 + brands.length * 4

    await this.writer.writeU32BE(size)
    await this.writer.writeFourCC('ftyp')
    await this.writer.writeFourCC(this.options.cmaf ? 'cmfc' : this.options.brand)
    await this.writer.writeU32BE(0x200)

    for (const brand of brands) {
      await this.writer.writeFourCC(brand)
    }
  }

  private async writeMoov(): Promise<void> {
    const writer = new Writer()

    const mvhd = await this.buildMvhd()
    const mvex = await this.buildMvex()
    const traks: Uint8Array[] = []

    for (const data of this.trackData.values()) {
      const trak = await this.buildTrak(data)
      traks.push(trak)
    }

    const moovContentSize = mvhd.byteLength + mvex.byteLength +
      traks.reduce((sum, t) => sum + t.byteLength, 0)
    const moovSize = moovContentSize + 8

    await writer.writeU32BE(moovSize)
    await writer.writeFourCC('moov')
    await writer.writeBytes(mvhd)

    for (const trak of traks) {
      await writer.writeBytes(trak)
    }

    await writer.writeBytes(mvex)

    await this.writer.writeBytes(writer.getBuffer())
  }

  private async buildMvhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970

    const size = 108 + 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('mvhd')
    await writer.writeU8(0) // version
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0) // flags

    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(GLOBAL_TIMESCALE)
    await writer.writeU32BE(0) // duration unknown for fragmented

    // Rate (1.0)
    await writer.writeU32BE(0x00010000)
    // Volume (1.0)
    await writer.writeU16BE(0x0100)
    // Reserved
    await writer.writeU16BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)

    // Matrix (identity)
    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x40000000)

    // Pre-defined (6 x 32-bit)
    for (let i = 0; i < 6; i++) {
      await writer.writeU32BE(0)
    }

    // Next track ID
    await writer.writeU32BE(this.tracks.length + 1)

    return writer.getBuffer()
  }

  private async buildMvex(): Promise<Uint8Array> {
    const writer = new Writer()

    const trexBoxes: Uint8Array[] = []
    for (const data of this.trackData.values()) {
      trexBoxes.push(await this.buildTrex(data))
    }

    const mvexSize = 8 + trexBoxes.reduce((sum, t) => sum + t.byteLength, 0)

    await writer.writeU32BE(mvexSize)
    await writer.writeFourCC('mvex')

    for (const trex of trexBoxes) {
      await writer.writeBytes(trex)
    }

    return writer.getBuffer()
  }

  private async buildTrex(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 32

    await writer.writeU32BE(size)
    await writer.writeFourCC('trex')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(data.track.id) // track_ID
    await writer.writeU32BE(1) // default_sample_description_index
    await writer.writeU32BE(0) // default_sample_duration
    await writer.writeU32BE(0) // default_sample_size
    await writer.writeU32BE(data.defaultSampleFlags) // default_sample_flags

    return writer.getBuffer()
  }

  private async buildTrak(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const tkhd = await this.buildTkhd(data)
    const mdia = await this.buildMdia(data)

    const trakSize = 8 + tkhd.byteLength + mdia.byteLength

    await writer.writeU32BE(trakSize)
    await writer.writeFourCC('trak')
    await writer.writeBytes(tkhd)
    await writer.writeBytes(mdia)

    return writer.getBuffer()
  }

  private async buildTkhd(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970

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
    await writer.writeU8(0) // version
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0x03) // flags: enabled + in_movie

    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(track.id)
    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(0) // duration unknown

    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(0) // reserved
    await writer.writeU16BE(0) // layer
    await writer.writeU16BE(0) // alternate_group
    await writer.writeU16BE(volume)
    await writer.writeU16BE(0) // reserved

    // Matrix
    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x00010000)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)
    await writer.writeU32BE(0x40000000)

    // Width and height (16.16 fixed-point)
    await writer.writeU32BE(width << 16)
    await writer.writeU32BE(height << 16)

    return writer.getBuffer()
  }

  private async buildMdia(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const mdhd = await this.buildMdhd(data)
    const hdlr = await this.buildHdlr(data)
    const minf = await this.buildMinf(data)

    const mdiaSize = 8 + mdhd.byteLength + hdlr.byteLength + minf.byteLength

    await writer.writeU32BE(mdiaSize)
    await writer.writeFourCC('mdia')
    await writer.writeBytes(mdhd)
    await writer.writeBytes(hdlr)
    await writer.writeBytes(minf)

    return writer.getBuffer()
  }

  private async buildMdhd(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()
    const now = BigInt(Math.floor(Date.now() / 1000)) + TIMESCALE_1904_TO_1970

    const size = 32 + 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('mdhd')
    await writer.writeU8(0) // version
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0) // flags

    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(Number(now & 0xFFFFFFFFn))
    await writer.writeU32BE(data.timescale)
    await writer.writeU32BE(0) // duration unknown

    await writer.writeU16BE(encodeLanguageCode('und'))
    await writer.writeU16BE(0) // pre_defined

    return writer.getBuffer()
  }

  private async buildHdlr(data: FragmentTrackData): Promise<Uint8Array> {
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

    const nameBytes = new TextEncoder().encode(`${name}\0`)
    const size = 32 + nameBytes.byteLength + 8

    await writer.writeU32BE(size)
    await writer.writeFourCC('hdlr')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(0) // pre_defined
    await writer.writeFourCC(handlerType)
    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(0) // reserved
    await writer.writeBytes(nameBytes)

    return writer.getBuffer()
  }

  private async buildMinf(data: FragmentTrackData): Promise<Uint8Array> {
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
    const stbl = await this.buildStbl(data)

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
    await writer.writeU32BE(0x01) // flags
    await writer.writeU16BE(0) // graphicsmode
    await writer.writeU16BE(0) // opcolor
    await writer.writeU16BE(0)
    await writer.writeU16BE(0)

    return writer.getBuffer()
  }

  private async buildSmhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 16

    await writer.writeU32BE(size)
    await writer.writeFourCC('smhd')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU16BE(0) // balance
    await writer.writeU16BE(0) // reserved

    return writer.getBuffer()
  }

  private async buildNmhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 12

    await writer.writeU32BE(size)
    await writer.writeFourCC('nmhd')
    await writer.writeU32BE(0) // version + flags

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
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(1) // entry_count

    // url entry
    await writer.writeU32BE(12)
    await writer.writeFourCC('url ')
    await writer.writeU32BE(0x01) // self-contained flag

    return writer.getBuffer()
  }

  private async buildStbl(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()

    const stsd = await this.buildStsd(data)
    // Empty sample table atoms for fragmented files
    const stts = await this.buildEmptyAtom('stts')
    const stsc = await this.buildEmptyAtom('stsc')
    const stsz = await this.buildEmptyStsz()
    const stco = await this.buildEmptyAtom('stco')

    const stblSize = 8 + stsd.byteLength + stts.byteLength + stsc.byteLength +
      stsz.byteLength + stco.byteLength

    await writer.writeU32BE(stblSize)
    await writer.writeFourCC('stbl')
    await writer.writeBytes(stsd)
    await writer.writeBytes(stts)
    await writer.writeBytes(stsc)
    await writer.writeBytes(stsz)
    await writer.writeBytes(stco)

    return writer.getBuffer()
  }

  private async buildEmptyAtom(type: string): Promise<Uint8Array> {
    const writer = new Writer()
    await writer.writeU32BE(16)
    await writer.writeFourCC(type)
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(0) // entry_count
    return writer.getBuffer()
  }

  private async buildEmptyStsz(): Promise<Uint8Array> {
    const writer = new Writer()
    await writer.writeU32BE(20)
    await writer.writeFourCC('stsz')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(0) // sample_size
    await writer.writeU32BE(0) // sample_count
    return writer.getBuffer()
  }

  private async buildStsd(data: FragmentTrackData): Promise<Uint8Array> {
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
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(1) // entry_count
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
    await writer.writeU32BE(0) // reserved
    await writer.writeU16BE(0) // reserved
    await writer.writeU16BE(1) // data_reference_index

    await writer.writeU16BE(0) // pre_defined
    await writer.writeU16BE(0) // reserved
    await writer.writeU32BE(0) // pre_defined
    await writer.writeU32BE(0)
    await writer.writeU32BE(0)

    await writer.writeU16BE(config.width)
    await writer.writeU16BE(config.height)
    await writer.writeU32BE(0x00480000) // horizresolution 72dpi
    await writer.writeU32BE(0x00480000) // vertresolution 72dpi
    await writer.writeU32BE(0) // reserved
    await writer.writeU16BE(1) // frame_count

    const compressorName = new Uint8Array(32)
    await writer.writeBytes(compressorName)

    await writer.writeU16BE(0x0018) // depth
    await writer.writeI16BE(-1) // pre_defined

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
    await writer.writeU32BE(0) // reserved
    await writer.writeU16BE(0) // reserved
    await writer.writeU16BE(1) // data_reference_index

    await writer.writeU32BE(0) // reserved
    await writer.writeU32BE(0) // reserved

    await writer.writeU16BE(config.channels)
    await writer.writeU16BE(config.bitsPerSample ?? 16)
    await writer.writeU16BE(0) // pre_defined
    await writer.writeU16BE(0) // reserved
    await writer.writeU32BE(config.sampleRate << 16)

    if (configBoxSize > 0) {
      await writer.writeU32BE(configBoxSize)
      await writer.writeFourCC('esds')
      await writer.writeBytes(codecConfig)
    }

    return writer.getBuffer()
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

    const sample: FragmentSample = {
      data: packet.data,
      timestamp: packet.timestamp,
      duration: packet.duration ?? 0,
      isKeyframe: packet.isKeyframe,
      compositionTimeOffset: packet.compositionTimeOffset ?? 0,
      size: packet.data.byteLength,
    }

    data.samples.push(sample)

    // Check if we should write a fragment
    const fragmentDuration = packet.timestamp - this.fragmentStartTime
    if (fragmentDuration >= this.options.fragmentDuration) {
      await this.flushFragment()
    }
  }

  /**
   * Flush current fragment to output
   */
  async flushFragment(): Promise<void> {
    // Check if any track has samples
    let hasSamples = false
    for (const data of this.trackData.values()) {
      if (data.samples.length > 0) {
        hasSamples = true
        break
      }
    }

    if (!hasSamples) return

    const moof = await this.buildMoof()
    const mdat = await this.buildFragmentMdat()

    await this.writer.writeBytes(moof)
    await this.writer.writeBytes(mdat)

    // Update fragment state
    this.sequenceNumber++
    for (const data of this.trackData.values()) {
      if (data.samples.length > 0) {
        const lastSample = data.samples[data.samples.length - 1]
        data.baseMediaDecodeTime += BigInt(Math.round((lastSample.timestamp + lastSample.duration - this.fragmentStartTime) * data.timescale))
        this.fragmentStartTime = lastSample.timestamp + lastSample.duration
      }
      data.samples = []
    }
  }

  private async buildMoof(): Promise<Uint8Array> {
    const writer = new Writer()

    const mfhd = await this.buildMfhd()
    const trafs: Uint8Array[] = []

    // Calculate data offset (will be updated after we know moof size)
    let dataOffset = 8 // mdat header

    for (const data of this.trackData.values()) {
      if (data.samples.length > 0) {
        trafs.push(await this.buildTraf(data, dataOffset))
        for (const sample of data.samples) {
          dataOffset += sample.size
        }
      }
    }

    // Calculate moof size
    let moofSize = 8 + mfhd.byteLength
    for (const traf of trafs) {
      moofSize += traf.byteLength
    }

    // Rebuild trafs with correct data offset
    const finalTrafs: Uint8Array[] = []
    dataOffset = moofSize + 8 // moof size + mdat header

    for (const data of this.trackData.values()) {
      if (data.samples.length > 0) {
        finalTrafs.push(await this.buildTraf(data, dataOffset))
        for (const sample of data.samples) {
          dataOffset += sample.size
        }
      }
    }

    // Recalculate moof size
    moofSize = 8 + mfhd.byteLength
    for (const traf of finalTrafs) {
      moofSize += traf.byteLength
    }

    await writer.writeU32BE(moofSize)
    await writer.writeFourCC('moof')
    await writer.writeBytes(mfhd)

    for (const traf of finalTrafs) {
      await writer.writeBytes(traf)
    }

    return writer.getBuffer()
  }

  private async buildMfhd(): Promise<Uint8Array> {
    const writer = new Writer()
    const size = 16

    await writer.writeU32BE(size)
    await writer.writeFourCC('mfhd')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(this.sequenceNumber)

    return writer.getBuffer()
  }

  private async buildTraf(data: FragmentTrackData, dataOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    const tfhd = await this.buildTfhd(data)
    const tfdt = await this.buildTfdt(data)
    const trun = await this.buildTrun(data, dataOffset)

    const trafSize = 8 + tfhd.byteLength + tfdt.byteLength + trun.byteLength

    await writer.writeU32BE(trafSize)
    await writer.writeFourCC('traf')
    await writer.writeBytes(tfhd)
    await writer.writeBytes(tfdt)
    await writer.writeBytes(trun)

    return writer.getBuffer()
  }

  private async buildTfhd(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()

    // Calculate default duration if consistent
    let defaultDuration = 0
    if (data.samples.length > 0) {
      const firstDuration = Math.round(data.samples[0].duration * data.timescale)
      const allSame = data.samples.every(s => Math.round(s.duration * data.timescale) === firstDuration)
      if (allSame) {
        defaultDuration = firstDuration
      }
    }

    const flags = 0x020000 | // default-base-is-moof
      (defaultDuration > 0 ? 0x08 : 0) // default-sample-duration-present

    const size = 16 + (defaultDuration > 0 ? 4 : 0)

    await writer.writeU32BE(size)
    await writer.writeFourCC('tfhd')
    await writer.writeU8(0) // version
    await writer.writeU8((flags >> 16) & 0xFF)
    await writer.writeU8((flags >> 8) & 0xFF)
    await writer.writeU8(flags & 0xFF)
    await writer.writeU32BE(data.track.id)

    if (defaultDuration > 0) {
      await writer.writeU32BE(defaultDuration)
    }

    return writer.getBuffer()
  }

  private async buildTfdt(data: FragmentTrackData): Promise<Uint8Array> {
    const writer = new Writer()

    // Use version 1 for 64-bit baseMediaDecodeTime
    const size = 20

    await writer.writeU32BE(size)
    await writer.writeFourCC('tfdt')
    await writer.writeU8(1) // version 1
    await writer.writeU8(0)
    await writer.writeU8(0)
    await writer.writeU8(0) // flags
    await writer.writeU64BE(data.baseMediaDecodeTime)

    return writer.getBuffer()
  }

  private async buildTrun(data: FragmentTrackData, dataOffset: number): Promise<Uint8Array> {
    const writer = new Writer()

    // Determine which optional fields we need
    const hasVariableDuration = !data.samples.every((s, i, arr) =>
      i === 0 || Math.round(s.duration * data.timescale) === Math.round(arr[0].duration * data.timescale))
    const hasVariableSize = !data.samples.every(s => s.size === data.samples[0].size)
    const hasKeyframes = data.samples.some(s => s.isKeyframe !== data.samples[0].isKeyframe)
    const hasCts = data.samples.some(s => s.compositionTimeOffset !== 0)

    const flags = 0x001 | // data-offset-present
      (hasVariableDuration ? 0x100 : 0) | // sample-duration-present
      (hasVariableSize ? 0x200 : 0) | // sample-size-present
      (hasKeyframes ? 0x400 : 0) | // sample-flags-present
      (hasCts ? 0x800 : 0) // sample-composition-time-offset-present

    let sampleEntrySize = 0
    if (hasVariableDuration) sampleEntrySize += 4
    if (hasVariableSize) sampleEntrySize += 4
    if (hasKeyframes) sampleEntrySize += 4
    if (hasCts) sampleEntrySize += 4

    const size = 20 + data.samples.length * sampleEntrySize

    await writer.writeU32BE(size)
    await writer.writeFourCC('trun')
    await writer.writeU8(0) // version
    await writer.writeU8((flags >> 16) & 0xFF)
    await writer.writeU8((flags >> 8) & 0xFF)
    await writer.writeU8(flags & 0xFF)
    await writer.writeU32BE(data.samples.length)
    await writer.writeU32BE(dataOffset)

    for (const sample of data.samples) {
      if (hasVariableDuration) {
        await writer.writeU32BE(Math.round(sample.duration * data.timescale))
      }
      if (hasVariableSize) {
        await writer.writeU32BE(sample.size)
      }
      if (hasKeyframes) {
        // Sample flags: 0x10000 = non-sync, 0 = sync
        const sampleFlags = sample.isKeyframe ? 0 : 0x10000
        await writer.writeU32BE(sampleFlags)
      }
      if (hasCts) {
        await writer.writeI32BE(Math.round(sample.compositionTimeOffset * data.timescale))
      }
    }

    return writer.getBuffer()
  }

  private async buildFragmentMdat(): Promise<Uint8Array> {
    const writer = new Writer()

    let totalSize = 0
    for (const data of this.trackData.values()) {
      for (const sample of data.samples) {
        totalSize += sample.size
      }
    }

    await writer.writeU32BE(totalSize + 8)
    await writer.writeFourCC('mdat')

    for (const data of this.trackData.values()) {
      for (const sample of data.samples) {
        await writer.writeBytes(sample.data)
      }
    }

    return writer.getBuffer()
  }

  protected async writeTrailer(): Promise<void> {
    // Flush any remaining samples
    await this.flushFragment()

    // Write mfra (movie fragment random access) for seeking
    await this.writeMfra()
  }

  private async writeMfra(): Promise<void> {
    const writer = new Writer()

    // Build tfra boxes
    const _tfras: Uint8Array[] = []
    // For simplicity, we're not tracking random access points here
    // In a full implementation, we would track keyframe positions

    // mfro (movie fragment random access offset)
    const mfroSize = 16
    const mfraSize = 8 + mfroSize

    await writer.writeU32BE(mfraSize)
    await writer.writeFourCC('mfra')

    // mfro
    await writer.writeU32BE(mfroSize)
    await writer.writeFourCC('mfro')
    await writer.writeU32BE(0) // version + flags
    await writer.writeU32BE(mfraSize) // size of mfra box

    await this.writer.writeBytes(writer.getBuffer())
  }
}
