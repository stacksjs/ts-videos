/**
 * Metadata reading and writing for various media formats
 * Supports MP4, WebM/Matroska, ID3v2 (MP3), Vorbis Comments (FLAC/OGG)
 */

// ============================================================================
// Common Types
// ============================================================================

/** Standard metadata fields */
export interface MediaMetadata {
  // Basic fields
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  composer?: string
  genre?: string
  year?: number
  trackNumber?: number
  trackTotal?: number
  discNumber?: number
  discTotal?: number
  comment?: string
  description?: string

  // Extended fields
  copyright?: string
  publisher?: string
  encodedBy?: string
  encodingTool?: string
  language?: string
  lyrics?: string
  mood?: string
  tempo?: number
  isrc?: string // International Standard Recording Code
  barcode?: string

  // Podcast/Audiobook fields
  podcastName?: string
  podcastUrl?: string
  episodeId?: string
  category?: string

  // Video-specific fields
  director?: string
  producer?: string
  writer?: string
  actors?: string[]
  show?: string
  season?: number
  episode?: number
  network?: string
  contentRating?: string

  // Technical fields
  duration?: number // milliseconds
  bitrate?: number
  sampleRate?: number
  channels?: number

  // Dates
  releaseDate?: string // ISO 8601 format
  recordingDate?: string
  purchaseDate?: string

  // Custom/unknown fields
  custom?: Record<string, string | number | boolean>
}

/** Cover art/artwork */
export interface CoverArt {
  data: Uint8Array
  mimeType: string
  type?: CoverArtType
  description?: string
  width?: number
  height?: number
}

/** Cover art types (ID3v2 APIC picture types) */
export type CoverArtType =
  | 'other'
  | 'icon'
  | 'iconOther'
  | 'coverFront'
  | 'coverBack'
  | 'leafletPage'
  | 'media'
  | 'leadArtist'
  | 'artist'
  | 'conductor'
  | 'band'
  | 'composer'
  | 'lyricist'
  | 'recordingLocation'
  | 'duringRecording'
  | 'duringPerformance'
  | 'videoCapture'
  | 'illustration'
  | 'bandLogo'
  | 'publisherLogo'

/** Cover art type to ID3 picture type mapping */
export const COVER_ART_TYPE_IDS: Record<CoverArtType, number> = {
  other: 0,
  icon: 1,
  iconOther: 2,
  coverFront: 3,
  coverBack: 4,
  leafletPage: 5,
  media: 6,
  leadArtist: 7,
  artist: 8,
  conductor: 9,
  band: 10,
  composer: 11,
  lyricist: 12,
  recordingLocation: 13,
  duringRecording: 14,
  duringPerformance: 15,
  videoCapture: 16,
  illustration: 17,
  bandLogo: 18,
  publisherLogo: 19,
}

/** ID3 picture type to cover art type mapping */
export function getCoverArtTypeFromId(id: number): CoverArtType {
  const types = Object.entries(COVER_ART_TYPE_IDS)
  const match = types.find(([, v]) => v === id)
  return (match?.[0] as CoverArtType) ?? 'other'
}

// ============================================================================
// MP4/M4A Metadata (iTunes-style)
// ============================================================================

/** iTunes atom mappings */
const ITUNES_ATOMS: Record<string, keyof MediaMetadata> = {
  '\xa9nam': 'title',
  '\xa9ART': 'artist',
  '\xa9alb': 'album',
  'aART': 'albumArtist',
  '\xa9wrt': 'composer',
  '\xa9gen': 'genre',
  '\xa9day': 'year',
  '\xa9cmt': 'comment',
  'desc': 'description',
  'cprt': 'copyright',
  '\xa9too': 'encodingTool',
  '\xa9lyr': 'lyrics',
  'trkn': 'trackNumber',
  'disk': 'discNumber',
  'tmpo': 'tempo',
  'tvsh': 'show',
  'tvsn': 'season',
  'tves': 'episode',
  'tvnn': 'network',
}

/** Reverse mapping for writing */
const METADATA_TO_ITUNES: Record<keyof MediaMetadata, string> = Object.fromEntries(
  Object.entries(ITUNES_ATOMS).map(([k, v]) => [v, k]),
) as Record<keyof MediaMetadata, string>

