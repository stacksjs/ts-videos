/**
 * Cover art extraction and handling utilities
 * Similar to mediabunny's cover art system
 */

/**
 * Cover art type classification
 */
export enum CoverArtType {
  /** Other type not listed */
  Other = 0,
  /** 32x32 pixels icon (PNG only) */
  FileIcon = 1,
  /** Other file icon */
  OtherFileIcon = 2,
  /** Cover (front) */
  FrontCover = 3,
  /** Cover (back) */
  BackCover = 4,
  /** Leaflet page */
  LeafletPage = 5,
  /** Media (e.g., label side of CD) */
  Media = 6,
  /** Lead artist/lead performer/soloist */
  LeadArtist = 7,
  /** Artist/performer */
  Artist = 8,
  /** Conductor */
  Conductor = 9,
  /** Band/Orchestra */
  Band = 10,
  /** Composer */
  Composer = 11,
  /** Lyricist/text writer */
  Lyricist = 12,
  /** Recording location */
  RecordingLocation = 13,
  /** During recording */
  DuringRecording = 14,
  /** During performance */
  DuringPerformance = 15,
  /** Movie/video screen capture */
  ScreenCapture = 16,
  /** A bright coloured fish */
  BrightColouredFish = 17,
  /** Illustration */
  Illustration = 18,
  /** Band/artist logotype */
  BandLogo = 19,
  /** Publisher/Studio logotype */
  PublisherLogo = 20,
}

/**
 * Cover art image format
 */
export enum CoverArtFormat {
  JPEG = 'image/jpeg',
  PNG = 'image/png',
  GIF = 'image/gif',
  BMP = 'image/bmp',
  WEBP = 'image/webp',
  TIFF = 'image/tiff',
  Unknown = 'application/octet-stream',
}

/**
 * Cover art data
 */
export interface CoverArt {
  /** Cover art type */
  type: CoverArtType
  /** MIME type */
  mimeType: string
  /** Description */
  description?: string
  /** Image data */
  data: Uint8Array
  /** Image width (if known) */
  width?: number
  /** Image height (if known) */
  height?: number
  /** Color depth (bits per pixel) */
  colorDepth?: number
  /** Number of colors (for indexed images) */
  colorCount?: number
}

/**
 * Cover art extraction result
 */
export interface CoverArtResult {
  /** All found cover art */
  coverArt: CoverArt[]
  /** Front cover (convenience accessor) */
  frontCover?: CoverArt
  /** Back cover (convenience accessor) */
  backCover?: CoverArt
  /** Any icon */
  icon?: CoverArt
}

/**
 * Detect image format from magic bytes
 */
export function detectImageFormat(data: Uint8Array): CoverArtFormat {
  if (data.length < 4) return CoverArtFormat.Unknown

  // JPEG: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return CoverArtFormat.JPEG
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return CoverArtFormat.PNG
  }

  // GIF: 47 49 46 38
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return CoverArtFormat.GIF
  }

  // BMP: 42 4D
  if (data[0] === 0x42 && data[1] === 0x4D) {
    return CoverArtFormat.BMP
  }

  // WEBP: 52 49 46 46 ... 57 45 42 50
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data.length >= 12 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return CoverArtFormat.WEBP
  }

  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  if ((data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2A && data[3] === 0x00) ||
      (data[0] === 0x4D && data[1] === 0x4D && data[2] === 0x00 && data[3] === 0x2A)) {
    return CoverArtFormat.TIFF
  }

  return CoverArtFormat.Unknown
}

/**
 * Get cover art type name
 */
