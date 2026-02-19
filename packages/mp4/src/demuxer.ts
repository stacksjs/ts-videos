/**
 * MP4/MOV demuxer implementation
 */

import type { Source } from 'ts-videos/reader'
import type { Track, VideoTrack, AudioTrack, Metadata, EncodedPacket, VideoCodec, AudioCodec } from 'ts-videos/types'
import { Demuxer } from 'ts-videos/demuxer'
import { Reader } from 'ts-videos/reader'
import type {
  Box, FtypBox, MvhdBox, TkhdBox, MdhdBox, HdlrBox, StsdBox,
  SttsBox, CttsBox, StscBox, StszBox, StcoBox, Co64Box, StssBox,
  VideoSampleEntry, AudioSampleEntry, AvcCBox, HvcCBox, EsdsBox,
  MoofBox, TrafBox, TrunBox,
} from './boxes'
import {
  BOX_HEADER_SIZE, EXTENDED_BOX_HEADER_SIZE, CONTAINER_BOXES,
  readFourCC, parseLanguageCode, isVideoHandler, isAudioHandler,
  TIMESCALE_1904_TO_1970,
} from './boxes'

interface TrackInfo {
  id: number
  index: number
  type: 'video' | 'audio' | 'subtitle'
  timescale: number
  duration: bigint
  samples: SampleInfo[]
  currentSampleIndex: number
}

interface SampleInfo {
  offset: number
  size: number
  timestamp: number
  duration: number
  isKeyframe: boolean
  compositionTimeOffset: number
}

export class Mp4Demuxer extends Demuxer {
  private movieTimescale = 1000
  private movieDuration = 0n
  private trackInfos: TrackInfo[] = []
  private moovBox: Box | null = null
  private mdatOffset = 0
  private fragmented = false
  private _initialized = false
  private majorBrand = ''

  get formatName(): string {
    return this.majorBrand === 'qt  ' ? 'mov' : 'mp4'
  }

  get mimeType(): string {
    const videoTrack = this._tracks?.find(t => t.type === 'video')
    const audioTrack = this._tracks?.find(t => t.type === 'audio')

    let codecs = ''
    if (videoTrack && audioTrack) {
      codecs = `${this.getCodecString(videoTrack)}, ${this.getCodecString(audioTrack)}`
    }
    else if (videoTrack) {
      codecs = this.getCodecString(videoTrack)
    }
    else if (audioTrack) {
      codecs = this.getCodecString(audioTrack)
    }

    const type = this.majorBrand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
    return codecs ? `${type}; codecs="${codecs}"` : type
  }

  private getCodecString(track: Track): string {
    if (track.type === 'video') {
      const vt = track as VideoTrack
      if (vt.codec === 'h264' && vt.codecDescription) {
        const desc = vt.codecDescription
        if (desc.length >= 4) {
          const profile = desc[1].toString(16).padStart(2, '0')
          const compat = desc[2].toString(16).padStart(2, '0')
          const level = desc[3].toString(16).padStart(2, '0')
          return `avc1.${profile}${compat}${level}`
        }
        return 'avc1'
      }
      if (vt.codec === 'h265') return 'hev1'
      if (vt.codec === 'vp9') return 'vp09'
      if (vt.codec === 'av1') return 'av01'
      return vt.codec
    }
    if (track.type === 'audio') {
      const at = track as AudioTrack
      if (at.codec === 'aac') return 'mp4a.40.2'
      if (at.codec === 'mp3') return 'mp4a.40.34'
      if (at.codec === 'opus') return 'opus'
      if (at.codec === 'flac') return 'flac'
      return at.codec
    }
    return 'unknown'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.parseTopLevelBoxes()
    await this.buildTracks()
    await this.buildSampleTables()
  }

  private async parseTopLevelBoxes(): Promise<void> {
    const fileSize = await this.reader.getSize()
    let pos = 0

    while (fileSize === null || pos < fileSize) {
      this.reader.position = pos

      const sizeField = await this.reader.readU32BE()
      if (sizeField === null) break

      const type = await this.reader.readFourCC()
      if (!type) break

      let size = sizeField
      if (size === 1) {
        const extendedSize = await this.reader.readU64BE()
        if (extendedSize === null) break
        size = Number(extendedSize)
      }
      else if (size === 0) {
        size = (fileSize ?? 0) - pos
      }

      if (type === 'ftyp') {
        await this.parseFtyp(pos, size)
      }
      else if (type === 'moov') {
        this.moovBox = { type, size, offset: pos }
        await this.parseMoov(pos, size)
      }
      else if (type === 'mdat') {
        this.mdatOffset = pos + BOX_HEADER_SIZE
      }
      else if (type === 'moof') {
        this.fragmented = true
      }

      pos += size
    }
  }