/** Parse MP4/M4A metadata */
export function parseMp4Metadata(data: Uint8Array): { metadata: MediaMetadata; artwork: CoverArt[] } {
  const metadata: MediaMetadata = {}
  const artwork: CoverArt[] = []
  let offset = 0

  // Find moov box
  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (type === 'moov') {
      parseMoovForMetadata(data.slice(offset + 8, offset + size), metadata, artwork)
      break
    }

    offset += size
    if (size === 0) break
  }

  return { metadata, artwork }
}

function parseMoovForMetadata(data: Uint8Array, metadata: MediaMetadata, artwork: CoverArt[]): void {
  let offset = 0

  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (type === 'udta') {
      parseUdtaForMetadata(data.slice(offset + 8, offset + size), metadata, artwork)
    }

    offset += size
    if (size === 0) break
  }
}

function parseUdtaForMetadata(data: Uint8Array, metadata: MediaMetadata, artwork: CoverArt[]): void {
  let offset = 0

  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (type === 'meta') {
      // Skip version and flags
      parseMetaForMetadata(data.slice(offset + 12, offset + size), metadata, artwork)
    }

    offset += size
    if (size === 0) break
  }
}

function parseMetaForMetadata(data: Uint8Array, metadata: MediaMetadata, artwork: CoverArt[]): void {
  let offset = 0

  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (type === 'ilst') {
      parseIlstForMetadata(data.slice(offset + 8, offset + size), metadata, artwork)
    }

    offset += size
    if (size === 0) break
  }
}

function parseIlstForMetadata(data: Uint8Array, metadata: MediaMetadata, artwork: CoverArt[]): void {
  let offset = 0

  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (size > 8) {
      const atomData = data.slice(offset + 8, offset + size)

      if (type === 'covr') {
        // Cover art
        const art = parseCoverAtom(atomData)
        if (art) artwork.push(art)
      }
      else {
        // Other metadata
        const field = ITUNES_ATOMS[type]
        if (field) {
          const value = parseDataAtom(atomData)
          if (value !== undefined) {
            (metadata as Record<string, unknown>)[field] = value
          }
        }
      }
    }

    offset += size
    if (size === 0) break
  }
}

function parseDataAtom(data: Uint8Array): string | number | undefined {
  let offset = 0

  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (type === 'data') {
      const dataType = readUint32BE(data, offset + 8)
      // Skip locale (4 bytes)
      const content = data.slice(offset + 16, offset + size)

      switch (dataType) {
        case 1: // UTF-8 string
          return new TextDecoder('utf-8').decode(content)
        case 21: // Integer (big-endian)
          if (content.length === 1) return content[0]
          if (content.length === 2) return readUint16BE(content, 0)
          if (content.length === 4) return readUint32BE(content, 0)
          return readUint32BE(content, 0)
        case 0: // Binary (for track/disc numbers)
          if (content.length >= 4) {
            return readUint16BE(content, 2) // Track/disc number is at offset 2
          }
          break
      }
    }

    offset += size
    if (size === 0) break
  }

  return undefined
}

function parseCoverAtom(data: Uint8Array): CoverArt | null {
  let offset = 0

  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    if (type === 'data') {
      const dataType = readUint32BE(data, offset + 8)
      const imageData = data.slice(offset + 16, offset + size)

      let mimeType = 'image/jpeg'
      if (dataType === 13) mimeType = 'image/jpeg'
      else if (dataType === 14) mimeType = 'image/png'

      return {
        data: imageData,
        mimeType,
        type: 'coverFront',
      }
    }

    offset += size
    if (size === 0) break
  }

  return null
}

/** Create MP4 metadata atoms */
export function createMp4MetadataAtoms(metadata: MediaMetadata, artwork?: CoverArt[]): Uint8Array {
  const atoms: Uint8Array[] = []

  // Create ilst content
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue

    const atomType = METADATA_TO_ITUNES[key as keyof MediaMetadata]
    if (!atomType) continue

    const dataAtom = createDataAtom(value)
    const atom = createBox(atomType, dataAtom)
    atoms.push(atom)
  }

  // Add cover art
  if (artwork) {
    for (const art of artwork) {
      const dataType = art.mimeType === 'image/png' ? 14 : 13
      const dataAtom = createDataAtomRaw(art.data, dataType)
      const atom = createBox('covr', dataAtom)
      atoms.push(atom)
    }
  }

  // Create ilst box
  const ilstContent = concatArrays(atoms)
  const ilst = createBox('ilst', ilstContent)

  // Create hdlr box
  const hdlr = new Uint8Array([
    0,
    0,
    0,
    0, // version and flags
    0,
    0,
    0,
    0, // pre_defined
    0x6d,
    0x64,
    0x69,
    0x72, // 'mdir'
    0x61,
    0x70,
    0x70,
    0x6c, // 'appl'
    0,
    0,
    0,
    0, // reserved
    0,
    0,
    0,
    0, // reserved
    0,
    0,
    0,
    0, // reserved
    0, // name (null-terminated)
  ])
  const hdlrBox = createBox('hdlr', hdlr)

  // Create meta box
  const metaVersion = new Uint8Array([0, 0, 0, 0])
  const metaContent = concatArrays([metaVersion, hdlrBox, ilst])
  const meta = createBox('meta', metaContent)

  // Create udta box
  const udta = createBox('udta', meta)

  return udta
}

