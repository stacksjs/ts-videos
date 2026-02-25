/**
 * Chapter support for reading and writing media chapters
 * Supports MP4/M4A, Matroska/WebM, and ID3 chapter formats
 */

// ============================================================================
// Common Types
// ============================================================================

/** A single chapter in a media file */
export interface Chapter {
  /** Start time in milliseconds */
  startTime: number
  /** End time in milliseconds (optional, defaults to next chapter start or media duration) */
  endTime?: number
  /** Chapter title */
  title: string
  /** Chapter language (ISO 639-2 code, e.g., 'eng', 'fra') */
  language?: string
  /** Nested chapters (for hierarchical chapter structures) */
  children?: Chapter[]
  /** Additional metadata */
  metadata?: Record<string, string>
  /** Thumbnail/artwork for the chapter */
  artwork?: {
    data: Uint8Array
    mimeType: string
  }
}

/** Chapter list with metadata */
export interface ChapterList {
  /** Array of chapters */
  chapters: Chapter[]
  /** Total duration in milliseconds (optional) */
  duration?: number
  /** Edition/chapter set name */
  editionName?: string
  /** Whether this is the default edition */
  isDefault?: boolean
  /** Whether chapters are ordered */
  isOrdered?: boolean
}

// ============================================================================
// Format Detection
// ============================================================================

/** Detected chapter format */
export type ChapterFormat = 'mp4' | 'matroska' | 'id3' | 'vorbis' | 'ogg' | 'cue'

/** Detect chapter format from file data */
export function detectChapterFormat(data: Uint8Array): ChapterFormat | null {
  if (data.length < 8) return null

  // Check for MP4/M4A (ftyp box)
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return 'mp4'
  }

  // Check for Matroska/WebM
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return 'matroska'
  }

  // Check for ID3v2
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    return 'id3'
  }

  // Check for OGG
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
    return 'ogg'
  }

  return null
}

// ============================================================================
// MP4/M4A Chapter Parsing
// ============================================================================

/** Parse chapters from MP4/M4A data */
export function parseMp4Chapters(data: Uint8Array): ChapterList {
  const chapters: Chapter[] = []
  let offset = 0

  // Find moov box
  while (offset < data.length - 8) {
    const size = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])

    if (type === 'moov') {
      parsemp4MoovBox(data.slice(offset + 8, offset + size), chapters)
      break
    }

    offset += size
    if (size === 0) break
  }

  return { chapters }
}

function parsemp4MoovBox(data: Uint8Array, chapters: Chapter[]): void {
  let offset = 0

  while (offset < data.length - 8) {
    const size = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])

    if (type === 'udta') {
      parseMp4UdtaBox(data.slice(offset + 8, offset + size), chapters)
    }
    else if (type === 'trak') {
      parseMp4TrakBox(data.slice(offset + 8, offset + size), chapters)
    }

    offset += size
    if (size === 0) break
  }
}

function parseMp4UdtaBox(data: Uint8Array, chapters: Chapter[]): void {
  let offset = 0

  while (offset < data.length - 8) {
    const size = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])

    if (type === 'chpl') {
      // Nero chapter format
      parseMp4ChplBox(data.slice(offset + 8, offset + size), chapters)
    }

    offset += size
    if (size === 0) break
  }
}

function parseMp4ChplBox(data: Uint8Array, chapters: Chapter[]): void {
  if (data.length < 5) return

  // Skip version and flags
  let offset = 4
  // Skip reserved
  offset += 1
  const count = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
  offset += 4

  for (let i = 0; i < count && offset < data.length; i++) {
    // Time is in 100ns units
    const timeHigh = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    offset += 4
    const timeLow = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    offset += 4

    const time100ns = (timeHigh * 0x100000000) + timeLow
    const startTime = Math.floor(time100ns / 10000) // Convert to ms

    const titleLength = data[offset]
    offset += 1

    const titleBytes = data.slice(offset, offset + titleLength)
    const title = new TextDecoder('utf-8').decode(titleBytes)
    offset += titleLength

    chapters.push({
      startTime,
      title,
    })
  }

  // Set end times
  for (let i = 0; i < chapters.length - 1; i++) {
    chapters[i].endTime = chapters[i + 1].startTime
  }
}

