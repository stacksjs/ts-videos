/**
 * MPEG Transport Stream (MPEG-TS) codec package for ts-videos
 * Implements demuxing/muxing with PAT/PMT parsing
 */

import type { Source, Target, VideoTrack, AudioTrack, Track, EncodedPacket, MediaMetadata, VideoCodec, AudioCodec } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-videos'

// MPEG-TS constants
const TS_PACKET_SIZE = 188
const TS_SYNC_BYTE = 0x47
const PAT_PID = 0x0000
const _SDT_PID = 0x0011
const _NULL_PID = 0x1FFF

// Stream types
const STREAM_TYPE_MPEG1_VIDEO = 0x01
const STREAM_TYPE_MPEG2_VIDEO = 0x02
const STREAM_TYPE_MPEG1_AUDIO = 0x03
const STREAM_TYPE_MPEG2_AUDIO = 0x04
const _STREAM_TYPE_PRIVATE = 0x06
const STREAM_TYPE_AAC = 0x0F
const STREAM_TYPE_H264 = 0x1B
const STREAM_TYPE_H265 = 0x24
const STREAM_TYPE_AC3 = 0x81
const STREAM_TYPE_DTS = 0x82
const STREAM_TYPE_TRUEHD = 0x83

interface TsPacket {
  syncByte: number
  transportErrorIndicator: boolean
  payloadUnitStartIndicator: boolean
  transportPriority: boolean
  pid: number
  scramblingControl: number
  adaptationFieldControl: number
  continuityCounter: number
  adaptationField?: AdaptationField
  payload?: Uint8Array
}

interface AdaptationField {
  length: number
  discontinuityIndicator: boolean
  randomAccessIndicator: boolean
  elementaryStreamPriorityIndicator: boolean
  pcrFlag: boolean
  opcrFlag: boolean
  splicingPointFlag: boolean
  transportPrivateDataFlag: boolean
  adaptationFieldExtensionFlag: boolean
  pcr?: bigint
  opcr?: bigint
}

interface ProgramAssociationTable {
  transportStreamId: number
  programs: Map<number, number> // program_number -> PMT PID
}

interface ProgramMapTable {
  programNumber: number
  pcrPid: number
  streams: PmtStream[]
}

interface PmtStream {
  streamType: number
  elementaryPid: number
  esInfo: Uint8Array
}

interface ElementaryStream {
  pid: number
  streamType: number
  track: Track | null
  packets: TsElementaryPacket[]
  pesBuffer: Uint8Array[]
  pesLength: number
}

interface TsElementaryPacket {
  data: Uint8Array
  pts?: number
  dts?: number
  isKeyframe: boolean
}

function parsePacket(data: Uint8Array, offset: number): TsPacket | null {
  if (offset + TS_PACKET_SIZE > data.length) return null

  const syncByte = data[offset]
  if (syncByte !== TS_SYNC_BYTE) return null

  const b1 = data[offset + 1]
  const b2 = data[offset + 2]
  const b3 = data[offset + 3]

  const packet: TsPacket = {
    syncByte,
    transportErrorIndicator: (b1 & 0x80) !== 0,
    payloadUnitStartIndicator: (b1 & 0x40) !== 0,
    transportPriority: (b1 & 0x20) !== 0,
    pid: ((b1 & 0x1F) << 8) | b2,
    scramblingControl: (b3 >> 6) & 0x03,
    adaptationFieldControl: (b3 >> 4) & 0x03,
    continuityCounter: b3 & 0x0F,
  }

  let payloadStart = offset + 4

  // Parse adaptation field
  if (packet.adaptationFieldControl === 2 || packet.adaptationFieldControl === 3) {
    const afLength = data[payloadStart]
    payloadStart++

    if (afLength > 0) {
      const afFlags = data[payloadStart]
      packet.adaptationField = {
        length: afLength,
        discontinuityIndicator: (afFlags & 0x80) !== 0,
        randomAccessIndicator: (afFlags & 0x40) !== 0,
        elementaryStreamPriorityIndicator: (afFlags & 0x20) !== 0,
        pcrFlag: (afFlags & 0x10) !== 0,
        opcrFlag: (afFlags & 0x08) !== 0,
        splicingPointFlag: (afFlags & 0x04) !== 0,
        transportPrivateDataFlag: (afFlags & 0x02) !== 0,
        adaptationFieldExtensionFlag: (afFlags & 0x01) !== 0,
      }

      let afOffset = payloadStart + 1

      // Parse PCR
      if (packet.adaptationField.pcrFlag && afOffset + 6 <= payloadStart + afLength) {
        const pcrBase = (BigInt(data[afOffset]) << 25n) |
          (BigInt(data[afOffset + 1]) << 17n) |
          (BigInt(data[afOffset + 2]) << 9n) |
          (BigInt(data[afOffset + 3]) << 1n) |
          (BigInt(data[afOffset + 4]) >> 7n)
        const pcrExt = ((data[afOffset + 4] & 0x01) << 8) | data[afOffset + 5]
        packet.adaptationField.pcr = pcrBase * 300n + BigInt(pcrExt)
        afOffset += 6
      }
    }

    payloadStart += afLength
  }

  // Extract payload
  if (packet.adaptationFieldControl === 1 || packet.adaptationFieldControl === 3) {
    const payloadEnd = offset + TS_PACKET_SIZE
    if (payloadStart < payloadEnd) {
      packet.payload = data.subarray(payloadStart, payloadEnd)
    }
  }

  return packet
}