function createDataAtom(value: string | number | boolean): Uint8Array {
  let dataType: number
  let content: Uint8Array

  if (typeof value === 'string') {
    dataType = 1 // UTF-8
    content = new TextEncoder().encode(value)
  }
  else if (typeof value === 'number') {
    dataType = 21 // Integer
    content = new Uint8Array(4)
    writeUint32BE(content, 0, value)
  }
  else {
    dataType = 1
    content = new TextEncoder().encode(String(value))
  }

  return createDataAtomRaw(content, dataType)
}

function createDataAtomRaw(content: Uint8Array, dataType: number): Uint8Array {
  const header = new Uint8Array(8)
  writeUint32BE(header, 0, dataType)
  // Locale is 4 zero bytes (already zeroed)

  const dataContent = concatArrays([header, content])
  return createBox('data', dataContent)
}

function createBox(type: string, content: Uint8Array): Uint8Array {
  const size = 8 + content.length
  const box = new Uint8Array(size)
  writeUint32BE(box, 0, size)
  box[4] = type.charCodeAt(0)
  box[5] = type.charCodeAt(1)
  box[6] = type.charCodeAt(2)
  box[7] = type.charCodeAt(3)
  box.set(content, 8)
  return box
}

// ============================================================================
// ID3v2 Metadata (MP3)
// ============================================================================

/** ID3v2 frame ID mappings */
const ID3_FRAMES: Record<string, keyof MediaMetadata> = {
  TIT2: 'title',
  TPE1: 'artist',
  TALB: 'album',
  TPE2: 'albumArtist',
  TCOM: 'composer',
  TCON: 'genre',
  TYER: 'year',
  TDRC: 'year', // ID3v2.4
  TRCK: 'trackNumber',
  TPOS: 'discNumber',
  COMM: 'comment',
  TCOP: 'copyright',
  TPUB: 'publisher',
  TENC: 'encodedBy',
  TSSE: 'encodingTool',
  TLAN: 'language',
  USLT: 'lyrics',
  TBPM: 'tempo',
  TSRC: 'isrc',
}

const METADATA_TO_ID3: Record<keyof MediaMetadata, string> = Object.fromEntries(
  Object.entries(ID3_FRAMES).map(([k, v]) => [v, k]),
) as Record<keyof MediaMetadata, string>

/** Parse ID3v2 tag */
export function parseId3v2(data: Uint8Array): { metadata: MediaMetadata; artwork: CoverArt[] } {
  const metadata: MediaMetadata = {}
  const artwork: CoverArt[] = []

  // Check ID3 header
  if (data.length < 10 || data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) {
    return { metadata, artwork }
  }

  const version = data[3]
  const flags = data[5]
  const size = readSyncsafeInt(data, 6)

  let offset = 10

  // Skip extended header if present
  if (flags & 0x40) {
    const extSize = version === 4 ? readSyncsafeInt(data, offset) : readUint32BE(data, offset)
    offset += extSize
  }

  const end = Math.min(offset + size, data.length)

  // Parse frames
  while (offset < end - 10) {
    const frameId = readString(data, offset, 4)
    if (frameId[0] === '\0') break

    let frameSize: number
    if (version === 4) {
      frameSize = readSyncsafeInt(data, offset + 4)
    }
    else {
      frameSize = readUint32BE(data, offset + 4)
    }

    if (frameSize === 0 || frameSize > end - offset - 10) break

    const _frameFlags = readUint16BE(data, offset + 8)
    offset += 10

    const frameData = data.slice(offset, offset + frameSize)

    if (frameId === 'APIC') {
      const art = parseApicFrame(frameData)
      if (art) artwork.push(art)
    }
    else {
      const field = ID3_FRAMES[frameId]
      if (field) {
        const value = parseTextFrame(frameData)
        if (value !== undefined) {
          if (field === 'year' && typeof value === 'string') {
            const year = parseInt(value, 10)
            if (!isNaN(year)) {
              metadata.year = year
            }
          }
          else if (field === 'trackNumber' && typeof value === 'string') {
            const parts = value.split('/')
            metadata.trackNumber = parseInt(parts[0], 10) || undefined
            if (parts[1]) metadata.trackTotal = parseInt(parts[1], 10) || undefined
          }
          else if (field === 'discNumber' && typeof value === 'string') {
            const parts = value.split('/')
            metadata.discNumber = parseInt(parts[0], 10) || undefined
            if (parts[1]) metadata.discTotal = parseInt(parts[1], 10) || undefined
          }
          else if (field === 'tempo' && typeof value === 'string') {
            metadata.tempo = parseInt(value, 10) || undefined
          }
          else {
            (metadata as Record<string, unknown>)[field] = value
          }
        }
      }
    }

    offset += frameSize
  }

  return { metadata, artwork }
}