function parseMp4TrakBox(data: Uint8Array, chapters: Chapter[]): void {
  // Check if this is a chapter track (text handler)
  let offset = 0

  while (offset < data.length - 8) {
    const size = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])

    if (type === 'mdia') {
      const mdiaData = data.slice(offset + 8, offset + size)
      const isChapterTrack = checkMp4ChapterTrack(mdiaData)
      if (isChapterTrack) {
        parseMp4MdiaForChapters(mdiaData, chapters)
      }
    }

    offset += size
    if (size === 0) break
  }
}

function checkMp4ChapterTrack(mdiaData: Uint8Array): boolean {
  let offset = 0

  while (offset < mdiaData.length - 8) {
    const size = (mdiaData[offset] << 24) | (mdiaData[offset + 1] << 16) | (mdiaData[offset + 2] << 8) | mdiaData[offset + 3]
    const type = String.fromCharCode(mdiaData[offset + 4], mdiaData[offset + 5], mdiaData[offset + 6], mdiaData[offset + 7])

    if (type === 'hdlr') {
      // Check handler type
      const handlerType = String.fromCharCode(
        mdiaData[offset + 16],
        mdiaData[offset + 17],
        mdiaData[offset + 18],
        mdiaData[offset + 19],
      )
      return handlerType === 'text' || handlerType === 'sbtl'
    }

    offset += size
    if (size === 0) break
  }

  return false
}

function parseMp4MdiaForChapters(mdiaData: Uint8Array, chapters: Chapter[]): void {
  let offset = 0

  while (offset < mdiaData.length - 8) {
    const size = (mdiaData[offset] << 24) | (mdiaData[offset + 1] << 16) | (mdiaData[offset + 2] << 8) | mdiaData[offset + 3]
    const type = String.fromCharCode(mdiaData[offset + 4], mdiaData[offset + 5], mdiaData[offset + 6], mdiaData[offset + 7])

    if (type === 'minf') {
      parseMp4MinfForChapters(mdiaData.slice(offset + 8, offset + size), chapters)
    }

    offset += size
    if (size === 0) break
  }
}

function parseMp4MinfForChapters(minfData: Uint8Array, chapters: Chapter[]): void {
  let offset = 0

  while (offset < minfData.length - 8) {
    const size = (minfData[offset] << 24) | (minfData[offset + 1] << 16) | (minfData[offset + 2] << 8) | minfData[offset + 3]
    const type = String.fromCharCode(minfData[offset + 4], minfData[offset + 5], minfData[offset + 6], minfData[offset + 7])

    if (type === 'stbl') {
      parseMp4StblForChapters(minfData.slice(offset + 8, offset + size), chapters)
    }

    offset += size
    if (size === 0) break
  }
}

function parseMp4StblForChapters(_stblData: Uint8Array, _chapters: Chapter[]): void {
  // Extract sample timing and text content
  // This requires coordinating stts (timing), stsz (sizes), stco (chunk offsets)
  // Simplified implementation - would need full sample table parsing for complete support
}