export function getCoverArtTypeName(type: CoverArtType): string {
  const names: Record<CoverArtType, string> = {
    [CoverArtType.Other]: 'Other',
    [CoverArtType.FileIcon]: 'File Icon',
    [CoverArtType.OtherFileIcon]: 'Other File Icon',
    [CoverArtType.FrontCover]: 'Front Cover',
    [CoverArtType.BackCover]: 'Back Cover',
    [CoverArtType.LeafletPage]: 'Leaflet Page',
    [CoverArtType.Media]: 'Media',
    [CoverArtType.LeadArtist]: 'Lead Artist',
    [CoverArtType.Artist]: 'Artist',
    [CoverArtType.Conductor]: 'Conductor',
    [CoverArtType.Band]: 'Band/Orchestra',
    [CoverArtType.Composer]: 'Composer',
    [CoverArtType.Lyricist]: 'Lyricist',
    [CoverArtType.RecordingLocation]: 'Recording Location',
    [CoverArtType.DuringRecording]: 'During Recording',
    [CoverArtType.DuringPerformance]: 'During Performance',
    [CoverArtType.ScreenCapture]: 'Screen Capture',
    [CoverArtType.BrightColouredFish]: 'Illustration',
    [CoverArtType.Illustration]: 'Illustration',
    [CoverArtType.BandLogo]: 'Band Logo',
    [CoverArtType.PublisherLogo]: 'Publisher Logo',
  }
  return names[type] ?? 'Unknown'
}

/**
 * Parse JPEG dimensions
 */
function parseJpegDimensions(data: Uint8Array): { width: number; height: number } | null {
  let offset = 2 // Skip SOI marker

  while (offset < data.length - 8) {
    if (data[offset] !== 0xFF) {
      offset++
      continue
    }

    const marker = data[offset + 1]

    // SOF markers (Start of Frame)
    if ((marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF)) {
      const height = (data[offset + 5] << 8) | data[offset + 6]
      const width = (data[offset + 7] << 8) | data[offset + 8]
      return { width, height }
    }

    // Skip over marker segment
    if (marker >= 0xE0 && marker <= 0xFE) {
      const length = (data[offset + 2] << 8) | data[offset + 3]
      offset += 2 + length
    } else {
      offset += 2
    }
  }

  return null
}

/**
 * Parse PNG dimensions
 */
function parsePngDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null

  // IHDR chunk starts at offset 8
  const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]
  const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]

  return { width, height }
}

/**
 * Parse GIF dimensions
 */
function parseGifDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 10) return null

  const width = data[6] | (data[7] << 8)
  const height = data[8] | (data[9] << 8)

  return { width, height }
}

/**
 * Parse BMP dimensions
 */
function parseBmpDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 26) return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const width = view.getInt32(18, true)
  const height = Math.abs(view.getInt32(22, true))

  return { width, height }
}

/**
 * Parse WebP dimensions
 */
function parseWebpDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 30) return null

  // Check for VP8 or VP8L
  const fourCC = String.fromCharCode(data[12], data[13], data[14], data[15])

  if (fourCC === 'VP8 ') {
    // Lossy WebP
    const width = ((data[26] | (data[27] << 8)) & 0x3FFF)
    const height = ((data[28] | (data[29] << 8)) & 0x3FFF)
    return { width, height }
  }

  if (fourCC === 'VP8L') {
    // Lossless WebP
    const signature = data[21]
    if (signature !== 0x2F) return null

    const bits = data[22] | (data[23] << 8) | (data[24] << 16) | (data[25] << 24)
    const width = (bits & 0x3FFF) + 1
    const height = ((bits >> 14) & 0x3FFF) + 1
    return { width, height }
  }

  if (fourCC === 'VP8X') {
    // Extended WebP
    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16))
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16))
    return { width, height }
  }

  return null
}

/**
 * Get image dimensions from cover art data
 */
export function getImageDimensions(
  data: Uint8Array,
  format?: CoverArtFormat,
): { width: number; height: number } | null {
  const detectedFormat = format ?? detectImageFormat(data)

  switch (detectedFormat) {
    case CoverArtFormat.JPEG:
      return parseJpegDimensions(data)
    case CoverArtFormat.PNG:
      return parsePngDimensions(data)
    case CoverArtFormat.GIF:
      return parseGifDimensions(data)
    case CoverArtFormat.BMP:
      return parseBmpDimensions(data)
    case CoverArtFormat.WEBP:
      return parseWebpDimensions(data)
    default:
      return null
  }
}