function parseTextFrame(data: Uint8Array): string | undefined {
  if (data.length < 2) return undefined

  const encoding = data[0]
  const textData = data.slice(1)

  return decodeString(textData, encoding)
}

function parseApicFrame(data: Uint8Array): CoverArt | null {
  if (data.length < 4) return null

  const encoding = data[0]
  let offset = 1

  // Read MIME type (null-terminated)
  let mimeEnd = offset
  while (mimeEnd < data.length && data[mimeEnd] !== 0) mimeEnd++
  const mimeType = readString(data, offset, mimeEnd - offset) || 'image/jpeg'
  offset = mimeEnd + 1

  if (offset >= data.length) return null

  // Picture type
  const pictureType = data[offset]
  offset++

  // Description (null-terminated, encoding-dependent)
  const nullBytes = encoding === 1 || encoding === 2 ? 2 : 1
  let descEnd = offset
  while (descEnd < data.length - nullBytes + 1) {
    if (nullBytes === 1 && data[descEnd] === 0) break
    if (nullBytes === 2 && data[descEnd] === 0 && data[descEnd + 1] === 0) break
    descEnd++
  }
  const description = decodeString(data.slice(offset, descEnd), encoding)
  offset = descEnd + nullBytes

  // Image data
  const imageData = data.slice(offset)

  return {
    data: imageData,
    mimeType,
    type: getCoverArtTypeFromId(pictureType),
    description,
  }
}

/** Create ID3v2.4 tag */
export function createId3v2Tag(metadata: MediaMetadata, artwork?: CoverArt[]): Uint8Array {
  const frames: Uint8Array[] = []

  // Create text frames
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue

    const frameId = METADATA_TO_ID3[key as keyof MediaMetadata]
    if (!frameId) continue

    let textValue: string
    if (key === 'trackNumber' && metadata.trackTotal) {
      textValue = `${value}/${metadata.trackTotal}`
    }
    else if (key === 'discNumber' && metadata.discTotal) {
      textValue = `${value}/${metadata.discTotal}`
    }
    else if (key === 'trackTotal' || key === 'discTotal') {
      continue // Handled above
    }
    else {
      textValue = String(value)
    }

    const frame = createTextFrame(frameId, textValue)
    frames.push(frame)
  }

  // Create APIC frames for artwork
  if (artwork) {
    for (const art of artwork) {
      const frame = createApicFrame(art)
      frames.push(frame)
    }
  }

  // Calculate total size
  let totalSize = 0
  for (const frame of frames) {
    totalSize += frame.length
  }

  // Create tag header
  const header = new Uint8Array(10)
  header[0] = 0x49 // 'I'
  header[1] = 0x44 // 'D'
  header[2] = 0x33 // '3'
  header[3] = 4 // Version 2.4
  header[4] = 0 // Revision
  header[5] = 0 // Flags
  writeSyncsafeInt(header, 6, totalSize)

  return concatArrays([header, ...frames])
}

function createTextFrame(frameId: string, text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text)
  const frameSize = 1 + textBytes.length // encoding byte + text

  const frame = new Uint8Array(10 + frameSize)

  // Frame ID
  frame[0] = frameId.charCodeAt(0)
  frame[1] = frameId.charCodeAt(1)
  frame[2] = frameId.charCodeAt(2)
  frame[3] = frameId.charCodeAt(3)

  // Size (syncsafe)
  writeSyncsafeInt(frame, 4, frameSize)

  // Flags
  frame[8] = 0
  frame[9] = 0

  // Encoding (UTF-8)
  frame[10] = 3

  // Text
  frame.set(textBytes, 11)

  return frame
}