/** Create MP4 chapter atom (chpl box) */
export function createMp4ChapterAtom(chapters: Chapter[]): Uint8Array {
  const entries: Uint8Array[] = []

  for (const chapter of chapters) {
    // Convert ms to 100ns units
    const time100ns = BigInt(chapter.startTime) * 10000n

    const titleBytes = new TextEncoder().encode(chapter.title)
    const entry = new Uint8Array(8 + 1 + titleBytes.length)

    // Write time (64-bit, big-endian)
    const view = new DataView(entry.buffer)
    view.setBigUint64(0, time100ns, false)

    // Write title length and title
    entry[8] = titleBytes.length
    entry.set(titleBytes, 9)

    entries.push(entry)
  }

  // Calculate total size
  let entriesSize = 0
  for (const entry of entries) {
    entriesSize += entry.length
  }

  // Create chpl box
  // Size (4) + Type (4) + Version (1) + Flags (3) + Reserved (1) + Count (4) + Entries
  const chplSize = 4 + 4 + 1 + 3 + 1 + 4 + entriesSize
  const chpl = new Uint8Array(chplSize)
  const view = new DataView(chpl.buffer)

  let offset = 0

  // Box size
  view.setUint32(offset, chplSize, false)
  offset += 4

  // Box type 'chpl'
  chpl[offset++] = 0x63 // c
  chpl[offset++] = 0x68 // h
  chpl[offset++] = 0x70 // p
  chpl[offset++] = 0x6c // l

  // Version (1)
  chpl[offset++] = 1

  // Flags (3)
  offset += 3

  // Reserved (1)
  offset += 1

  // Chapter count
  view.setUint32(offset, chapters.length, false)
  offset += 4

  // Write entries
  for (const entry of entries) {
    chpl.set(entry, offset)
    offset += entry.length
  }

  return chpl
}

// ============================================================================
// Matroska/WebM Chapter Parsing
// ============================================================================

/** EBML element IDs for Matroska chapters */
const MATROSKA_IDS = {
  CHAPTERS: 0x1043a770,
  EDITION_ENTRY: 0x45b9,
  CHAPTER_ATOM: 0xb6,
  CHAPTER_UID: 0x73c4,
  CHAPTER_TIME_START: 0x91,
  CHAPTER_TIME_END: 0x92,
  CHAPTER_DISPLAY: 0x80,
  CHAP_STRING: 0x85,
  CHAP_LANGUAGE: 0x437c,
  CHAP_COUNTRY: 0x437e,
  CHAPTER_FLAG_HIDDEN: 0x98,
  CHAPTER_FLAG_ENABLED: 0x4598,
  EDITION_FLAG_DEFAULT: 0x45db,
  EDITION_FLAG_ORDERED: 0x45dd,
  EDITION_UID: 0x45bc,
}

/** Parse chapters from Matroska/WebM data */
export function parseMatroskaChapters(data: Uint8Array): ChapterList {
  const result: ChapterList = {
    chapters: [],
    isOrdered: false,
    isDefault: true,
  }

  // Find Chapters element
  let offset = 0
  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (id === MATROSKA_IDS.CHAPTERS) {
      parseMatroskaChaptersElement(data.slice(offset + headerSize, offset + headerSize + size), result)
      break
    }
    offset += headerSize + size
    if (size === 0 || headerSize === 0) break
  }

  return result
}

function readEbmlElement(data: Uint8Array, offset: number): { id: number; size: number; headerSize: number } {
  if (offset >= data.length) return { id: 0, size: 0, headerSize: 0 }

  // Read element ID (variable length)
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

  // Read element size (variable length)
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
    // Handle larger sizes if needed
    sizeLen = 1
  }

  return { id, size, headerSize: idLen + sizeLen }
}

function parseMatroskaChaptersElement(data: Uint8Array, result: ChapterList): void {
  let offset = 0

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    if (id === MATROSKA_IDS.EDITION_ENTRY) {
      parseEditionEntry(data.slice(offset + headerSize, offset + headerSize + size), result)
    }

    offset += headerSize + size
  }
}

function parseEditionEntry(data: Uint8Array, result: ChapterList): void {
  let offset = 0

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    const elementData = data.slice(offset + headerSize, offset + headerSize + size)

    switch (id) {
      case MATROSKA_IDS.EDITION_FLAG_DEFAULT:
        result.isDefault = elementData[0] === 1
        break
      case MATROSKA_IDS.EDITION_FLAG_ORDERED:
        result.isOrdered = elementData[0] === 1
        break
      case MATROSKA_IDS.CHAPTER_ATOM:
        const chapter = parseChapterAtom(elementData)
        if (chapter) {
          result.chapters.push(chapter)
        }
        break
    }

    offset += headerSize + size
  }
}