function parsePat(payload: Uint8Array): ProgramAssociationTable | null {
  if (payload.length < 8) return null

  // Skip pointer field if present
  let offset = payload[0] + 1

  const tableId = payload[offset]
  if (tableId !== 0x00) return null

  const sectionLength = ((payload[offset + 1] & 0x0F) << 8) | payload[offset + 2]
  const transportStreamId = (payload[offset + 3] << 8) | payload[offset + 4]

  const pat: ProgramAssociationTable = {
    transportStreamId,
    programs: new Map(),
  }

  // Parse program entries
  const entriesEnd = offset + 3 + sectionLength - 4 // -4 for CRC
  for (let i = offset + 8; i < entriesEnd && i + 4 <= payload.length; i += 4) {
    const programNumber = (payload[i] << 8) | payload[i + 1]
    const pid = ((payload[i + 2] & 0x1F) << 8) | payload[i + 3]
    pat.programs.set(programNumber, pid)
  }

  return pat
}

function parsePmt(payload: Uint8Array): ProgramMapTable | null {
  if (payload.length < 12) return null

  // Skip pointer field if present
  let offset = payload[0] + 1

  const tableId = payload[offset]
  if (tableId !== 0x02) return null

  const sectionLength = ((payload[offset + 1] & 0x0F) << 8) | payload[offset + 2]
  const programNumber = (payload[offset + 3] << 8) | payload[offset + 4]
  const pcrPid = ((payload[offset + 8] & 0x1F) << 8) | payload[offset + 9]
  const programInfoLength = ((payload[offset + 10] & 0x0F) << 8) | payload[offset + 11]

  const pmt: ProgramMapTable = {
    programNumber,
    pcrPid,
    streams: [],
  }

  // Parse stream entries
  let streamOffset = offset + 12 + programInfoLength
  const sectionEnd = offset + 3 + sectionLength - 4 // -4 for CRC

  while (streamOffset + 5 <= sectionEnd && streamOffset + 5 <= payload.length) {
    const streamType = payload[streamOffset]
    const elementaryPid = ((payload[streamOffset + 1] & 0x1F) << 8) | payload[streamOffset + 2]
    const esInfoLength = ((payload[streamOffset + 3] & 0x0F) << 8) | payload[streamOffset + 4]

    const esInfo = payload.subarray(streamOffset + 5, streamOffset + 5 + esInfoLength)

    pmt.streams.push({ streamType, elementaryPid, esInfo })
    streamOffset += 5 + esInfoLength
  }

  return pmt
}