function createApicFrame(art: CoverArt): Uint8Array {
  const mimeBytes = new TextEncoder().encode(art.mimeType)
  const descBytes = art.description ? new TextEncoder().encode(art.description) : new Uint8Array(0)

  const frameSize = 1 + mimeBytes.length + 1 + 1 + descBytes.length + 1 + art.data.length

  const frame = new Uint8Array(10 + frameSize)

  // Frame ID 'APIC'
  frame[0] = 0x41
  frame[1] = 0x50
  frame[2] = 0x49
  frame[3] = 0x43

  // Size (syncsafe)
  writeSyncsafeInt(frame, 4, frameSize)

  // Flags
  frame[8] = 0
  frame[9] = 0

  let offset = 10

  // Encoding (UTF-8)
  frame[offset++] = 3

  // MIME type
  frame.set(mimeBytes, offset)
  offset += mimeBytes.length
  frame[offset++] = 0 // null terminator

  // Picture type
  frame[offset++] = COVER_ART_TYPE_IDS[art.type ?? 'coverFront']

  // Description
  frame.set(descBytes, offset)
  offset += descBytes.length
  frame[offset++] = 0 // null terminator

  // Image data
  frame.set(art.data, offset)

  return frame
}

// ============================================================================
// Vorbis Comments (FLAC, OGG)
// ============================================================================

/** Vorbis comment field mappings */
const VORBIS_FIELDS: Record<string, keyof MediaMetadata> = {
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ALBUMARTIST: 'albumArtist',
  COMPOSER: 'composer',
  GENRE: 'genre',
  DATE: 'year',
  TRACKNUMBER: 'trackNumber',
  TRACKTOTAL: 'trackTotal',
  DISCNUMBER: 'discNumber',
  DISCTOTAL: 'discTotal',
  COMMENT: 'comment',
  DESCRIPTION: 'description',
  COPYRIGHT: 'copyright',
  PUBLISHER: 'publisher',
  ENCODER: 'encodingTool',
  LANGUAGE: 'language',
  LYRICS: 'lyrics',
  ISRC: 'isrc',
}

const METADATA_TO_VORBIS: Record<keyof MediaMetadata, string> = Object.fromEntries(
  Object.entries(VORBIS_FIELDS).map(([k, v]) => [v, k]),
) as Record<keyof MediaMetadata, string>

/** Parse Vorbis comments */
export function parseVorbisComments(data: Uint8Array): { metadata: MediaMetadata; artwork: CoverArt[] } {
  const metadata: MediaMetadata = {}
  const artwork: CoverArt[] = []

  if (data.length < 4) return { metadata, artwork }

  let offset = 0

  // Read vendor string length
  const vendorLength = readUint32LE(data, offset)
  offset += 4

  // Skip vendor string
  offset += vendorLength

  if (offset + 4 > data.length) return { metadata, artwork }

  // Read comment count
  const commentCount = readUint32LE(data, offset)
  offset += 4

  // Parse comments
  for (let i = 0; i < commentCount && offset + 4 <= data.length; i++) {
    const commentLength = readUint32LE(data, offset)
    offset += 4

    if (offset + commentLength > data.length) break

    const comment = new TextDecoder('utf-8').decode(data.slice(offset, offset + commentLength))
    offset += commentLength

    const eqIndex = comment.indexOf('=')
    if (eqIndex === -1) continue

    const key = comment.slice(0, eqIndex).toUpperCase()
    const value = comment.slice(eqIndex + 1)

    if (key === 'METADATA_BLOCK_PICTURE') {
      // Base64-encoded FLAC picture block
      try {
        const decoded = decodeBase64(value)
        const art = parseFlacPicture(decoded)
        if (art) artwork.push(art)
      }
      catch {
        // Invalid base64, skip
      }
    }
    else {
      const field = VORBIS_FIELDS[key]
      if (field) {
        if (field === 'year') {
          const year = parseInt(value, 10)
          if (!isNaN(year)) metadata.year = year
        }
        else if (field === 'trackNumber' || field === 'discNumber' || field === 'trackTotal' || field === 'discTotal') {
          const num = parseInt(value, 10)
          if (!isNaN(num)) (metadata as Record<string, unknown>)[field] = num
        }
        else {
          (metadata as Record<string, unknown>)[field] = value
        }
      }
    }
  }

  return { metadata, artwork }
}

