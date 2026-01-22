/**
 * EBML (Extensible Binary Meta Language) parser for Matroska/WebM
 */

export interface EbmlElement {
  id: number
  size: number
  dataOffset: number
  data?: Uint8Array
  children?: EbmlElement[]
}

export const EBML_IDS = {
  EBML: 0x1A45DFA3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42F7,
  EBMLMaxIDLength: 0x42F2,
  EBMLMaxSizeLength: 0x42F3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,

  Segment: 0x18538067,
  SeekHead: 0x114D9B74,
  Seek: 0x4DBB,
  SeekID: 0x53AB,
  SeekPosition: 0x53AC,

  Info: 0x1549A966,
  TimestampScale: 0x2AD7B1,
  Duration: 0x4489,
  MuxingApp: 0x4D80,
  WritingApp: 0x5741,
  DateUTC: 0x4461,
  Title: 0x7BA9,

  Tracks: 0x1654AE6B,
  TrackEntry: 0xAE,
  TrackNumber: 0xD7,
  TrackUID: 0x73C5,
  TrackType: 0x83,
  FlagEnabled: 0xB9,
  FlagDefault: 0x88,
  FlagForced: 0x55AA,
  FlagLacing: 0x9C,
  DefaultDuration: 0x23E383,
  Name: 0x536E,
  Language: 0x22B59C,
  CodecID: 0x86,
  CodecPrivate: 0x63A2,
  CodecName: 0x258688,

  Video: 0xE0,
  FlagInterlaced: 0x9A,
  StereoMode: 0x53B8,
  PixelWidth: 0xB0,
  PixelHeight: 0xBA,
  PixelCropBottom: 0x54AA,
  PixelCropTop: 0x54BB,
  PixelCropLeft: 0x54CC,
  PixelCropRight: 0x54DD,
  DisplayWidth: 0x54B0,
  DisplayHeight: 0x54BA,
  DisplayUnit: 0x54B2,
  AspectRatioType: 0x54B3,
  Colour: 0x55B0,
  MatrixCoefficients: 0x55B1,
  BitsPerChannel: 0x55B2,
  ChromaSubsamplingHorz: 0x55B3,
  ChromaSubsamplingVert: 0x55B4,
  CbSubsamplingHorz: 0x55B5,
  CbSubsamplingVert: 0x55B6,
  ChromaSitingHorz: 0x55B7,
  ChromaSitingVert: 0x55B8,
  Range: 0x55B9,
  TransferCharacteristics: 0x55BA,
  Primaries: 0x55BB,
  MaxCLL: 0x55BC,
  MaxFALL: 0x55BD,

  Audio: 0xE1,
  SamplingFrequency: 0xB5,
  OutputSamplingFrequency: 0x78B5,
  Channels: 0x9F,
  BitDepth: 0x6264,

  Cluster: 0x1F43B675,
  Timestamp: 0xE7,
  Position: 0xA7,
  PrevSize: 0xAB,
  SimpleBlock: 0xA3,
  BlockGroup: 0xA0,
  Block: 0xA1,
  BlockDuration: 0x9B,
  ReferenceBlock: 0xFB,
  DiscardPadding: 0x75A2,

  Cues: 0x1C53BB6B,
  CuePoint: 0xBB,
  CueTime: 0xB3,
  CueTrackPositions: 0xB7,
  CueTrack: 0xF7,
  CueClusterPosition: 0xF1,
  CueRelativePosition: 0xF0,
  CueDuration: 0xB2,
  CueBlockNumber: 0x5378,

  Tags: 0x1254C367,
  Tag: 0x7373,
  Targets: 0x63C0,
  TargetTypeValue: 0x68CA,
  TargetType: 0x63CA,
  TagTrackUID: 0x63C5,
  SimpleTag: 0x67C8,
  TagName: 0x45A3,
  TagLanguage: 0x447A,
  TagString: 0x4487,
  TagBinary: 0x4485,

  Chapters: 0x1043A770,
  Attachments: 0x1941A469,
}

export const TRACK_TYPES = {
  VIDEO: 1,
  AUDIO: 2,
  COMPLEX: 3,
  LOGO: 16,
  SUBTITLE: 17,
  BUTTONS: 18,
  CONTROL: 32,
  METADATA: 33,
}

export const CODEC_IDS = {
  VP8: 'V_VP8',
  VP9: 'V_VP9',
  AV1: 'V_AV1',
  H264: 'V_MPEG4/ISO/AVC',
  H265: 'V_MPEGH/ISO/HEVC',
  THEORA: 'V_THEORA',

  OPUS: 'A_OPUS',
  VORBIS: 'A_VORBIS',
  AAC: 'A_AAC',
  MP3: 'A_MPEG/L3',
  FLAC: 'A_FLAC',
  PCM_INT_LE: 'A_PCM/INT/LIT',
  PCM_INT_BE: 'A_PCM/INT/BIG',
  PCM_FLOAT: 'A_PCM/FLOAT/IEEE',

  WEBVTT_SUBTITLES: 'D_WEBVTT/SUBTITLES',
  WEBVTT_CAPTIONS: 'D_WEBVTT/CAPTIONS',
  WEBVTT_DESCRIPTIONS: 'D_WEBVTT/DESCRIPTIONS',
  WEBVTT_METADATA: 'D_WEBVTT/METADATA',
}