  private async parseFtyp(offset: number, size: number): Promise<void> {
    this.reader.position = offset + BOX_HEADER_SIZE
    this.majorBrand = await this.reader.readFourCC() ?? ''
    await this.reader.readU32BE()

    const brandsCount = (size - 16) / 4
    for (let i = 0; i < brandsCount; i++) {
      await this.reader.readFourCC()
    }
  }

  private async parseMoov(offset: number, size: number): Promise<void> {
    await this.parseContainerBox(offset + BOX_HEADER_SIZE, size - BOX_HEADER_SIZE)
  }

  private async parseContainerBox(offset: number, size: number): Promise<Box[]> {
    const boxes: Box[] = []
    let pos = offset
    const end = offset + size

    while (pos < end) {
      this.reader.position = pos

      const sizeField = await this.reader.readU32BE()
      if (sizeField === null) break

      const type = await this.reader.readFourCC()
      if (!type) break

      let boxSize = sizeField
      let headerSize = BOX_HEADER_SIZE

      if (boxSize === 1) {
        const extendedSize = await this.reader.readU64BE()
        if (extendedSize === null) break
        boxSize = Number(extendedSize)
        headerSize = EXTENDED_BOX_HEADER_SIZE
      }
      else if (boxSize === 0) {
        boxSize = end - pos
      }

      const box: Box = { type, size: boxSize, offset: pos }

      if (CONTAINER_BOXES.has(type)) {
        box.children = await this.parseContainerBox(pos + headerSize, boxSize - headerSize)
      }

      boxes.push(box)
      pos += boxSize
    }

    return boxes
  }

  private async buildTracks(): Promise<void> {
    if (!this.moovBox) {
      throw new Error('No moov box found')
    }

    const moovChildren = await this.parseContainerBox(
      this.moovBox.offset + BOX_HEADER_SIZE,
      this.moovBox.size - BOX_HEADER_SIZE,
    )

    const mvhdBox = moovChildren.find(b => b.type === 'mvhd')
    if (mvhdBox) {
      await this.parseMvhd(mvhdBox)
    }

    const trakBoxes = moovChildren.filter(b => b.type === 'trak')
    this._tracks = []

    for (let i = 0; i < trakBoxes.length; i++) {
      const track = await this.parseTrack(trakBoxes[i], i)
      if (track) {
        this._tracks.push(track)
      }
    }

    this._metadata = await this.parseMetadata(moovChildren)
    this._duration = Number(this.movieDuration) / this.movieTimescale
  }

  private async parseMvhd(box: Box): Promise<void> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    const version = await this.reader.readU8()
    if (version === null) return

    await this.reader.skip(3)