/** Create Vorbis comments block */
export function createVorbisComments(metadata: MediaMetadata, vendor: string = 'ts-videos'): Uint8Array {
  const comments: string[] = []

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue

    const vorbisKey = METADATA_TO_VORBIS[key as keyof MediaMetadata]
    if (!vorbisKey) continue

    comments.push(`${vorbisKey}=${value}`)
  }

  // Calculate size
  const vendorBytes = new TextEncoder().encode(vendor)
  let totalSize = 4 + vendorBytes.length + 4

  const commentBytes: Uint8Array[] = []
  for (const comment of comments) {
    const bytes = new TextEncoder().encode(comment)
    commentBytes.push(bytes)
    totalSize += 4 + bytes.length
  }

  // Build block
  const result = new Uint8Array(totalSize)
  let offset = 0

  // Vendor length
  writeUint32LE(result, offset, vendorBytes.length)
  offset += 4

  // Vendor string
  result.set(vendorBytes, offset)
  offset += vendorBytes.length

  // Comment count
  writeUint32LE(result, offset, comments.length)
  offset += 4

  // Comments
  for (const bytes of commentBytes) {
    writeUint32LE(result, offset, bytes.length)
    offset += 4
    result.set(bytes, offset)
    offset += bytes.length
  }

  return result
}

// ============================================================================
// FLAC Picture Block
// ============================================================================

/** Parse FLAC picture block */
export function parseFlacPicture(data: Uint8Array): CoverArt | null {
  if (data.length < 32) return null

  let offset = 0

  // Picture type
  const pictureType = readUint32BE(data, offset)
  offset += 4

  // MIME type length
  const mimeLength = readUint32BE(data, offset)
  offset += 4

  if (offset + mimeLength > data.length) return null

  // MIME type
  const mimeType = new TextDecoder('ascii').decode(data.slice(offset, offset + mimeLength))
  offset += mimeLength

  // Description length
  const descLength = readUint32BE(data, offset)
  offset += 4

  if (offset + descLength > data.length) return null

  // Description
  const description = new TextDecoder('utf-8').decode(data.slice(offset, offset + descLength))
  offset += descLength

  // Width, height, depth, colors
  const width = readUint32BE(data, offset)
  offset += 4
  const height = readUint32BE(data, offset)
  offset += 4
  offset += 4 // depth
  offset += 4 // colors

  // Data length
  const dataLength = readUint32BE(data, offset)
  offset += 4

  if (offset + dataLength > data.length) return null

  // Image data
  const imageData = data.slice(offset, offset + dataLength)

  return {
    data: imageData,
    mimeType,
    type: getCoverArtTypeFromId(pictureType),
    description: description || undefined,
    width,
    height,
  }
}

/** Create FLAC picture block */
export function createFlacPicture(art: CoverArt): Uint8Array {
  const mimeBytes = new TextEncoder().encode(art.mimeType)
  const descBytes = new TextEncoder().encode(art.description ?? '')

  const size = 4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 * 4 + 4 + art.data.length
  const result = new Uint8Array(size)
  let offset = 0

  // Picture type
  writeUint32BE(result, offset, COVER_ART_TYPE_IDS[art.type ?? 'coverFront'])
  offset += 4

  // MIME type
  writeUint32BE(result, offset, mimeBytes.length)
  offset += 4
  result.set(mimeBytes, offset)
  offset += mimeBytes.length

  // Description
  writeUint32BE(result, offset, descBytes.length)
  offset += 4
  result.set(descBytes, offset)
  offset += descBytes.length

  // Dimensions
  writeUint32BE(result, offset, art.width ?? 0)
  offset += 4
  writeUint32BE(result, offset, art.height ?? 0)
  offset += 4
  writeUint32BE(result, offset, 24) // color depth
  offset += 4
  writeUint32BE(result, offset, 0) // indexed colors
  offset += 4

  // Data
  writeUint32BE(result, offset, art.data.length)
  offset += 4
  result.set(art.data, offset)

  return result
}

// ============================================================================
// Matroska/WebM Metadata
// ============================================================================

/** Matroska tag element IDs */
const MATROSKA_TAG_IDS = {
  TAGS: 0x1254c367,
  TAG: 0x7373,
  TARGETS: 0x63c0,
  SIMPLE_TAG: 0x67c8,
  TAG_NAME: 0x45a3,
  TAG_STRING: 0x4487,
  TAG_BINARY: 0x4485,
  TAG_LANGUAGE: 0x447a,
}