function parsePes(data: Uint8Array): { pts?: number, dts?: number, payload: Uint8Array } | null {
  if (data.length < 9) return null

  // Check PES start code
  if (data[0] !== 0x00 || data[1] !== 0x00 || data[2] !== 0x01) {
    return null
  }

  const _streamId = data[3]
  const _pesPacketLength = (data[4] << 8) | data[5]
  const headerDataLength = data[8]

  let pts: number | undefined
  let dts: number | undefined

  const ptsDtsFlags = (data[7] >> 6) & 0x03

  if (ptsDtsFlags >= 2 && data.length >= 14) {
    // PTS present
    pts = (((data[9] >> 1) & 0x07) * 0x100000000) +
          ((data[10] << 22) | ((data[11] >> 1) << 15) | (data[12] << 7) | (data[13] >> 1))
    pts = pts / 90000 // Convert to seconds
  }

  if (ptsDtsFlags === 3 && data.length >= 19) {
    // DTS present
    dts = (((data[14] >> 1) & 0x07) * 0x100000000) +
          ((data[15] << 22) | ((data[16] >> 1) << 15) | (data[17] << 7) | (data[18] >> 1))
    dts = dts / 90000 // Convert to seconds
  }

  const payloadStart = 9 + headerDataLength
  const payload = data.subarray(payloadStart)

  return { pts, dts, payload }
}

function streamTypeToCodec(streamType: number): string {
  switch (streamType) {
    case STREAM_TYPE_MPEG1_VIDEO: return 'mpeg1'
    case STREAM_TYPE_MPEG2_VIDEO: return 'mpeg2'
    case STREAM_TYPE_MPEG1_AUDIO: return 'mp3'
    case STREAM_TYPE_MPEG2_AUDIO: return 'mp3'
    case STREAM_TYPE_AAC: return 'aac'
    case STREAM_TYPE_H264: return 'h264'
    case STREAM_TYPE_H265: return 'h265'
    case STREAM_TYPE_AC3: return 'ac3'
    case STREAM_TYPE_DTS: return 'dts'
    case STREAM_TYPE_TRUEHD: return 'truehd'
    default: return 'unknown'
  }
}

function isVideoStreamType(streamType: number): boolean {
  return streamType === STREAM_TYPE_MPEG1_VIDEO ||
    streamType === STREAM_TYPE_MPEG2_VIDEO ||
    streamType === STREAM_TYPE_H264 ||
    streamType === STREAM_TYPE_H265
}

function isAudioStreamType(streamType: number): boolean {
  return streamType === STREAM_TYPE_MPEG1_AUDIO ||
    streamType === STREAM_TYPE_MPEG2_AUDIO ||
    streamType === STREAM_TYPE_AAC ||
    streamType === STREAM_TYPE_AC3 ||
    streamType === STREAM_TYPE_DTS ||
    streamType === STREAM_TYPE_TRUEHD
}

export class TsDemuxer extends Demuxer {
  private pat: ProgramAssociationTable | null = null
  private pmts: Map<number, ProgramMapTable> = new Map()
  private streams: Map<number, ElementaryStream> = new Map()
  private currentPacketIndex: Map<number, number> = new Map()
  private _initialized = false

  get formatName(): string {
    return 'mpegts'
  }

  get mimeType(): string {
    return 'video/mp2t'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.parseStream()
    this.buildTracks()
  }