/**
 * Parse ID3v2 APIC frame (Attached Picture)
 */
export function parseId3Apic(frameData: Uint8Array): CoverArt | null {
  if (frameData.length < 10) return null

  let offset = 0

  // Text encoding
  const encoding = frameData[offset++]
  const isUtf16 = encoding === 1 || encoding === 2

  // MIME type (null-terminated)
  let mimeEnd = offset
  while (mimeEnd < frameData.length && frameData[mimeEnd] !== 0) mimeEnd++
  const mimeType = new TextDecoder('ascii').decode(frameData.subarray(offset, mimeEnd))
  offset = mimeEnd + 1

  // Picture type
  const pictureType = frameData[offset++] as CoverArtType

  // Description (null-terminated, encoding-dependent)
  let descEnd = offset
  if (isUtf16) {
    while (descEnd < frameData.length - 1 &&
           !(frameData[descEnd] === 0 && frameData[descEnd + 1] === 0)) {
      descEnd += 2
    }
    descEnd += 2 // Skip double null
  } else {
    while (descEnd < frameData.length && frameData[descEnd] !== 0) descEnd++
    descEnd++ // Skip null
  }

  const description = isUtf16
    ? new TextDecoder(encoding === 1 ? 'utf-16le' : 'utf-16be').decode(frameData.subarray(offset, descEnd - 2))
    : new TextDecoder('utf-8').decode(frameData.subarray(offset, descEnd - 1))
  offset = descEnd

  // Picture data
  const pictureData = frameData.subarray(offset)
  const dimensions = getImageDimensions(pictureData)

  return {
    type: pictureType,
    mimeType: mimeType || detectImageFormat(pictureData),
    description: description || undefined,
    data: pictureData,
    width: dimensions?.width,
    height: dimensions?.height,
  }
}

/**
 * Parse FLAC PICTURE metadata block
 */
export function parseFlacPicture(blockData: Uint8Array): CoverArt | null {
  if (blockData.length < 32) return null

  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength)
  let offset = 0

  // Picture type (32-bit BE)
  const pictureType = view.getUint32(offset, false) as CoverArtType
  offset += 4

  // MIME type length (32-bit BE)
  const mimeLength = view.getUint32(offset, false)
  offset += 4

  // MIME type
  const mimeType = new TextDecoder('ascii').decode(blockData.subarray(offset, offset + mimeLength))
  offset += mimeLength

  // Description length (32-bit BE)
  const descLength = view.getUint32(offset, false)
  offset += 4

  // Description (UTF-8)
  const description = new TextDecoder('utf-8').decode(blockData.subarray(offset, offset + descLength))
  offset += descLength

  // Width (32-bit BE)
  const width = view.getUint32(offset, false)
  offset += 4

  // Height (32-bit BE)
  const height = view.getUint32(offset, false)
  offset += 4

  // Color depth (32-bit BE)
  const colorDepth = view.getUint32(offset, false)
  offset += 4

  // Number of colors (32-bit BE) - 0 for non-indexed
  const colorCount = view.getUint32(offset, false)
  offset += 4

  // Picture data length (32-bit BE)
  const dataLength = view.getUint32(offset, false)
  offset += 4

  // Picture data
  const pictureData = blockData.subarray(offset, offset + dataLength)

  return {
    type: pictureType,
    mimeType,
    description: description || undefined,
    data: pictureData,
    width,
    height,
    colorDepth,
    colorCount: colorCount > 0 ? colorCount : undefined,
  }
}

/**
 * Parse MP4 cover art (from 'covr' atom)
 */