/** Matroska tag name mappings */
const MATROSKA_TAG_NAMES: Record<string, keyof MediaMetadata> = {
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  GENRE: 'genre',
  DATE_RELEASED: 'year',
  PART_NUMBER: 'trackNumber',
  TOTAL_PARTS: 'trackTotal',
  COMMENT: 'comment',
  DESCRIPTION: 'description',
  COPYRIGHT: 'copyright',
  PUBLISHER: 'publisher',
  ENCODER: 'encodingTool',
  DIRECTOR: 'director',
  ACTOR: 'actors',
}

/** Parse Matroska tags */
export function parseMatroskaTags(data: Uint8Array): MediaMetadata {
  const metadata: MediaMetadata = {}

  // Find Tags element
  let offset = 0
  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (id === MATROSKA_TAG_IDS.TAGS) {
      parseTagsElement(data.slice(offset + headerSize, offset + headerSize + size), metadata)
      break
    }
    offset += headerSize + size
    if (size === 0 || headerSize === 0) break
  }

  return metadata
}

function parseTagsElement(data: Uint8Array, metadata: MediaMetadata): void {
  let offset = 0

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    if (id === MATROSKA_TAG_IDS.TAG) {
      parseTagElement(data.slice(offset + headerSize, offset + headerSize + size), metadata)
    }

    offset += headerSize + size
  }
}

function parseTagElement(data: Uint8Array, metadata: MediaMetadata): void {
  let offset = 0

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    if (id === MATROSKA_TAG_IDS.SIMPLE_TAG) {
      parseSimpleTag(data.slice(offset + headerSize, offset + headerSize + size), metadata)
    }

    offset += headerSize + size
  }
}

function parseSimpleTag(data: Uint8Array, metadata: MediaMetadata): void {
  let offset = 0
  let name = ''
  let value = ''

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    const elementData = data.slice(offset + headerSize, offset + headerSize + size)

    if (id === MATROSKA_TAG_IDS.TAG_NAME) {
      name = new TextDecoder('utf-8').decode(elementData)
    }
    else if (id === MATROSKA_TAG_IDS.TAG_STRING) {
      value = new TextDecoder('utf-8').decode(elementData)
    }

    offset += headerSize + size
  }

  const field = MATROSKA_TAG_NAMES[name.toUpperCase()]
  if (field && value) {
    if (field === 'year') {
      const year = parseInt(value, 10)
      if (!isNaN(year)) metadata.year = year
    }
    else if (field === 'trackNumber' || field === 'trackTotal') {
      const num = parseInt(value, 10)
      if (!isNaN(num)) (metadata as Record<string, unknown>)[field] = num
    }
    else if (field === 'actors') {
      metadata.actors = metadata.actors ?? []
      metadata.actors.push(value)
    }
    else {
      (metadata as Record<string, unknown>)[field] = value
    }
  }
}

function readEbmlElement(data: Uint8Array, offset: number): { id: number; size: number; headerSize: number } {
  if (offset >= data.length) return { id: 0, size: 0, headerSize: 0 }

  let id = 0
  let idLen = 0
  const firstByte = data[offset]

  if (firstByte >= 0x80) {
    id = firstByte
    idLen = 1
  }
  else if (firstByte >= 0x40) {
    id = (firstByte << 8) | data[offset + 1]
    idLen = 2
  }
  else if (firstByte >= 0x20) {
    id = (firstByte << 16) | (data[offset + 1] << 8) | data[offset + 2]
    idLen = 3
  }
  else if (firstByte >= 0x10) {
    id = (firstByte << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    idLen = 4
  }
  else {
    return { id: 0, size: 0, headerSize: 0 }
  }

  let size = 0
  let sizeLen = 0
  const sizeOffset = offset + idLen
  const sizeByte = data[sizeOffset]

  if (sizeByte >= 0x80) {
    size = sizeByte & 0x7f
    sizeLen = 1
  }
  else if (sizeByte >= 0x40) {
    size = ((sizeByte & 0x3f) << 8) | data[sizeOffset + 1]
    sizeLen = 2
  }
  else if (sizeByte >= 0x20) {
    size = ((sizeByte & 0x1f) << 16) | (data[sizeOffset + 1] << 8) | data[sizeOffset + 2]
    sizeLen = 3
  }
  else if (sizeByte >= 0x10) {
    size = ((sizeByte & 0x0f) << 24) | (data[sizeOffset + 1] << 16) | (data[sizeOffset + 2] << 8) | data[sizeOffset + 3]
    sizeLen = 4
  }
  else {
    sizeLen = 1
  }

  return { id, size, headerSize: idLen + sizeLen }
}

// ============================================================================
// Utility Functions
// ============================================================================

function readUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1]
}