  private async parseStream(): Promise<void> {
    this.reader.position = 0
    const fileSize = await this.reader.getSize() ?? 0

    // Read in chunks for efficiency
    const chunkSize = TS_PACKET_SIZE * 1000
    const pmtPids: Set<number> = new Set()

    while (this.reader.position < fileSize) {
      const chunk = await this.reader.readBytes(Math.min(chunkSize, fileSize - this.reader.position))
      if (!chunk) break

      let offset = 0

      // Find sync byte
      while (offset < chunk.length && chunk[offset] !== TS_SYNC_BYTE) {
        offset++
      }

      while (offset + TS_PACKET_SIZE <= chunk.length) {
        const packet = parsePacket(chunk, offset)
        if (!packet) {
          offset++
          continue
        }

        if (packet.pid === PAT_PID && packet.payload) {
          const pat = parsePat(packet.payload)
          if (pat) {
            this.pat = pat
            for (const [progNum, pmtPid] of pat.programs) {
              if (progNum !== 0) { // Skip NIT
                pmtPids.add(pmtPid)
              }
            }
          }
        }
        else if (pmtPids.has(packet.pid) && packet.payload) {
          const pmt = parsePmt(packet.payload)
          if (pmt) {
            this.pmts.set(packet.pid, pmt)
            for (const stream of pmt.streams) {
              if (!this.streams.has(stream.elementaryPid)) {
                this.streams.set(stream.elementaryPid, {
                  pid: stream.elementaryPid,
                  streamType: stream.streamType,
                  track: null,
                  packets: [],
                  pesBuffer: [],
                  pesLength: 0,
                })
              }
            }
          }
        }
        else if (this.streams.has(packet.pid) && packet.payload) {
          const stream = this.streams.get(packet.pid)!

          if (packet.payloadUnitStartIndicator) {
            // Flush previous PES packet
            if (stream.pesBuffer.length > 0) {
              this.flushPesPacket(stream)
            }
          }

          stream.pesBuffer.push(packet.payload)
          stream.pesLength += packet.payload.length
        }

        offset += TS_PACKET_SIZE
      }
    }

    // Flush remaining PES packets
    for (const stream of this.streams.values()) {
      if (stream.pesBuffer.length > 0) {
        this.flushPesPacket(stream)
      }
    }
  }

  private flushPesPacket(stream: ElementaryStream): void {
    const totalLength = stream.pesBuffer.reduce((sum, buf) => sum + buf.length, 0)
    const pesData = new Uint8Array(totalLength)
    let offset = 0
    for (const buf of stream.pesBuffer) {
      pesData.set(buf, offset)
      offset += buf.length
    }

    stream.pesBuffer = []
    stream.pesLength = 0

    const pes = parsePes(pesData)
    if (pes && pes.payload.length > 0) {
      const isKeyframe = isVideoStreamType(stream.streamType)
        ? this.detectKeyframe(pes.payload, stream.streamType)
        : true

      stream.packets.push({
        data: pes.payload,
        pts: pes.pts,
        dts: pes.dts,
        isKeyframe,
      })
    }
  }

  private detectKeyframe(data: Uint8Array, streamType: number): boolean {
    if (streamType === STREAM_TYPE_H264) {
      // Look for IDR NAL unit (type 5)
      for (let i = 0; i < data.length - 4; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
          const nalType = data[i + 3] & 0x1F
          if (nalType === 5) return true
        }
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
          const nalType = data[i + 4] & 0x1F
          if (nalType === 5) return true
        }
      }
      return false
    }

    if (streamType === STREAM_TYPE_H265) {
      // Look for IDR NAL units (types 19, 20)
      for (let i = 0; i < data.length - 5; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
          const nalType = (data[i + 3] >> 1) & 0x3F
          if (nalType === 19 || nalType === 20) return true
        }
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
          const nalType = (data[i + 4] >> 1) & 0x3F
          if (nalType === 19 || nalType === 20) return true
        }
      }
      return false
    }

    // MPEG-1/2 video: look for picture start code with I-frame type
    if (streamType === STREAM_TYPE_MPEG1_VIDEO || streamType === STREAM_TYPE_MPEG2_VIDEO) {
      for (let i = 0; i < data.length - 5; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && data[i + 3] === 0x00) {
          const pictureType = (data[i + 5] >> 3) & 0x07
          if (pictureType === 1) return true // I-frame
        }
      }
      return false
    }

    return true
  }

  private buildTracks(): void {
    this._tracks = []
    let trackId = 1

    for (const stream of this.streams.values()) {
      const codec = streamTypeToCodec(stream.streamType)

      if (isVideoStreamType(stream.streamType)) {
        const track: VideoTrack = {
          type: 'video',
          id: trackId++,
          index: this._tracks.length,
          codec: codec as VideoCodec,
          width: 0, // Would need to parse codec-specific data
          height: 0,
          isDefault: this._tracks.filter(t => t.type === 'video').length === 0,
        }
        stream.track = track
        this._tracks.push(track)
      }
      else if (isAudioStreamType(stream.streamType)) {
        const track: AudioTrack = {
          type: 'audio',
          id: trackId++,
          index: this._tracks.length,
          codec: codec as AudioCodec,
          sampleRate: 48000, // Default, would need to parse from stream
          channels: 2,
          isDefault: this._tracks.filter(t => t.type === 'audio').length === 0,
        }
        stream.track = track
        this._tracks.push(track)
      }

      this.currentPacketIndex.set(stream.pid, 0)
    }

    // Calculate duration
    let maxDuration = 0
    for (const stream of this.streams.values()) {
      if (stream.packets.length > 0) {
        const lastPacket = stream.packets[stream.packets.length - 1]
        if (lastPacket.pts !== undefined && lastPacket.pts > maxDuration) {
          maxDuration = lastPacket.pts
        }
      }
    }
    this._duration = maxDuration

    this._metadata = {}
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    const track = this._tracks?.find(t => t.id === trackId)
    if (!track) return null

    for (const stream of this.streams.values()) {
      if (stream.track?.id === trackId) {
        const index = this.currentPacketIndex.get(stream.pid) ?? 0
        if (index >= stream.packets.length) return null

        const packet = stream.packets[index]
        this.currentPacketIndex.set(stream.pid, index + 1)

        return {
          data: packet.data,
          timestamp: packet.pts ?? 0,
          duration: undefined,
          isKeyframe: packet.isKeyframe,
          trackId,
          pts: packet.pts,
          dts: packet.dts,
        }
      }
    }

    return null
  }

  async seek(timeInSeconds: number): Promise<void> {
    for (const stream of this.streams.values()) {
      for (let i = 0; i < stream.packets.length; i++) {
        const packet = stream.packets[i]
        if (packet.pts !== undefined && packet.pts >= timeInSeconds) {
          // Find nearest keyframe
          for (let j = i; j >= 0; j--) {
            if (stream.packets[j].isKeyframe) {
              this.currentPacketIndex.set(stream.pid, j)
              break
            }
          }
          break
        }
      }
    }
  }
}