function parseChapterAtom(data: Uint8Array): Chapter | null {
  let offset = 0
  let startTime = 0
  let endTime: number | undefined
  let title = ''
  let language = 'eng'
  const children: Chapter[] = []

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    const elementData = data.slice(offset + headerSize, offset + headerSize + size)

    switch (id) {
      case MATROSKA_IDS.CHAPTER_TIME_START:
        // Time in nanoseconds
        startTime = readEbmlUint(elementData) / 1000000 // Convert to ms
        break
      case MATROSKA_IDS.CHAPTER_TIME_END:
        endTime = readEbmlUint(elementData) / 1000000
        break
      case MATROSKA_IDS.CHAPTER_DISPLAY:
        const display = parseChapterDisplay(elementData)
        title = display.title
        language = display.language
        break
      case MATROSKA_IDS.CHAPTER_ATOM:
        const child = parseChapterAtom(elementData)
        if (child) {
          children.push(child)
        }
        break
    }

    offset += headerSize + size
  }

  return {
    startTime,
    endTime,
    title,
    language,
    children: children.length > 0 ? children : undefined,
  }
}

function parseChapterDisplay(data: Uint8Array): { title: string; language: string } {
  let offset = 0
  let title = ''
  let language = 'eng'

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    const elementData = data.slice(offset + headerSize, offset + headerSize + size)

    switch (id) {
      case MATROSKA_IDS.CHAP_STRING:
        title = new TextDecoder('utf-8').decode(elementData)
        break
      case MATROSKA_IDS.CHAP_LANGUAGE:
        language = new TextDecoder('ascii').decode(elementData)
        break
    }

    offset += headerSize + size
  }

  return { title, language }
}

function readEbmlUint(data: Uint8Array): number {
  let value = 0
  for (let i = 0; i < data.length; i++) {
    value = value * 256 + data[i]
  }
  return value
}

/** Create Matroska chapter element */
export function createMatroskaChapters(chapterList: ChapterList): Uint8Array {
  const chapterAtoms: Uint8Array[] = []

  for (let i = 0; i < chapterList.chapters.length; i++) {
    const chapter = chapterList.chapters[i]
    chapterAtoms.push(createMatroskaChapterAtom(chapter, i + 1))
  }

  // Create EditionEntry
  const editionContent: Uint8Array[] = []

  // Edition UID
  editionContent.push(createEbmlElement(MATROSKA_IDS.EDITION_UID, createEbmlUint(1)))

  // Edition flags
  editionContent.push(createEbmlElement(MATROSKA_IDS.EDITION_FLAG_DEFAULT, new Uint8Array([chapterList.isDefault ? 1 : 0])))
  editionContent.push(createEbmlElement(MATROSKA_IDS.EDITION_FLAG_ORDERED, new Uint8Array([chapterList.isOrdered ? 1 : 0])))

  // Chapter atoms
  for (const atom of chapterAtoms) {
    editionContent.push(atom)
  }

  const editionEntry = createEbmlElement(MATROSKA_IDS.EDITION_ENTRY, concatUint8Arrays(editionContent))

  // Create Chapters element
  return createEbmlElement(MATROSKA_IDS.CHAPTERS, editionEntry)
}

function createMatroskaChapterAtom(chapter: Chapter, uid: number): Uint8Array {
  const content: Uint8Array[] = []

  // Chapter UID
  content.push(createEbmlElement(MATROSKA_IDS.CHAPTER_UID, createEbmlUint(uid)))

  // Chapter time start (nanoseconds)
  content.push(createEbmlElement(MATROSKA_IDS.CHAPTER_TIME_START, createEbmlUint(Math.floor(chapter.startTime * 1000000))))

  // Chapter time end (nanoseconds)
  if (chapter.endTime !== undefined) {
    content.push(createEbmlElement(MATROSKA_IDS.CHAPTER_TIME_END, createEbmlUint(Math.floor(chapter.endTime * 1000000))))
  }

  // Chapter display
  const displayContent: Uint8Array[] = []
  displayContent.push(createEbmlElement(MATROSKA_IDS.CHAP_STRING, new TextEncoder().encode(chapter.title)))
  displayContent.push(createEbmlElement(MATROSKA_IDS.CHAP_LANGUAGE, new TextEncoder().encode(chapter.language ?? 'eng')))
  content.push(createEbmlElement(MATROSKA_IDS.CHAPTER_DISPLAY, concatUint8Arrays(displayContent)))

  // Flags
  content.push(createEbmlElement(MATROSKA_IDS.CHAPTER_FLAG_ENABLED, new Uint8Array([1])))
  content.push(createEbmlElement(MATROSKA_IDS.CHAPTER_FLAG_HIDDEN, new Uint8Array([0])))

  // Nested chapters
  if (chapter.children) {
    for (let i = 0; i < chapter.children.length; i++) {
      content.push(createMatroskaChapterAtom(chapter.children[i], uid * 100 + i + 1))
    }
  }

  return createEbmlElement(MATROSKA_IDS.CHAPTER_ATOM, concatUint8Arrays(content))
}