function readUint32BE(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return ((data[offset + 3] << 24) | (data[offset + 2] << 16) | (data[offset + 1] << 8) | data[offset]) >>> 0
}

function writeUint32BE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >> 24) & 0xff
  data[offset + 1] = (value >> 16) & 0xff
  data[offset + 2] = (value >> 8) & 0xff
  data[offset + 3] = value & 0xff
}

function writeUint32LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >> 8) & 0xff
  data[offset + 2] = (value >> 16) & 0xff
  data[offset + 3] = (value >> 24) & 0xff
}

function readSyncsafeInt(data: Uint8Array, offset: number): number {
  return ((data[offset] & 0x7f) << 21) | ((data[offset + 1] & 0x7f) << 14) | ((data[offset + 2] & 0x7f) << 7) | (data[offset + 3] & 0x7f)
}

function writeSyncsafeInt(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >> 21) & 0x7f
  data[offset + 1] = (value >> 14) & 0x7f
  data[offset + 2] = (value >> 7) & 0x7f
  data[offset + 3] = value & 0x7f
}

function readString(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.slice(offset, offset + length))
}

function decodeString(data: Uint8Array, encoding: number): string {
  switch (encoding) {
    case 0:
      return new TextDecoder('iso-8859-1').decode(data)
    case 1:
      return new TextDecoder('utf-16').decode(data)
    case 2:
      return new TextDecoder('utf-16be').decode(data)
    case 3:
      return new TextDecoder('utf-8').decode(data)
    default:
      return new TextDecoder('utf-8').decode(data)
  }
}

function decodeBase64(str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0
  for (const arr of arrays) {
    totalLength += arr.length
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ============================================================================
// High-Level Functions
// ============================================================================

/** Detect metadata format from file data */
export function detectMetadataFormat(data: Uint8Array): 'mp4' | 'id3' | 'vorbis' | 'matroska' | 'flac' | null {
  if (data.length < 8) return null

  // Check for ID3v2
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    return 'id3'
  }

  // Check for FLAC
  if (data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) {
    return 'flac'
  }

  // Check for OGG (Vorbis)
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
    return 'vorbis'
  }

  // Check for Matroska/WebM
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return 'matroska'
  }

  // Check for MP4/M4A (ftyp box)
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return 'mp4'
  }

  return null
}

/** Parse metadata from any supported format */
export function parseMetadata(data: Uint8Array): { metadata: MediaMetadata; artwork: CoverArt[] } {
  const format = detectMetadataFormat(data)

  switch (format) {
    case 'mp4':
      return parseMp4Metadata(data)
    case 'id3':
      return parseId3v2(data)
    case 'vorbis':
    case 'flac':
      return parseVorbisComments(data)
    case 'matroska':
      return { metadata: parseMatroskaTags(data), artwork: [] }
    default:
      return { metadata: {}, artwork: [] }
  }
}

/** Merge two metadata objects (second takes precedence) */
export function mergeMetadata(base: MediaMetadata, overlay: MediaMetadata): MediaMetadata {
  const result = { ...base }

  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined && value !== null) {
      (result as Record<string, unknown>)[key] = value
    }
  }

  return result
}

/** Get metadata summary as formatted string */
export function formatMetadataSummary(metadata: MediaMetadata): string {
  const lines: string[] = []

  if (metadata.title) lines.push(`Title: ${metadata.title}`)
  if (metadata.artist) lines.push(`Artist: ${metadata.artist}`)
  if (metadata.album) lines.push(`Album: ${metadata.album}`)
  if (metadata.year) lines.push(`Year: ${metadata.year}`)
  if (metadata.trackNumber) {
    const track = metadata.trackTotal ? `${metadata.trackNumber}/${metadata.trackTotal}` : String(metadata.trackNumber)
    lines.push(`Track: ${track}`)
  }
  if (metadata.genre) lines.push(`Genre: ${metadata.genre}`)
  if (metadata.comment) lines.push(`Comment: ${metadata.comment}`)

  return lines.join('\n')
}