export class TsMuxer extends Muxer {
  private packets: { pid: number, data: Uint8Array, pts?: number, dts?: number, isKeyframe: boolean }[] = []
  private nextPid = 0x100
  private pcrPid = 0x100
  private continuityCounters: Map<number, number> = new Map()
  private programNumber = 1

  get formatName(): string {
    return 'mpegts'
  }

  get mimeType(): string {
    return 'video/mp2t'
  }

  protected onTrackAdded(track: { type: string, config: unknown }): void {
    const pid = this.nextPid++
    if (track.type === 'video' && this.pcrPid === 0x100) {
      this.pcrPid = pid
    }
  }

  protected async writeHeader(): Promise<void> {
    // PAT and PMT will be written with first packet
  }

  protected async writeVideoPacket(track: unknown, packet: EncodedPacket): Promise<void> {
    const pid = 0x100 // First video PID
    this.packets.push({
      pid,
      data: packet.data,
      pts: packet.timestamp,
      dts: packet.dts ?? packet.timestamp,
      isKeyframe: packet.isKeyframe,
    })
  }

  protected async writeAudioPacket(track: unknown, packet: EncodedPacket): Promise<void> {
    const pid = 0x101 // First audio PID
    this.packets.push({
      pid,
      data: packet.data,
      pts: packet.timestamp,
      dts: packet.dts ?? packet.timestamp,
      isKeyframe: true,
    })
  }

  protected async writeSubtitlePacket(): Promise<void> {
    throw new Error('MPEG-TS subtitle support not implemented')
  }

  protected async writeTrailer(): Promise<void> {
    // Write PAT
    await this.writePat()

    // Write PMT
    await this.writePmt()

    // Write all packets
    for (const packet of this.packets) {
      await this.writeElementaryPacket(packet)
    }
  }