function createEbmlElement(id: number, data: Uint8Array): Uint8Array {
  const idBytes = createEbmlId(id)
  const sizeBytes = createEbmlSize(data.length)
  const result = new Uint8Array(idBytes.length + sizeBytes.length + data.length)
  result.set(idBytes, 0)
  result.set(sizeBytes, idBytes.length)
  result.set(data, idBytes.length + sizeBytes.length)
  return result
}

function createEbmlId(id: number): Uint8Array {
  if (id < 0x80) {
    return new Uint8Array([id | 0x80])
  }
  else if (id < 0x4000) {
    return new Uint8Array([(id >> 8) | 0x40, id & 0xff])
  }
  else if (id < 0x200000) {
    return new Uint8Array([(id >> 16) | 0x20, (id >> 8) & 0xff, id & 0xff])
  }
  else {
    return new Uint8Array([(id >> 24) | 0x10, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff])
  }
}

function createEbmlSize(size: number): Uint8Array {
  if (size < 0x7f) {
    return new Uint8Array([size | 0x80])
  }
  else if (size < 0x3fff) {
    return new Uint8Array([(size >> 8) | 0x40, size & 0xff])
  }
  else if (size < 0x1fffff) {
    return new Uint8Array([(size >> 16) | 0x20, (size >> 8) & 0xff, size & 0xff])
  }
  else {
    return new Uint8Array([(size >> 24) | 0x10, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff])
  }
}

