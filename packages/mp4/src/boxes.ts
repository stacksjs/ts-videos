/**
 * ISOBMFF Box definitions and parsing utilities
 */

export interface Box {
  type: string
  size: number
  offset: number
  data?: Uint8Array
  children?: Box[]
}

export interface FtypBox extends Box {
  type: 'ftyp'
  majorBrand: string
  minorVersion: number
  compatibleBrands: string[]
}

export interface MvhdBox extends Box {
  type: 'mvhd'
  version: number
  creationTime: bigint
  modificationTime: bigint
  timescale: number
  duration: bigint
  rate: number
  volume: number
  matrix: number[]
  nextTrackId: number
}

export interface TkhdBox extends Box {
  type: 'tkhd'
  version: number
  flags: number
  creationTime: bigint
  modificationTime: bigint
  trackId: number
  duration: bigint
  layer: number
  alternateGroup: number
  volume: number
  matrix: number[]
  width: number
  height: number
}

export interface MdhdBox extends Box {
  type: 'mdhd'
  version: number
  creationTime: bigint
  modificationTime: bigint
  timescale: number
  duration: bigint
  language: string
}

export interface HdlrBox extends Box {
  type: 'hdlr'
  handlerType: string
  name: string
}

export interface StsdBox extends Box {
  type: 'stsd'
  entryCount: number
  entries: SampleEntry[]
}

export interface SampleEntry {
  type: string
  dataReferenceIndex: number
  data: Uint8Array
}

export interface VideoSampleEntry extends SampleEntry {
  width: number
  height: number
  horizResolution: number
  vertResolution: number
  frameCount: number
  compressorName: string
  depth: number
  extensions: Box[]
}

export interface AudioSampleEntry extends SampleEntry {
  channelCount: number
  sampleSize: number
  sampleRate: number
  extensions: Box[]
}

export interface SttsBox extends Box {
  type: 'stts'
  entries: { sampleCount: number, sampleDelta: number }[]
}

export interface CttsBox extends Box {
  type: 'ctts'
  version: number
  entries: { sampleCount: number, sampleOffset: number }[]
}

export interface StscBox extends Box {
  type: 'stsc'
  entries: { firstChunk: number, samplesPerChunk: number, sampleDescriptionIndex: number }[]
}

export interface StszBox extends Box {
  type: 'stsz'
  sampleSize: number
  sampleCount: number
  entrySizes: number[]
}

export interface StcoBox extends Box {
  type: 'stco'
  chunkOffsets: number[]
}

export interface Co64Box extends Box {
  type: 'co64'
  chunkOffsets: bigint[]
}

export interface StssBox extends Box {
  type: 'stss'
  sampleNumbers: number[]
}

export interface ElstBox extends Box {
  type: 'elst'
  version: number
  entries: { segmentDuration: bigint, mediaTime: bigint, mediaRateInteger: number, mediaRateFraction: number }[]
}

export interface AvcCBox extends Box {
  type: 'avcC'
  configurationVersion: number
  avcProfileIndication: number
  profileCompatibility: number
  avcLevelIndication: number
  lengthSizeMinusOne: number
  sps: Uint8Array[]
  pps: Uint8Array[]
}

export interface HvcCBox extends Box {
  type: 'hvcC'
  configurationVersion: number
  generalProfileSpace: number
  generalTierFlag: number
  generalProfileIdc: number
  generalProfileCompatibilityFlags: number
  generalConstraintIndicatorFlags: bigint
  generalLevelIdc: number
  minSpatialSegmentationIdc: number
  parallelismType: number
  chromaFormatIdc: number
  bitDepthLumaMinus8: number
  bitDepthChromaMinus8: number
  avgFrameRate: number
  constantFrameRate: number
  numTemporalLayers: number
  temporalIdNested: number
  lengthSizeMinusOne: number
  arrays: HvcCArray[]
}

export interface HvcCArray {
  arrayCompleteness: number
  nalUnitType: number
  nalUnits: Uint8Array[]
}

export interface EsdsBox extends Box {
  type: 'esds'
  objectTypeIndication: number
  streamType: number
  bufferSizeDB: number
  maxBitrate: number
  avgBitrate: number
  decoderSpecificInfo: Uint8Array
}

export interface MdatBox extends Box {
  type: 'mdat'
  dataOffset: number
  dataSize: number
}

export interface MoofBox extends Box {
  type: 'moof'
  mfhd?: MfhdBox
  trafs: TrafBox[]
}

export interface MfhdBox extends Box {
  type: 'mfhd'
  sequenceNumber: number
}

export interface TrafBox extends Box {
  type: 'traf'
  tfhd: TfhdBox
  tfdt?: TfdtBox
  truns: TrunBox[]
}

export interface TfhdBox extends Box {
  type: 'tfhd'
  flags: number
  trackId: number
  baseDataOffset?: bigint
  sampleDescriptionIndex?: number
  defaultSampleDuration?: number
  defaultSampleSize?: number
  defaultSampleFlags?: number
}

export interface TfdtBox extends Box {
  type: 'tfdt'
  version: number
  baseMediaDecodeTime: bigint
}

export interface TrunBox extends Box {
  type: 'trun'
  flags: number
  sampleCount: number
  dataOffset?: number
  firstSampleFlags?: number
  samples: TrunSample[]
}

export interface TrunSample {
  duration?: number
  size?: number
  flags?: number
  compositionTimeOffset?: number
}

export const BOX_HEADER_SIZE = 8
export const EXTENDED_BOX_HEADER_SIZE = 16

export function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

export function writeFourCC(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < 4; i++) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

export const CONTAINER_BOXES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf',
  'edts', 'udta', 'meta', 'ilst', 'moof', 'traf',
  'mvex', 'sinf', 'schi', 'rinf',
])

export const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'mp71', 'avc1', 'av01', 'hev1',
  'hvc1', 'M4A ', 'M4V ', 'M4P ', 'M4B ', 'f4v ',
  'f4a ', 'dash', 'msdh', 'msix',
])

export const MOV_BRANDS = new Set(['qt  '])

export function isVideoHandler(handlerType: string): boolean {
  return handlerType === 'vide'
}

export function isAudioHandler(handlerType: string): boolean {
  return handlerType === 'soun'
}

export function isSubtitleHandler(handlerType: string): boolean {
  return handlerType === 'subt' || handlerType === 'text' || handlerType === 'sbtl'
}

export function parseLanguageCode(code: number): string {
  const c1 = ((code >> 10) & 0x1F) + 0x60
  const c2 = ((code >> 5) & 0x1F) + 0x60
  const c3 = (code & 0x1F) + 0x60
  return String.fromCharCode(c1, c2, c3)
}

export function encodeLanguageCode(lang: string): number {
  if (lang.length !== 3) return 0x55C4
  const c1 = (lang.charCodeAt(0) - 0x60) & 0x1F
  const c2 = (lang.charCodeAt(1) - 0x60) & 0x1F
  const c3 = (lang.charCodeAt(2) - 0x60) & 0x1F
  return (c1 << 10) | (c2 << 5) | c3
}

export const TIMESCALE_1904_TO_1970 = 2082844800n