  private async writePat(): Promise<void> {
    const pat = new Uint8Array(TS_PACKET_SIZE)
    pat[0] = TS_SYNC_BYTE
    pat[1] = 0x40 // Payload unit start
    pat[2] = 0x00 // PAT PID = 0
    pat[3] = 0x10 | (this.getNextContinuityCounter(PAT_PID) & 0x0F)

    // PAT section
    const patSection = new Uint8Array([
      0x00, // Pointer field
      0x00, // Table ID
      0xB0, 0x0D, // Section length
      0x00, 0x01, // Transport stream ID
      0xC1, // Version, current/next
      0x00, 0x00, // Section number, last section
      0x00, 0x01, // Program number
      0xE0 | ((0x1000 >> 8) & 0x1F), 0x1000 & 0xFF, // PMT PID
    ])

    const crc = this.calculateCrc32(patSection.subarray(1))
    pat.set(patSection, 4)
    pat[4 + patSection.length] = (crc >> 24) & 0xFF
    pat[4 + patSection.length + 1] = (crc >> 16) & 0xFF
    pat[4 + patSection.length + 2] = (crc >> 8) & 0xFF
    pat[4 + patSection.length + 3] = crc & 0xFF

    // Fill rest with 0xFF
    pat.fill(0xFF, 4 + patSection.length + 4)

    await this.writer.writeBytes(pat)
  }

  private async writePmt(): Promise<void> {
    const pmt = new Uint8Array(TS_PACKET_SIZE)
    pmt[0] = TS_SYNC_BYTE
    pmt[1] = 0x50 // Payload unit start, PMT PID high bits
    pmt[2] = 0x00 // PMT PID low bits
    pmt[3] = 0x10 | (this.getNextContinuityCounter(0x1000) & 0x0F)

    const streams: Uint8Array[] = []
    for (const track of this.tracks) {
      const pid = track.type === 'video' ? 0x100 : 0x101
      const streamType = track.type === 'video' ? STREAM_TYPE_H264 : STREAM_TYPE_AAC
      streams.push(new Uint8Array([
        streamType,
        0xE0 | ((pid >> 8) & 0x1F),
        pid & 0xFF,
        0xF0, 0x00, // ES info length = 0
      ]))
    }

    const streamsData = new Uint8Array(streams.reduce((sum, s) => sum + s.length, 0))
    let offset = 0
    for (const s of streams) {
      streamsData.set(s, offset)
      offset += s.length
    }

    const sectionLength = 13 + streamsData.length

    const pmtSection = new Uint8Array([
      0x00, // Pointer field
      0x02, // Table ID
      0xB0 | ((sectionLength >> 8) & 0x0F), sectionLength & 0xFF,
      0x00, 0x01, // Program number
      0xC1, // Version, current/next
      0x00, 0x00, // Section number, last section
      0xE0 | ((this.pcrPid >> 8) & 0x1F), this.pcrPid & 0xFF, // PCR PID
      0xF0, 0x00, // Program info length = 0
    ])

    pmt.set(pmtSection, 4)
    pmt.set(streamsData, 4 + pmtSection.length)

    const crcStart = 4 + 1 // After pointer field
    const crcEnd = 4 + pmtSection.length + streamsData.length
    const crc = this.calculateCrc32(pmt.subarray(crcStart, crcEnd))
    pmt[crcEnd] = (crc >> 24) & 0xFF
    pmt[crcEnd + 1] = (crc >> 16) & 0xFF
    pmt[crcEnd + 2] = (crc >> 8) & 0xFF
    pmt[crcEnd + 3] = crc & 0xFF

    pmt.fill(0xFF, crcEnd + 4)

    await this.writer.writeBytes(pmt)
  }

  private async writeElementaryPacket(packet: { pid: number, data: Uint8Array, pts?: number, dts?: number, isKeyframe: boolean }): Promise<void> {
    // Create PES packet
    const pesHeader = this.createPesHeader(packet.pts, packet.dts)
    const pesData = new Uint8Array(pesHeader.length + packet.data.length)
    pesData.set(pesHeader, 0)
    pesData.set(packet.data, pesHeader.length)

    // Split into TS packets
    let offset = 0
    let first = true

    while (offset < pesData.length) {
      const tsPacket = new Uint8Array(TS_PACKET_SIZE)
      tsPacket[0] = TS_SYNC_BYTE
      tsPacket[1] = (first ? 0x40 : 0x00) | ((packet.pid >> 8) & 0x1F)
      tsPacket[2] = packet.pid & 0xFF

      const payloadSize = Math.min(TS_PACKET_SIZE - 4, pesData.length - offset)
      const stuffingSize = TS_PACKET_SIZE - 4 - payloadSize

      if (stuffingSize > 0) {
        // Need adaptation field for stuffing
        tsPacket[3] = 0x30 | (this.getNextContinuityCounter(packet.pid) & 0x0F)
        tsPacket[4] = stuffingSize - 1
        if (stuffingSize > 1) {
          tsPacket[5] = 0x00 // Adaptation field flags
          tsPacket.fill(0xFF, 6, 4 + stuffingSize)
        }
        tsPacket.set(pesData.subarray(offset, offset + payloadSize), 4 + stuffingSize)
      }
      else {
        tsPacket[3] = 0x10 | (this.getNextContinuityCounter(packet.pid) & 0x0F)
        tsPacket.set(pesData.subarray(offset, offset + payloadSize), 4)
      }

      await this.writer.writeBytes(tsPacket)
      offset += payloadSize
      first = false
    }
  }