function createEbmlUint(value: number): Uint8Array {
  if (value < 0x100) {
    return new Uint8Array([value])
  }
  else if (value < 0x10000) {
    return new Uint8Array([value >> 8, value & 0xff])
  }
  else if (value < 0x1000000) {
    return new Uint8Array([value >> 16, (value >> 8) & 0xff, value & 0xff])
  }
  else if (value < 0x100000000) {
    return new Uint8Array([value >> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
  }
  else {
    // Handle 8-byte values
    const high = Math.floor(value / 0x100000000)
    const low = value % 0x100000000
    return new Uint8Array([
      high >> 24,
      (high >> 16) & 0xff,
      (high >> 8) & 0xff,
      high & 0xff,
      low >> 24,
      (low >> 16) & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ])
  }
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
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
// ID3 Chapter Parsing (CHAP frame)
// ============================================================================

/** Parse chapters from ID3v2 tag */
export function parseId3Chapters(data: Uint8Array): ChapterList {
  const chapters: Chapter[] = []

  // Check for ID3v2 header
  if (data.length < 10 || data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) {
    return { chapters }
  }

  const version = data[3]
  const flags = data[5]
  const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f)

  let offset = 10

  // Skip extended header if present
  if (flags & 0x40) {
    const extSize = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    offset += extSize
  }

  const end = Math.min(offset + size, data.length)

  // Parse frames
  while (offset < end - 10) {
    const frameId = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
    let frameSize: number

    if (version === 4) {
      // ID3v2.4 uses syncsafe integers
      frameSize = ((data[offset + 4] & 0x7f) << 21) | ((data[offset + 5] & 0x7f) << 14) | ((data[offset + 6] & 0x7f) << 7) | (data[offset + 7] & 0x7f)
    }
    else {
      frameSize = (data[offset + 4] << 24) | (data[offset + 5] << 16) | (data[offset + 6] << 8) | data[offset + 7]
    }

    if (frameSize === 0) break

    offset += 10

    if (frameId === 'CHAP') {
      const chapter = parseId3ChapFrame(data.slice(offset, offset + frameSize))
      if (chapter) {
        chapters.push(chapter)
      }
    }

    offset += frameSize
  }

  return { chapters }
}

function parseId3ChapFrame(data: Uint8Array): Chapter | null {
  // Element ID (null-terminated string)
  let offset = 0
  while (offset < data.length && data[offset] !== 0) offset++
  offset++ // Skip null terminator

  if (offset + 16 > data.length) return null

  // Time values (4 bytes each, big-endian)
  const startTime = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
  offset += 4
  const endTime = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
  offset += 4
  // Skip start offset and end offset (file byte positions)
  offset += 8

  // Parse sub-frames for title
  let title = ''
  while (offset < data.length - 10) {
    const subFrameId = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
    const subFrameSize = (data[offset + 4] << 24) | (data[offset + 5] << 16) | (data[offset + 6] << 8) | data[offset + 7]
    offset += 10

    if (subFrameId === 'TIT2') {
      // Title frame
      const encoding = data[offset]
      title = decodeId3String(data.slice(offset + 1, offset + subFrameSize), encoding)
    }

    offset += subFrameSize
  }

  return {
    startTime,
    endTime: endTime === 0xffffffff ? undefined : endTime,
    title,
  }
}

function decodeId3String(data: Uint8Array, encoding: number): string {
  switch (encoding) {
    case 0: // ISO-8859-1
      return new TextDecoder('iso-8859-1').decode(data)
    case 1: // UTF-16 with BOM
      return new TextDecoder('utf-16').decode(data)
    case 2: // UTF-16BE
      return new TextDecoder('utf-16be').decode(data)
    case 3: // UTF-8
      return new TextDecoder('utf-8').decode(data)
    default:
      return new TextDecoder('utf-8').decode(data)
  }
}

/** Create ID3v2 CHAP frame */
export function createId3ChapFrame(chapter: Chapter, elementId: string): Uint8Array {
  const elementIdBytes = new TextEncoder().encode(elementId + '\0')

  // Create TIT2 sub-frame for title
  const titleBytes = new TextEncoder().encode(chapter.title)
  const tit2Size = 1 + titleBytes.length // encoding byte + title
  const tit2Frame = new Uint8Array(10 + tit2Size)
  tit2Frame.set([0x54, 0x49, 0x54, 0x32]) // 'TIT2'
  tit2Frame[4] = (tit2Size >> 24) & 0xff
  tit2Frame[5] = (tit2Size >> 16) & 0xff
  tit2Frame[6] = (tit2Size >> 8) & 0xff
  tit2Frame[7] = tit2Size & 0xff
  tit2Frame[10] = 3 // UTF-8 encoding
  tit2Frame.set(titleBytes, 11)

  // Create CHAP frame
  const chapSize = elementIdBytes.length + 16 + tit2Frame.length
  const chapFrame = new Uint8Array(10 + chapSize)

  // Frame header
  chapFrame.set([0x43, 0x48, 0x41, 0x50]) // 'CHAP'
  chapFrame[4] = (chapSize >> 24) & 0xff
  chapFrame[5] = (chapSize >> 16) & 0xff
  chapFrame[6] = (chapSize >> 8) & 0xff
  chapFrame[7] = chapSize & 0xff

  let offset = 10

  // Element ID
  chapFrame.set(elementIdBytes, offset)
  offset += elementIdBytes.length

  // Start time (ms)
  const startTime = Math.floor(chapter.startTime)
  chapFrame[offset++] = (startTime >> 24) & 0xff
  chapFrame[offset++] = (startTime >> 16) & 0xff
  chapFrame[offset++] = (startTime >> 8) & 0xff
  chapFrame[offset++] = startTime & 0xff

  // End time (ms)
  const endTimeVal = chapter.endTime !== undefined ? Math.floor(chapter.endTime) : 0xffffffff
  chapFrame[offset++] = (endTimeVal >> 24) & 0xff
  chapFrame[offset++] = (endTimeVal >> 16) & 0xff
  chapFrame[offset++] = (endTimeVal >> 8) & 0xff
  chapFrame[offset++] = endTimeVal & 0xff

  // Start offset (0xffffffff = not specified)
  chapFrame[offset++] = 0xff
  chapFrame[offset++] = 0xff
  chapFrame[offset++] = 0xff
  chapFrame[offset++] = 0xff

  // End offset
  chapFrame[offset++] = 0xff
  chapFrame[offset++] = 0xff
  chapFrame[offset++] = 0xff
  chapFrame[offset++] = 0xff

  // Sub-frames
  chapFrame.set(tit2Frame, offset)

  return chapFrame
}

// ============================================================================
// CUE Sheet Parsing
// ============================================================================

/** Parse CUE sheet text */
export function parseCueSheet(text: string): ChapterList {
  const chapters: Chapter[] = []
  const lines = text.split(/\r?\n/)

  let currentTrack: Chapter | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    const trackMatch = trimmed.match(/^TRACK\s+(\d+)\s+(\w+)$/i)
    if (trackMatch) {
      if (currentTrack) {
        chapters.push(currentTrack)
      }
      currentTrack = {
        startTime: 0,
        title: `Track ${trackMatch[1]}`,
      }
      continue
    }

    const titleMatch = trimmed.match(/^TITLE\s+"([^"]+)"$/i)
    if (titleMatch && currentTrack) {
      currentTrack.title = titleMatch[1]
      continue
    }

    const performerMatch = trimmed.match(/^PERFORMER\s+"([^"]+)"$/i)
    if (performerMatch && currentTrack) {
      currentTrack.metadata = currentTrack.metadata || {}
      currentTrack.metadata.performer = performerMatch[1]
      continue
    }

    const indexMatch = trimmed.match(/^INDEX\s+(\d+)\s+(\d+):(\d+):(\d+)$/i)
    if (indexMatch && currentTrack && indexMatch[1] === '01') {
      // INDEX 01 is the main index
      const minutes = parseInt(indexMatch[2], 10)
      const seconds = parseInt(indexMatch[3], 10)
      const frames = parseInt(indexMatch[4], 10) // 75 frames per second in CD audio
      currentTrack.startTime = (minutes * 60 + seconds) * 1000 + Math.floor((frames / 75) * 1000)
      continue
    }
  }

  if (currentTrack) {
    chapters.push(currentTrack)
  }

  // Set end times
  for (let i = 0; i < chapters.length - 1; i++) {
    chapters[i].endTime = chapters[i + 1].startTime
  }

  return { chapters }
}