export function parseMp4CoverArt(atomData: Uint8Array): CoverArt | null {
  if (atomData.length < 16) return null

  const view = new DataView(atomData.buffer, atomData.byteOffset, atomData.byteLength)

  // Skip atom size and 'data' type (8 bytes)
  let offset = 8

  // Type indicator
  const typeIndicator = view.getUint32(offset, false)
  offset += 4

  // Locale (skip)
  offset += 4

  // Determine MIME type from type indicator
  let mimeType: string
  switch (typeIndicator) {
    case 13: // JPEG
      mimeType = CoverArtFormat.JPEG
      break
    case 14: // PNG
      mimeType = CoverArtFormat.PNG
      break
    case 27: // BMP
      mimeType = CoverArtFormat.BMP
      break
    default:
      mimeType = CoverArtFormat.Unknown
  }

  const pictureData = atomData.subarray(offset)
  const dimensions = getImageDimensions(pictureData)

  return {
    type: CoverArtType.FrontCover, // MP4 covr doesn't specify type
    mimeType,
    data: pictureData,
    width: dimensions?.width,
    height: dimensions?.height,
  }
}

/**
 * Parse Vorbis comment METADATA_BLOCK_PICTURE
 */
export function parseVorbisCommentPicture(base64Data: string): CoverArt | null {
  // Decode base64
  const binaryString = atob(base64Data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  // Parse as FLAC picture format
  return parseFlacPicture(bytes)
}

/**
 * Create cover art result from array of cover art
 */
export function createCoverArtResult(coverArt: CoverArt[]): CoverArtResult {
  const result: CoverArtResult = {
    coverArt,
  }

  // Find front cover
  result.frontCover = coverArt.find(c => c.type === CoverArtType.FrontCover) ??
                       coverArt.find(c => c.type === CoverArtType.Other)

  // Find back cover
  result.backCover = coverArt.find(c => c.type === CoverArtType.BackCover)

  // Find icon
  result.icon = coverArt.find(c => c.type === CoverArtType.FileIcon) ??
                coverArt.find(c => c.type === CoverArtType.OtherFileIcon)

  return result
}

/**
 * Convert cover art to data URL
 */
export function coverArtToDataUrl(coverArt: CoverArt): string {
  const base64 = btoa(String.fromCharCode(...coverArt.data))
  return `data:${coverArt.mimeType};base64,${base64}`
}

/**
 * Convert cover art to Blob
 */
export function coverArtToBlob(coverArt: CoverArt): Blob {
  return new Blob([coverArt.data], { type: coverArt.mimeType })
}

/**
 * Create cover art from image data
 */
export function createCoverArt(
  data: Uint8Array,
  options: {
    type?: CoverArtType
    mimeType?: string
    description?: string
  } = {},
): CoverArt {
  const format = detectImageFormat(data)
  const dimensions = getImageDimensions(data, format)

  return {
    type: options.type ?? CoverArtType.FrontCover,
    mimeType: options.mimeType ?? format,
    description: options.description,
    data,
    width: dimensions?.width,
    height: dimensions?.height,
  }
}

/**
 * Resize cover art (requires browser environment with canvas)
 */
export async function resizeCoverArt(
  coverArt: CoverArt,
  maxWidth: number,
  maxHeight: number,
  options: {
    format?: 'image/jpeg' | 'image/png' | 'image/webp'
    quality?: number
  } = {},
): Promise<CoverArt> {
  const { format = 'image/jpeg', quality = 0.9 } = options

  // Create blob and image
  const blob = coverArtToBlob(coverArt)
  const bitmap = await createImageBitmap(blob)

  // Calculate new dimensions
  let newWidth = bitmap.width
  let newHeight = bitmap.height

  if (newWidth > maxWidth || newHeight > maxHeight) {
    const scale = Math.min(maxWidth / newWidth, maxHeight / newHeight)
    newWidth = Math.round(newWidth * scale)
    newHeight = Math.round(newHeight * scale)
  }

  // Draw to canvas
  const canvas = new OffscreenCanvas(newWidth, newHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }

  ctx.drawImage(bitmap, 0, 0, newWidth, newHeight)
  bitmap.close()

  // Convert to blob
  const resultBlob = await canvas.convertToBlob({ type: format, quality })
  const resultData = new Uint8Array(await resultBlob.arrayBuffer())

  return {
    type: coverArt.type,
    mimeType: format,
    description: coverArt.description,
    data: resultData,
    width: newWidth,
    height: newHeight,
  }
}