  private createPesHeader(pts?: number, dts?: number): Uint8Array {
    const hasPts = pts !== undefined
    const hasDts = dts !== undefined && dts !== pts

    let headerLength = 9
    if (hasPts) headerLength += 5
    if (hasDts) headerLength += 5

    const header = new Uint8Array(headerLength)
    header[0] = 0x00
    header[1] = 0x00
    header[2] = 0x01
    header[3] = 0xE0 // Video stream ID
    header[4] = 0x00 // PES packet length (0 for video)
    header[5] = 0x00
    header[6] = 0x80 // Data alignment
    header[7] = (hasPts ? 0x80 : 0x00) | (hasDts ? 0x40 : 0x00)
    header[8] = (hasPts ? 5 : 0) + (hasDts ? 5 : 0)

    if (hasPts) {
      const pts90k = Math.floor(pts! * 90000)
      header[9] = 0x20 | ((pts90k >> 29) & 0x0E) | 0x01
      header[10] = (pts90k >> 22) & 0xFF
      header[11] = ((pts90k >> 14) & 0xFE) | 0x01
      header[12] = (pts90k >> 7) & 0xFF
      header[13] = ((pts90k << 1) & 0xFE) | 0x01
    }

    if (hasDts) {
      const dts90k = Math.floor(dts! * 90000)
      const offset = hasPts ? 14 : 9
      header[offset] = 0x10 | ((dts90k >> 29) & 0x0E) | 0x01
      header[offset + 1] = (dts90k >> 22) & 0xFF
      header[offset + 2] = ((dts90k >> 14) & 0xFE) | 0x01
      header[offset + 3] = (dts90k >> 7) & 0xFF
      header[offset + 4] = ((dts90k << 1) & 0xFE) | 0x01
    }

    return header
  }

  private getNextContinuityCounter(pid: number): number {
    const current = this.continuityCounters.get(pid) ?? 0
    const next = (current + 1) & 0x0F
    this.continuityCounters.set(pid, next)
    return current
  }

  private calculateCrc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF
    for (const byte of data) {
      for (let i = 0; i < 8; i++) {
        if (((crc >> 31) ^ ((byte >> (7 - i)) & 1)) & 1) {
          crc = (crc << 1) ^ 0x04C11DB7
        }
        else {
          crc = crc << 1
        }
      }
    }
    return crc >>> 0
  }
}

export class TsInputFormat extends InputFormat {
  get name(): string { return 'mpegts' }
  get mimeType(): string { return 'video/mp2t' }
  get extensions(): string[] { return ['ts', 'mts', 'm2ts', 'mts'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const sync = await reader.readU8()
    return sync === TS_SYNC_BYTE
  }

  createDemuxer(source: Source): Demuxer {
    return new TsDemuxer(source)
  }
}

export class TsOutputFormat extends OutputFormat {
  get name(): string { return 'mpegts' }
  get mimeType(): string { return 'video/mp2t' }
  get extension(): string { return 'ts' }

  createMuxer(target: Target): Muxer {
    return new TsMuxer(target)
  }
}

export const MPEGTS: TsInputFormat = new TsInputFormat()
export const MPEGTS_OUTPUT: TsOutputFormat = new TsOutputFormat()

// Export types
export type { TsPacket, AdaptationField, ProgramAssociationTable, ProgramMapTable, PmtStream, ElementaryStream, TsElementaryPacket }