    if (version === 1) {
      await this.reader.skip(16)
      this.movieTimescale = (await this.reader.readU32BE()) ?? 1000
      this.movieDuration = (await this.reader.readU64BE()) ?? 0n
    }
    else {
      await this.reader.skip(8)
      this.movieTimescale = (await this.reader.readU32BE()) ?? 1000
      this.movieDuration = BigInt((await this.reader.readU32BE()) ?? 0)
    }
  }

  private async parseTrack(trakBox: Box, index: number): Promise<Track | null> {
    const children = trakBox.children ?? []

    const tkhdBox = children.find(b => b.type === 'tkhd')
    const mdiaBox = children.find(b => b.type === 'mdia')

    if (!tkhdBox || !mdiaBox) return null

    const tkhd = await this.parseTkhd(tkhdBox)
    const mdiaChildren = mdiaBox.children ?? []

    const mdhdBox = mdiaChildren.find(b => b.type === 'mdhd')
    const hdlrBox = mdiaChildren.find(b => b.type === 'hdlr')
    const minfBox = mdiaChildren.find(b => b.type === 'minf')

    if (!mdhdBox || !hdlrBox || !minfBox) return null

    const mdhd = await this.parseMdhd(mdhdBox)
    const hdlr = await this.parseHdlr(hdlrBox)

    const minfChildren = minfBox.children ?? []
    const stblBox = minfChildren.find(b => b.type === 'stbl')
    if (!stblBox) return null

    const stblChildren = stblBox.children ?? []
    const stsdBox = stblChildren.find(b => b.type === 'stsd')
    if (!stsdBox) return null

    const stsd = await this.parseStsd(stsdBox, hdlr.handlerType)

    const trackInfo: TrackInfo = {
      id: tkhd.trackId,
      index,
      type: isVideoHandler(hdlr.handlerType) ? 'video' : isAudioHandler(hdlr.handlerType) ? 'audio' : 'subtitle',
      timescale: mdhd.timescale,
      duration: mdhd.duration,
      samples: [],
      currentSampleIndex: 0,
    }
    this.trackInfos.push(trackInfo)

    if (isVideoHandler(hdlr.handlerType) && stsd.entries.length > 0) {
      const entry = stsd.entries[0] as VideoSampleEntry
      const track: VideoTrack = {
        type: 'video',
        id: tkhd.trackId,
        index,
        codec: this.getVideoCodec(entry.type),
        width: entry.width,
        height: entry.height,
        frameRate: this.calculateFrameRate(trackInfo),
        isDefault: (tkhd.flags & 0x1) !== 0,
        language: mdhd.language,
        codecDescription: this.extractCodecDescription(entry),
        rotation: this.getRotation(tkhd.matrix),
      }
      return track
    }

    if (isAudioHandler(hdlr.handlerType) && stsd.entries.length > 0) {
      const entry = stsd.entries[0] as AudioSampleEntry
      const track: AudioTrack = {
        type: 'audio',
        id: tkhd.trackId,
        index,
        codec: this.getAudioCodec(entry.type),
        sampleRate: entry.sampleRate,
        channels: entry.channelCount,
        bitsPerSample: entry.sampleSize,
        isDefault: (tkhd.flags & 0x1) !== 0,
        language: mdhd.language,
        codecDescription: this.extractCodecDescription(entry),
      }
      return track
    }

    return null
  }

  private async parseTkhd(box: Box): Promise<{ trackId: number, flags: number, width: number, height: number, matrix: number[] }> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    const version = await this.reader.readU8()
    const flags = ((await this.reader.readU8()) ?? 0) << 16 |
                  ((await this.reader.readU8()) ?? 0) << 8 |
                  ((await this.reader.readU8()) ?? 0)

    let trackId = 0

    if (version === 1) {
      await this.reader.skip(16)
      trackId = (await this.reader.readU32BE()) ?? 0
      await this.reader.skip(4 + 8)
    }
    else {
      await this.reader.skip(8)
      trackId = (await this.reader.readU32BE()) ?? 0
      await this.reader.skip(4 + 4)
    }

    await this.reader.skip(8)
    const matrix: number[] = []
    for (let i = 0; i < 9; i++) {
      matrix.push((await this.reader.readI32BE()) ?? 0)
    }

    const width = ((await this.reader.readU32BE()) ?? 0) / 65536
    const height = ((await this.reader.readU32BE()) ?? 0) / 65536

    return { trackId, flags, width, height, matrix }
  }

  private async parseMdhd(box: Box): Promise<{ timescale: number, duration: bigint, language: string }> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    const version = await this.reader.readU8()
    await this.reader.skip(3)

    let timescale = 1000
    let duration = 0n

    if (version === 1) {
      await this.reader.skip(16)
      timescale = (await this.reader.readU32BE()) ?? 1000
      duration = (await this.reader.readU64BE()) ?? 0n
    }
    else {
      await this.reader.skip(8)
      timescale = (await this.reader.readU32BE()) ?? 1000
      duration = BigInt((await this.reader.readU32BE()) ?? 0)
    }

    const langCode = (await this.reader.readU16BE()) ?? 0
    const language = parseLanguageCode(langCode)

    return { timescale, duration, language }
  }

  private async parseHdlr(box: Box): Promise<{ handlerType: string, name: string }> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4 + 4)
    const handlerType = await this.reader.readFourCC() ?? ''
    await this.reader.skip(12)

    const remainingSize = box.size - BOX_HEADER_SIZE - 24
    const name = remainingSize > 0 ? await this.reader.readString(remainingSize) ?? '' : ''

    return { handlerType, name: name.replace(/\0/g, '') }
  }

  private async parseStsd(box: Box, handlerType: string): Promise<{ entries: (VideoSampleEntry | AudioSampleEntry)[] }> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const entryCount = (await this.reader.readU32BE()) ?? 0

    const entries: (VideoSampleEntry | AudioSampleEntry)[] = []

    for (let i = 0; i < entryCount; i++) {
      const entrySize = (await this.reader.readU32BE()) ?? 0
      const entryType = await this.reader.readFourCC() ?? ''
      const startPos = this.reader.position

      await this.reader.skip(6)
      const dataReferenceIndex = (await this.reader.readU16BE()) ?? 0

      if (isVideoHandler(handlerType)) {
        await this.reader.skip(16)
        const width = (await this.reader.readU16BE()) ?? 0
        const height = (await this.reader.readU16BE()) ?? 0
        const horizResolution = (await this.reader.readU32BE()) ?? 0
        const vertResolution = (await this.reader.readU32BE()) ?? 0
        await this.reader.skip(4)
        const frameCount = (await this.reader.readU16BE()) ?? 1
        const compressorNameLen = (await this.reader.readU8()) ?? 0
        const compressorName = await this.reader.readString(31) ?? ''
        const depth = (await this.reader.readU16BE()) ?? 24
        await this.reader.skip(2)

        const extensions = await this.parseExtensions(startPos + entrySize - 8)

        entries.push({
          type: entryType,
          dataReferenceIndex,
          width,
          height,
          horizResolution,
          vertResolution,
          frameCount,
          compressorName: compressorName.slice(0, compressorNameLen),
          depth,
          extensions,
          data: new Uint8Array(0),
        })
      }
      else if (isAudioHandler(handlerType)) {
        await this.reader.skip(8)
        const channelCount = (await this.reader.readU16BE()) ?? 2
        const sampleSize = (await this.reader.readU16BE()) ?? 16
        await this.reader.skip(4)
        const sampleRate = ((await this.reader.readU32BE()) ?? 44100 << 16) >> 16

        const extensions = await this.parseExtensions(startPos + entrySize - 8)

        entries.push({
          type: entryType,
          dataReferenceIndex,
          channelCount,
          sampleSize,
          sampleRate,
          extensions,
          data: new Uint8Array(0),
        })
      }

      this.reader.position = startPos + entrySize - 8
    }

    return { entries }
  }

  private async parseExtensions(endPos: number): Promise<Box[]> {
    const extensions: Box[] = []

    while (this.reader.position < endPos) {
      const size = (await this.reader.readU32BE()) ?? 0
      if (size < 8) break

      const type = await this.reader.readFourCC() ?? ''
      const data = await this.reader.readBytes(size - 8)

      extensions.push({
        type,
        size,
        offset: this.reader.position - size,
        data: data ?? undefined,
      })
    }

    return extensions
  }

  private getVideoCodec(type: string): VideoCodec {
    switch (type) {
      case 'avc1':
      case 'avc3':
        return 'h264'
      case 'hev1':
      case 'hvc1':
        return 'h265'
      case 'vp08':
        return 'vp8'
      case 'vp09':
        return 'vp9'
      case 'av01':
        return 'av1'
      case 'mp4v':
        return 'mpeg4'
      default:
        return 'unknown'
    }
  }

  private getAudioCodec(type: string): AudioCodec {
    switch (type) {
      case 'mp4a':
        return 'aac'
      case '.mp3':
      case 'mp3 ':
        return 'mp3'
      case 'Opus':
        return 'opus'
      case 'fLaC':
        return 'flac'
      case 'alac':
        return 'alac'
      case 'ac-3':
        return 'ac3'
      case 'ec-3':
        return 'eac3'
      default:
        return 'unknown'
    }
  }

  private extractCodecDescription(entry: VideoSampleEntry | AudioSampleEntry): Uint8Array | undefined {
    for (const ext of entry.extensions) {
      if (ext.type === 'avcC' || ext.type === 'hvcC' || ext.type === 'av1C' || ext.type === 'esds') {
        return ext.data
      }
    }
    return undefined
  }

  private getRotation(matrix: number[]): 0 | 90 | 180 | 270 {
    const a = matrix[0] / 65536
    const b = matrix[1] / 65536
    const c = matrix[3] / 65536
    const d = matrix[4] / 65536

    if (Math.abs(a - 1) < 0.01 && Math.abs(d - 1) < 0.01) return 0
    if (Math.abs(b - 1) < 0.01 && Math.abs(c + 1) < 0.01) return 90
    if (Math.abs(a + 1) < 0.01 && Math.abs(d + 1) < 0.01) return 180
    if (Math.abs(b + 1) < 0.01 && Math.abs(c - 1) < 0.01) return 270

    return 0
  }

  private calculateFrameRate(_trackInfo: TrackInfo): number | undefined {
    return undefined
  }

  private async parseMetadata(_boxes: Box[]): Promise<Metadata> {
    return {}
  }

  private async buildSampleTables(): Promise<void> {
    if (!this.moovBox) return

    const moovChildren = await this.parseContainerBox(
      this.moovBox.offset + BOX_HEADER_SIZE,
      this.moovBox.size - BOX_HEADER_SIZE,
    )

    const trakBoxes = moovChildren.filter(b => b.type === 'trak')

    for (let i = 0; i < trakBoxes.length && i < this.trackInfos.length; i++) {
      await this.buildSampleTable(trakBoxes[i], this.trackInfos[i])
    }
  }

  private async buildSampleTable(trakBox: Box, trackInfo: TrackInfo): Promise<void> {
    const children = trakBox.children ?? []
    const mdiaBox = children.find(b => b.type === 'mdia')
    if (!mdiaBox?.children) return

    const minfBox = mdiaBox.children.find(b => b.type === 'minf')
    if (!minfBox?.children) return

    const stblBox = minfBox.children.find(b => b.type === 'stbl')
    if (!stblBox?.children) return

    const stblChildren = stblBox.children

    const sttsBox = stblChildren.find(b => b.type === 'stts')
    const cttsBox = stblChildren.find(b => b.type === 'ctts')
    const stscBox = stblChildren.find(b => b.type === 'stsc')
    const stszBox = stblChildren.find(b => b.type === 'stsz')
    const stcoBox = stblChildren.find(b => b.type === 'stco')
    const co64Box = stblChildren.find(b => b.type === 'co64')
    const stssBox = stblChildren.find(b => b.type === 'stss')

    if (!sttsBox || !stscBox || !stszBox || (!stcoBox && !co64Box)) return

    const stts = await this.parseStts(sttsBox)
    const ctts = cttsBox ? await this.parseCtts(cttsBox) : null
    const stsc = await this.parseStsc(stscBox)
    const stsz = await this.parseStsz(stszBox)
    const chunkOffsets = stcoBox ? await this.parseStco(stcoBox) : await this.parseCo64(co64Box!)
    const keyframes = stssBox ? new Set(await this.parseStss(stssBox)) : null

    let sampleIndex = 0
    let timestamp = 0
    let sttsIndex = 0
    let sttsRemaining = stts.length > 0 ? stts[0].sampleCount : 0
    let cttsIndex = 0
    let cttsRemaining = ctts && ctts.length > 0 ? ctts[0].sampleCount : 0

    for (let chunkIndex = 0; chunkIndex < chunkOffsets.length; chunkIndex++) {
      const chunkOffset = chunkOffsets[chunkIndex]
      const samplesInChunk = this.getSamplesPerChunk(stsc, chunkIndex + 1)
      let offsetInChunk = 0

      for (let j = 0; j < samplesInChunk; j++) {
        const size = stsz.sampleSize > 0 ? stsz.sampleSize : (stsz.entrySizes[sampleIndex] ?? 0)
        const duration = stts[sttsIndex]?.sampleDelta ?? 0
        const cto = ctts && ctts[cttsIndex] ? ctts[cttsIndex].sampleOffset : 0
        const isKeyframe = keyframes === null || keyframes.has(sampleIndex + 1)

        trackInfo.samples.push({
          offset: chunkOffset + offsetInChunk,
          size,
          timestamp: timestamp / trackInfo.timescale,
          duration: duration / trackInfo.timescale,
          isKeyframe,
          compositionTimeOffset: cto / trackInfo.timescale,
        })

        offsetInChunk += size
        timestamp += duration
        sampleIndex++

        sttsRemaining--
        if (sttsRemaining === 0 && sttsIndex < stts.length - 1) {
          sttsIndex++
          sttsRemaining = stts[sttsIndex].sampleCount
        }

        if (ctts) {
          cttsRemaining--
          if (cttsRemaining === 0 && cttsIndex < ctts.length - 1) {
            cttsIndex++
            cttsRemaining = ctts[cttsIndex].sampleCount
          }
        }
      }
    }
  }

  private async parseStts(box: Box): Promise<{ sampleCount: number, sampleDelta: number }[]> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const entryCount = (await this.reader.readU32BE()) ?? 0
    const entries: { sampleCount: number, sampleDelta: number }[] = []

    for (let i = 0; i < entryCount; i++) {
      const sampleCount = (await this.reader.readU32BE()) ?? 0
      const sampleDelta = (await this.reader.readU32BE()) ?? 0
      entries.push({ sampleCount, sampleDelta })
    }

    return entries
  }

  private async parseCtts(box: Box): Promise<{ sampleCount: number, sampleOffset: number }[]> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    const version = (await this.reader.readU8()) ?? 0
    await this.reader.skip(3)
    const entryCount = (await this.reader.readU32BE()) ?? 0
    const entries: { sampleCount: number, sampleOffset: number }[] = []

    for (let i = 0; i < entryCount; i++) {
      const sampleCount = (await this.reader.readU32BE()) ?? 0
      const sampleOffset = version === 1
        ? ((await this.reader.readI32BE()) ?? 0)
        : ((await this.reader.readU32BE()) ?? 0)
      entries.push({ sampleCount, sampleOffset })
    }

    return entries
  }

  private async parseStsc(box: Box): Promise<{ firstChunk: number, samplesPerChunk: number, sampleDescriptionIndex: number }[]> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const entryCount = (await this.reader.readU32BE()) ?? 0
    const entries: { firstChunk: number, samplesPerChunk: number, sampleDescriptionIndex: number }[] = []

    for (let i = 0; i < entryCount; i++) {
      const firstChunk = (await this.reader.readU32BE()) ?? 0
      const samplesPerChunk = (await this.reader.readU32BE()) ?? 0
      const sampleDescriptionIndex = (await this.reader.readU32BE()) ?? 0
      entries.push({ firstChunk, samplesPerChunk, sampleDescriptionIndex })
    }

    return entries
  }

  private async parseStsz(box: Box): Promise<{ sampleSize: number, sampleCount: number, entrySizes: number[] }> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const sampleSize = (await this.reader.readU32BE()) ?? 0
    const sampleCount = (await this.reader.readU32BE()) ?? 0
    const entrySizes: number[] = []

    if (sampleSize === 0) {
      for (let i = 0; i < sampleCount; i++) {
        entrySizes.push((await this.reader.readU32BE()) ?? 0)
      }
    }

    return { sampleSize, sampleCount, entrySizes }
  }

  private async parseStco(box: Box): Promise<number[]> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const entryCount = (await this.reader.readU32BE()) ?? 0
    const offsets: number[] = []

    for (let i = 0; i < entryCount; i++) {
      offsets.push((await this.reader.readU32BE()) ?? 0)
    }

    return offsets
  }

  private async parseCo64(box: Box): Promise<number[]> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const entryCount = (await this.reader.readU32BE()) ?? 0
    const offsets: number[] = []

    for (let i = 0; i < entryCount; i++) {
      offsets.push(Number((await this.reader.readU64BE()) ?? 0n))
    }

    return offsets
  }

  private async parseStss(box: Box): Promise<number[]> {
    this.reader.position = box.offset + BOX_HEADER_SIZE
    await this.reader.skip(4)
    const entryCount = (await this.reader.readU32BE()) ?? 0
    const samples: number[] = []

    for (let i = 0; i < entryCount; i++) {
      samples.push((await this.reader.readU32BE()) ?? 0)
    }

    return samples
  }

  private getSamplesPerChunk(stsc: { firstChunk: number, samplesPerChunk: number }[], chunkNumber: number): number {
    for (let i = stsc.length - 1; i >= 0; i--) {
      if (chunkNumber >= stsc[i].firstChunk) {
        return stsc[i].samplesPerChunk
      }
    }
    return 1
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    const trackInfo = this.trackInfos.find(t => t.id === trackId)
    if (!trackInfo || trackInfo.currentSampleIndex >= trackInfo.samples.length) {
      return null
    }

    const sample = trackInfo.samples[trackInfo.currentSampleIndex]
    trackInfo.currentSampleIndex++

    this.reader.position = sample.offset
    const data = await this.reader.readBytes(sample.size)
    if (!data) return null

    return {
      data,
      timestamp: sample.timestamp,
      duration: sample.duration,
      isKeyframe: sample.isKeyframe,
      trackId,
      compositionTimeOffset: sample.compositionTimeOffset,
    }
  }

  async seek(timeInSeconds: number): Promise<void> {
    for (const trackInfo of this.trackInfos) {
      let targetIndex = 0

      for (let i = 0; i < trackInfo.samples.length; i++) {
        if (trackInfo.samples[i].timestamp > timeInSeconds) {
          break
        }
        if (trackInfo.samples[i].isKeyframe) {
          targetIndex = i
        }
      }

      trackInfo.currentSampleIndex = targetIndex
    }
  }
}