/** Generate CUE sheet text */
export function generateCueSheet(chapterList: ChapterList, audioFile: string, audioFormat: string = 'WAVE'): string {
  const lines: string[] = []

  lines.push(`FILE "${audioFile}" ${audioFormat}`)

  for (let i = 0; i < chapterList.chapters.length; i++) {
    const chapter = chapterList.chapters[i]
    const trackNum = (i + 1).toString().padStart(2, '0')

    lines.push(`  TRACK ${trackNum} AUDIO`)
    lines.push(`    TITLE "${chapter.title}"`)

    if (chapter.metadata?.performer) {
      lines.push(`    PERFORMER "${chapter.metadata.performer}"`)
    }

    // Convert ms to MM:SS:FF (75 frames per second)
    const totalSeconds = chapter.startTime / 1000
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const frames = Math.floor(((totalSeconds % 1) * 75))

    const mm = minutes.toString().padStart(2, '0')
    const ss = seconds.toString().padStart(2, '0')
    const ff = frames.toString().padStart(2, '0')

    lines.push(`    INDEX 01 ${mm}:${ss}:${ff}`)
  }

  return lines.join('\n')
}

// ============================================================================
// Chapter Utilities
// ============================================================================

/** Convert chapters to simple text format (compatible with FFmpeg metadata) */
export function chaptersToText(chapters: Chapter[]): string {
  const lines: string[] = [';FFMETADATA1']

  for (const chapter of chapters) {
    lines.push('')
    lines.push('[CHAPTER]')
    lines.push('TIMEBASE=1/1000')
    lines.push(`START=${Math.floor(chapter.startTime)}`)
    if (chapter.endTime !== undefined) {
      lines.push(`END=${Math.floor(chapter.endTime)}`)
    }
    lines.push(`title=${chapter.title}`)
  }

  return lines.join('\n')
}