export const CONTAINER_ELEMENTS = new Set([
  EBML_IDS.EBML,
  EBML_IDS.Segment,
  EBML_IDS.SeekHead,
  EBML_IDS.Seek,
  EBML_IDS.Info,
  EBML_IDS.Tracks,
  EBML_IDS.TrackEntry,
  EBML_IDS.Video,
  EBML_IDS.Audio,
  EBML_IDS.Colour,
  EBML_IDS.Cluster,
  EBML_IDS.BlockGroup,
  EBML_IDS.Cues,
  EBML_IDS.CuePoint,
  EBML_IDS.CueTrackPositions,
  EBML_IDS.Tags,
  EBML_IDS.Tag,
  EBML_IDS.Targets,
  EBML_IDS.SimpleTag,
  EBML_IDS.Chapters,
  EBML_IDS.Attachments,
])

export function readEbmlId(data: Uint8Array, offset: number): { id: number, length: number } | null {
  if (offset >= data.length) return null

  const firstByte = data[offset]
  let length = 1
  let mask = 0x80

  while ((firstByte & mask) === 0 && length < 4) {
    mask >>= 1
    length++
  }

  if (length > 4 || offset + length > data.length) return null

  let id = 0
  for (let i = 0; i < length; i++) {
    id = (id << 8) | data[offset + i]
  }

  return { id, length }
}

export function readEbmlSize(data: Uint8Array, offset: number): { size: number, length: number, unknown: boolean } | null {
  if (offset >= data.length) return null

  const firstByte = data[offset]
  let length = 1
  let mask = 0x80

  while ((firstByte & mask) === 0 && length < 8) {
    mask >>= 1
    length++
  }

  if (length > 8 || offset + length > data.length) return null

  let size = firstByte & (mask - 1)
  for (let i = 1; i < length; i++) {
    size = (size * 256) + data[offset + i]
  }

  const maxValues = [0x7F - 1, 0x3FFF - 1, 0x1FFFFF - 1, 0x0FFFFFFF - 1]
  const unknown = length <= 4 && size === maxValues[length - 1] + 1

  return { size, length, unknown }
}

export function writeEbmlId(id: number): Uint8Array {
  if (id <= 0x7F) {
    return new Uint8Array([id])
  }
  else if (id <= 0x3FFF) {
    return new Uint8Array([(id >> 8), id & 0xFF])
  }
  else if (id <= 0x1FFFFF) {
    return new Uint8Array([(id >> 16), (id >> 8) & 0xFF, id & 0xFF])
  }
  else {
    return new Uint8Array([(id >> 24), (id >> 16) & 0xFF, (id >> 8) & 0xFF, id & 0xFF])
  }
}

export function writeEbmlSize(size: number, minLength = 1): Uint8Array {
  if (size < 0x7F && minLength <= 1) {
    return new Uint8Array([0x80 | size])
  }
  else if (size < 0x3FFF && minLength <= 2) {
    return new Uint8Array([0x40 | (size >> 8), size & 0xFF])
  }
  else if (size < 0x1FFFFF && minLength <= 3) {
    return new Uint8Array([0x20 | (size >> 16), (size >> 8) & 0xFF, size & 0xFF])
  }
  else if (size < 0x0FFFFFFF && minLength <= 4) {
    return new Uint8Array([0x10 | (size >> 24), (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF])
  }
  else {
    const hi = Math.floor(size / 0x100000000)
    const lo = size % 0x100000000
    return new Uint8Array([
      0x01,
      (hi >> 24) & 0xFF,
      (hi >> 16) & 0xFF,
      (hi >> 8) & 0xFF,
      hi & 0xFF,
      (lo >> 24) & 0xFF,
      (lo >> 16) & 0xFF,
      (lo >> 8) & 0xFF,
    ])
  }
}

export function readEbmlUint(data: Uint8Array): number {
  let value = 0
  for (let i = 0; i < data.length && i < 8; i++) {
    value = value * 256 + data[i]
  }
  return value
}

export function readEbmlInt(data: Uint8Array): number {
  if (data.length === 0) return 0

  let value = data[0] & 0x80 ? -1 : 0
  for (let i = 0; i < data.length; i++) {
    value = value * 256 + data[i]
  }
  return value
}

export function readEbmlFloat(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length === 4) {
    return view.getFloat32(0, false)
  }
  else if (data.length === 8) {
    return view.getFloat64(0, false)
  }
  return 0
}

export function readEbmlString(data: Uint8Array): string {
  let end = data.length
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      end = i
      break
    }
  }
  return new TextDecoder().decode(data.subarray(0, end))
}

export function writeEbmlUint(value: number, minLength = 1): Uint8Array {
  const bytes: number[] = []
  let v = value

  do {
    bytes.unshift(v & 0xFF)
    v = Math.floor(v / 256)
  } while (v > 0)

  while (bytes.length < minLength) {
    bytes.unshift(0)
  }

  return new Uint8Array(bytes)
}

export function writeEbmlFloat(value: number, length: 4 | 8 = 8): Uint8Array {
  const buffer = new ArrayBuffer(length)
  const view = new DataView(buffer)
  if (length === 4) {
    view.setFloat32(0, value, false)
  }
  else {
    view.setFloat64(0, value, false)
  }
  return new Uint8Array(buffer)
}

export function writeEbmlString(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