/** Parse FFmpeg metadata chapter format */
export function parseChaptersFromText(text: string): ChapterList {
  const chapters: Chapter[] = []
  const lines = text.split(/\r?\n/)

  let currentChapter: Partial<Chapter> | null = null
  let timebase = 1000 // Default to milliseconds

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '[CHAPTER]') {
      if (currentChapter && currentChapter.title && currentChapter.startTime !== undefined) {
        chapters.push(currentChapter as Chapter)
      }
      currentChapter = {}
      continue
    }

    if (!currentChapter) continue

    const match = trimmed.match(/^(\w+)=(.*)$/)
    if (match) {
      const [, key, value] = match

      switch (key.toUpperCase()) {
        case 'TIMEBASE':
          const tbMatch = value.match(/1\/(\d+)/)
          if (tbMatch) {
            timebase = parseInt(tbMatch[1], 10)
          }
          break
        case 'START':
          currentChapter.startTime = (parseInt(value, 10) / timebase) * 1000
          break
        case 'END':
          currentChapter.endTime = (parseInt(value, 10) / timebase) * 1000
          break
        case 'TITLE':
          currentChapter.title = value
          break
      }
    }
  }

  if (currentChapter && currentChapter.title && currentChapter.startTime !== undefined) {
    chapters.push(currentChapter as Chapter)
  }

  return { chapters }
}

/** Format time in HH:MM:SS.mmm format */
export function formatChapterTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor(ms % 1000)

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

/** Parse time string to milliseconds */
export function parseChapterTime(time: string): number {
  const match = time.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/)
  if (!match) return 0

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const seconds = parseInt(match[3], 10)
  const millis = match[4] ? parseInt(match[4].padEnd(3, '0').slice(0, 3), 10) : 0

  return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis
}

/** Create a chapter list from time/title pairs */
export function createChapterList(entries: Array<{ time: string | number; title: string }>, duration?: number): ChapterList {
  const chapters: Chapter[] = entries.map((entry) => ({
    startTime: typeof entry.time === 'string' ? parseChapterTime(entry.time) : entry.time,
    title: entry.title,
  }))

  // Sort by start time
  chapters.sort((a, b) => a.startTime - b.startTime)

  // Set end times
  for (let i = 0; i < chapters.length - 1; i++) {
    chapters[i].endTime = chapters[i + 1].startTime
  }

  if (duration && chapters.length > 0) {
    chapters[chapters.length - 1].endTime = duration
  }

  return { chapters, duration }
}

/** Merge overlapping or adjacent chapters */
export function mergeChapters(chapters: Chapter[], threshold: number = 1000): Chapter[] {
  if (chapters.length === 0) return []

  const sorted = [...chapters].sort((a, b) => a.startTime - b.startTime)
  const merged: Chapter[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]

    if (curr.startTime - (prev.endTime ?? prev.startTime) <= threshold) {
      // Merge chapters
      prev.endTime = curr.endTime ?? curr.startTime
      prev.title = `${prev.title} / ${curr.title}`
    }
    else {
      merged.push({ ...curr })
    }
  }

  return merged
}

/** Split a chapter at a specific time */
export function splitChapter(chapter: Chapter, splitTime: number, title1?: string, title2?: string): [Chapter, Chapter] {
  return [
    {
      ...chapter,
      endTime: splitTime,
      title: title1 ?? `${chapter.title} (Part 1)`,
    },
    {
      ...chapter,
      startTime: splitTime,
      title: title2 ?? `${chapter.title} (Part 2)`,
    },
  ]
}
