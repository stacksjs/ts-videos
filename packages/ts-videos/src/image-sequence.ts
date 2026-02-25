/* eslint-disable style/max-statements-per-line */
/**
 * Image sequence support for reading and writing frame sequences
 * Supports common image formats (PNG, JPEG, WebP, BMP, TIFF)
 */

// ============================================================================
// Types
// ============================================================================

/** Supported image formats */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff' | 'gif'

/** Options for image sequence reading */
export interface ImageSequenceReaderOptions {
  /** Start frame number (default: 0) */
  startFrame?: number
  /** End frame number (default: auto-detect or infinity) */
  endFrame?: number
  /** Frame rate for the sequence (default: 30) */
  frameRate?: number
  /** Pattern for frame numbering (e.g., 'frame_%04d.png') */
  pattern?: string
  /** Whether to loop the sequence */
  loop?: boolean
  /** Number of times to loop (0 = infinite) */
  loopCount?: number
}

/** Options for image sequence writing */
export interface ImageSequenceWriterOptions {
  /** Output directory */
  outputDir: string
  /** Filename pattern (e.g., 'frame_%04d.png') */
  pattern?: string
  /** Image format to use */
  format?: ImageFormat
  /** Quality for lossy formats (0-100) */
  quality?: number
  /** Start number for frame naming */
  startNumber?: number
  /** Whether to overwrite existing files */
  overwrite?: boolean
}

/** Frame data from an image sequence */
export interface SequenceFrame {
  /** Frame number (0-indexed) */
  frameNumber: number
  /** Timestamp in milliseconds */
  timestamp: number
  /** Image data */
  data: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Image format */
  format: ImageFormat
}

/** Image sequence metadata */
export interface ImageSequenceInfo {
  /** Total number of frames */
  frameCount: number
  /** Frame rate */
  frameRate: number
  /** Duration in milliseconds */
  duration: number
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Image format */
  format: ImageFormat
  /** First frame number */
  firstFrame: number
  /** Last frame number */
  lastFrame: number
  /** Pattern used for frame names */
  pattern: string
  /** List of frame file paths */
  framePaths: string[]
}

/** Pattern match result */
export interface PatternMatch {
  /** Directory path */
  directory: string
  /** Filename prefix */
  prefix: string
  /** Number of digits for frame number */
  digits: number
  /** Filename suffix/extension */
  suffix: string
  /** Image format */
  format: ImageFormat
}

// ============================================================================
// Pattern Utilities
// ============================================================================

/** Common image sequence patterns */
export const SEQUENCE_PATTERNS = {
  /** FFmpeg-style: frame_%04d.png */
  FFMPEG: 'frame_%04d.png',
  /** Simple numbered: 0001.png */
  NUMBERED: '%04d.png',
  /** With prefix: img_0001.jpg */
  PREFIXED: 'img_%04d.jpg',
  /** Blender-style: frame0001.png */
  BLENDER: 'frame%04d.png',
  /** After Effects style: comp_00001.tiff */
  AFTER_EFFECTS: 'comp_%05d.tiff',
}

/** Detect format from file extension */
export function detectImageFormat(filename: string): ImageFormat | null {
  const ext = filename.toLowerCase().split('.').pop()
  switch (ext) {
    case 'png':
      return 'png'
    case 'jpg':
    case 'jpeg':
      return 'jpeg'
    case 'webp':
      return 'webp'
    case 'bmp':
      return 'bmp'
    case 'tif':
    case 'tiff':
      return 'tiff'
    case 'gif':
      return 'gif'
    default:
      return null
  }
}

/** Get file extension for format */
export function getFormatExtension(format: ImageFormat): string {
  switch (format) {
    case 'png':
      return 'png'
    case 'jpeg':
      return 'jpg'
    case 'webp':
      return 'webp'
    case 'bmp':
      return 'bmp'
    case 'tiff':
      return 'tiff'
    case 'gif':
      return 'gif'
  }
}

/** Parse a filename pattern (e.g., 'frame_%04d.png') */
export function parsePattern(pattern: string): PatternMatch | null {
  // Match patterns like 'prefix_%04d.ext' or 'prefix%04d.ext'
  const match = pattern.match(/^(.*)%0?(\d+)d\.(\w+)$/i)
  if (!match) return null

  const prefix = match[1]
  const digits = parseInt(match[2], 10)
  const ext = match[3].toLowerCase()
  const format = detectImageFormat(`file.${ext}`)

  if (!format) return null

  return {
    directory: '',
    prefix,
    digits,
    suffix: `.${ext}`,
    format,
  }
}

/** Generate filename from pattern and frame number */
export function generateFilename(pattern: string, frameNumber: number): string {
  // Replace %0Nd with zero-padded number
  return pattern.replace(/%0?(\d+)d/i, (_, digits) => {
    return frameNumber.toString().padStart(parseInt(digits, 10), '0')
  })
}

/** Extract frame number from filename using pattern */
export function extractFrameNumber(filename: string, pattern: string): number | null {
  // Convert pattern to regex
  const patternMatch = parsePattern(pattern)
  if (!patternMatch) return null

  const { prefix, digits, suffix } = patternMatch
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escapedPrefix}(\\d{${digits}})${escapedSuffix}$`, 'i')

  const match = filename.match(regex)
  if (!match) return null

  return parseInt(match[1], 10)
}

/** Detect pattern from a list of filenames */
export function detectPattern(filenames: string[]): string | null {
  if (filenames.length === 0) return null

  // Sort filenames
  const sorted = [...filenames].sort()

  // Try to find common pattern
  const first = sorted[0]
  const format = detectImageFormat(first)
  if (!format) return null

  const ext = getFormatExtension(format)

  // Try different patterns
  const patterns = [
    /^(.*)(\d+)\.(\w+)$/i, // prefix + number + extension
    /^(\d+)\.(\w+)$/i, // just number + extension
  ]

  for (const regex of patterns) {
    const match = first.match(regex)
    if (match) {
      if (match.length === 4) {
        // prefix + number + extension
        const prefix = match[1]
        const numStr = match[2]
        const digits = numStr.length
        return `${prefix}%0${digits}d.${ext}`
      }
      else if (match.length === 3) {
        // number + extension
        const numStr = match[1]
        const digits = numStr.length
        return `%0${digits}d.${ext}`
      }
    }
  }

  return null
}

/** Find all frames matching a pattern in a list of filenames */
export function findSequenceFrames(filenames: string[], pattern: string): Map<number, string> {
  const frames = new Map<number, string>()

  for (const filename of filenames) {
    const frameNum = extractFrameNumber(filename, pattern)
    if (frameNum !== null) {
      frames.set(frameNum, filename)
    }
  }

  return frames
}

/** Get missing frame numbers in a sequence */
export function findMissingFrames(frames: Map<number, string>): number[] {
  if (frames.size === 0) return []

  const frameNumbers = Array.from(frames.keys()).sort((a, b) => a - b)
  const first = frameNumbers[0]
  const last = frameNumbers[frameNumbers.length - 1]
  const missing: number[] = []

  for (let i = first; i <= last; i++) {
    if (!frames.has(i)) {
      missing.push(i)
    }
  }

  return missing
}

// ============================================================================
// Image Sequence Reader
// ============================================================================

/** Reader for image sequences */
export class ImageSequenceReader {
  private filenames: Map<number, string>
  private frameNumbers: number[]
  private currentIndex: number = 0
  private loopCount: number = 0

  constructor(
    private readonly options: ImageSequenceReaderOptions & { files: Map<number, string> },
  ) {
    this.filenames = options.files
    this.frameNumbers = Array.from(this.filenames.keys()).sort((a, b) => a - b)

    // Filter by start/end frame
    if (options.startFrame !== undefined) {
      this.frameNumbers = this.frameNumbers.filter((n) => n >= options.startFrame!)
    }
    if (options.endFrame !== undefined) {
      this.frameNumbers = this.frameNumbers.filter((n) => n <= options.endFrame!)
    }
  }

  /** Get sequence info */
  getInfo(): Partial<ImageSequenceInfo> {
    const frameRate = this.options.frameRate ?? 30
    const firstFrame = this.frameNumbers[0] ?? 0
    const lastFrame = this.frameNumbers[this.frameNumbers.length - 1] ?? 0

    return {
      frameCount: this.frameNumbers.length,
      frameRate,
      duration: (this.frameNumbers.length / frameRate) * 1000,
      firstFrame,
      lastFrame,
      framePaths: this.frameNumbers.map((n) => this.filenames.get(n)!),
    }
  }

  /** Check if there are more frames */
  hasNext(): boolean {
    if (this.currentIndex < this.frameNumbers.length) {
      return true
    }

    if (this.options.loop) {
      if (this.options.loopCount === 0 || (this.options.loopCount !== undefined && this.loopCount < this.options.loopCount)) {
        return true
      }
    }

    return false
  }

  /** Get the next frame number and filename */
  next(): { frameNumber: number; filename: string; timestamp: number } | null {
    if (!this.hasNext()) return null

    if (this.currentIndex >= this.frameNumbers.length) {
      // Loop back to start
      this.currentIndex = 0
      this.loopCount++
    }

    const frameNumber = this.frameNumbers[this.currentIndex]
    const filename = this.filenames.get(frameNumber)!
    const frameRate = this.options.frameRate ?? 30
    const baseTimestamp = (this.currentIndex / frameRate) * 1000
    const loopOffset = this.loopCount * (this.frameNumbers.length / frameRate) * 1000

    this.currentIndex++

    return {
      frameNumber,
      filename,
      timestamp: baseTimestamp + loopOffset,
    }
  }

  /** Reset to beginning */
  reset(): void {
    this.currentIndex = 0
    this.loopCount = 0
  }

  /** Seek to a specific frame index */
  seek(index: number): void {
    this.currentIndex = Math.max(0, Math.min(index, this.frameNumbers.length - 1))
  }

  /** Seek to a specific timestamp */
  seekToTime(timestamp: number): void {
    const frameRate = this.options.frameRate ?? 30
    const index = Math.floor((timestamp / 1000) * frameRate)
    this.seek(index)
  }

  /** Get frame at specific index without advancing */
  peekAt(index: number): { frameNumber: number; filename: string; timestamp: number } | null {
    if (index < 0 || index >= this.frameNumbers.length) return null

    const frameNumber = this.frameNumbers[index]
    const filename = this.filenames.get(frameNumber)!
    const frameRate = this.options.frameRate ?? 30
    const timestamp = (index / frameRate) * 1000

    return { frameNumber, filename, timestamp }
  }

  /** Get total frame count */
  get frameCount(): number {
    return this.frameNumbers.length
  }

  /** Get current frame index */
  get currentFrame(): number {
    return this.currentIndex
  }

  /** Iterate over all frames */
  *[Symbol.iterator](): Iterator<{ frameNumber: number; filename: string; timestamp: number }> {
    this.reset()
    while (this.hasNext()) {
      const frame = this.next()
      if (frame) yield frame
    }
  }
}

// ============================================================================
// Image Sequence Writer
// ============================================================================

/** Writer for image sequences */
export class ImageSequenceWriter {
  private frameCount: number = 0
  private readonly pattern: string
  private readonly format: ImageFormat

  constructor(private readonly options: ImageSequenceWriterOptions) {
    this.pattern = options.pattern ?? SEQUENCE_PATTERNS.FFMPEG
    this.format = options.format ?? detectImageFormat(this.pattern) ?? 'png'
    this.frameCount = options.startNumber ?? 0
  }

  /** Generate the next frame filename */
  nextFilename(): string {
    const filename = generateFilename(this.pattern, this.frameCount)
    this.frameCount++
    return `${this.options.outputDir}/${filename}`
  }

  /** Generate filename for a specific frame number */
  filenameFor(frameNumber: number): string {
    const filename = generateFilename(this.pattern, frameNumber)
    return `${this.options.outputDir}/${filename}`
  }

  /** Get the current frame count */
  get currentFrame(): number {
    return this.frameCount
  }

  /** Get the output format */
  get outputFormat(): ImageFormat {
    return this.format
  }

  /** Get the quality setting */
  get quality(): number {
    return this.options.quality ?? 90
  }

  /** Reset frame counter */
  reset(): void {
    this.frameCount = this.options.startNumber ?? 0
  }

  /** Get list of all filenames that would be generated */
  getFilenames(count: number): string[] {
    const filenames: string[] = []
    const startNum = this.options.startNumber ?? 0

    for (let i = 0; i < count; i++) {
      const filename = generateFilename(this.pattern, startNum + i)
      filenames.push(`${this.options.outputDir}/${filename}`)
    }

    return filenames
  }
}

// ============================================================================
// Sprite Sheet Support
// ============================================================================

/** Options for sprite sheet generation */
export interface SpriteSheetOptions {
  /** Number of columns (default: auto) */
  columns?: number
  /** Number of rows (default: auto) */
  rows?: number
  /** Individual frame width (scales if needed) */
  frameWidth?: number
  /** Individual frame height (scales if needed) */
  frameHeight?: number
  /** Padding between frames */
  padding?: number
  /** Background color (CSS color string) */
  backgroundColor?: string
  /** Output format */
  format?: ImageFormat
  /** Quality for lossy formats */
  quality?: number
}

/** Sprite sheet metadata */
export interface SpriteSheetInfo {
  /** Total width of sprite sheet */
  width: number
  /** Total height of sprite sheet */
  height: number
  /** Number of columns */
  columns: number
  /** Number of rows */
  rows: number
  /** Individual frame width */
  frameWidth: number
  /** Individual frame height */
  frameHeight: number
  /** Total number of frames */
  frameCount: number
  /** Padding between frames */
  padding: number
  /** Frame positions (x, y for each frame) */
  frames: Array<{ x: number; y: number; index: number }>
}

/** Calculate optimal sprite sheet layout */
export function calculateSpriteSheetLayout(
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  options: SpriteSheetOptions = {},
): SpriteSheetInfo {
  const padding = options.padding ?? 0

  let columns: number
  let rows: number

  if (options.columns && options.rows) {
    columns = options.columns
    rows = options.rows
  }
  else if (options.columns) {
    columns = options.columns
    rows = Math.ceil(frameCount / columns)
  }
  else if (options.rows) {
    rows = options.rows
    columns = Math.ceil(frameCount / rows)
  }
  else {
    // Auto-calculate for roughly square layout
    columns = Math.ceil(Math.sqrt(frameCount))
    rows = Math.ceil(frameCount / columns)
  }

  const width = columns * frameWidth + (columns - 1) * padding
  const height = rows * frameHeight + (rows - 1) * padding

  const frames: Array<{ x: number; y: number; index: number }> = []
  for (let i = 0; i < frameCount; i++) {
    const col = i % columns
    const row = Math.floor(i / columns)
    frames.push({
      x: col * (frameWidth + padding),
      y: row * (frameHeight + padding),
      index: i,
    })
  }

  return {
    width,
    height,
    columns,
    rows,
    frameWidth,
    frameHeight,
    frameCount,
    padding,
    frames,
  }
}

/** Get frame position in sprite sheet */
export function getSpritePosition(
  frameIndex: number,
  layout: SpriteSheetInfo,
): { x: number; y: number } | null {
  if (frameIndex < 0 || frameIndex >= layout.frameCount) return null
  return layout.frames[frameIndex]
}

/** Generate CSS for sprite sheet animation */
export function generateSpriteSheetCss(
  layout: SpriteSheetInfo,
  imageUrl: string,
  animationName: string = 'sprite-animation',
  duration: number = 1000,
): string {
  const keyframes: string[] = []

  for (let i = 0; i < layout.frameCount; i++) {
    const frame = layout.frames[i]
    const percent = (i / layout.frameCount) * 100
    keyframes.push(`  ${percent.toFixed(2)}% { background-position: -${frame.x}px -${frame.y}px; }`)
  }

  return `
.sprite-container {
  width: ${layout.frameWidth}px;
  height: ${layout.frameHeight}px;
  background-image: url('${imageUrl}');
  background-repeat: no-repeat;
  animation: ${animationName} ${duration}ms steps(1) infinite;
}

@keyframes ${animationName} {
${keyframes.join('\n')}
  100% { background-position: -${layout.frames[0].x}px -${layout.frames[0].y}px; }
}
`.trim()
}

// ============================================================================
// Frame Interpolation
// ============================================================================

/** Interpolation method for frame rate conversion */
export type InterpolationMethod = 'nearest' | 'blend' | 'motion'

/** Options for frame rate conversion */
export interface FrameRateConversionOptions {
  /** Source frame rate */
  sourceFrameRate: number
  /** Target frame rate */
  targetFrameRate: number
  /** Interpolation method */
  method?: InterpolationMethod
  /** Blend factor for 'blend' method (0-1) */
  blendFactor?: number
}

/** Calculate frame mapping for frame rate conversion */
export function calculateFrameMapping(
  sourceFrameCount: number,
  options: FrameRateConversionOptions,
): Array<{ targetFrame: number; sourceFrame: number; blend?: number; nextFrame?: number }> {
  const { sourceFrameRate, targetFrameRate, method = 'nearest' } = options

  const sourceDuration = sourceFrameCount / sourceFrameRate
  const targetFrameCount = Math.ceil(sourceDuration * targetFrameRate)
  const mapping: Array<{ targetFrame: number; sourceFrame: number; blend?: number; nextFrame?: number }> = []

  for (let i = 0; i < targetFrameCount; i++) {
    const targetTime = i / targetFrameRate
    const sourceFrameExact = targetTime * sourceFrameRate

    if (method === 'nearest') {
      mapping.push({
        targetFrame: i,
        sourceFrame: Math.round(sourceFrameExact) % sourceFrameCount,
      })
    }
    else if (method === 'blend' || method === 'motion') {
      const sourceFrameLow = Math.floor(sourceFrameExact) % sourceFrameCount
      const sourceFrameHigh = Math.ceil(sourceFrameExact) % sourceFrameCount
      const blend = sourceFrameExact - Math.floor(sourceFrameExact)

      mapping.push({
        targetFrame: i,
        sourceFrame: sourceFrameLow,
        nextFrame: sourceFrameHigh !== sourceFrameLow ? sourceFrameHigh : undefined,
        blend: sourceFrameHigh !== sourceFrameLow ? blend : undefined,
      })
    }
  }

  return mapping
}

/** Calculate duplicate/drop frames for simple frame rate conversion */
export function calculateSimpleFrameMapping(
  sourceFrameCount: number,
  sourceFrameRate: number,
  targetFrameRate: number,
): number[] {
  const sourceDuration = sourceFrameCount / sourceFrameRate
  const targetFrameCount = Math.ceil(sourceDuration * targetFrameRate)
  const mapping: number[] = []

  for (let i = 0; i < targetFrameCount; i++) {
    const targetTime = i / targetFrameRate
    const sourceFrame = Math.round(targetTime * sourceFrameRate)
    mapping.push(Math.min(sourceFrame, sourceFrameCount - 1))
  }

  return mapping
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Create an image sequence from video frame timestamps */
export function createSequenceFromTimestamps(
  timestamps: number[],
  pattern: string,
  outputDir: string,
): string[] {
  return timestamps.map((_, index) => {
    const filename = generateFilename(pattern, index)
    return `${outputDir}/${filename}`
  })
}

/** Validate image sequence for gaps and consistency */
export function validateSequence(
  frames: Map<number, string>,
): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  if (frames.size === 0) {
    return { valid: false, issues: ['No frames found'] }
  }

  // Check for gaps
  const missing = findMissingFrames(frames)
  if (missing.length > 0) {
    if (missing.length <= 10) {
      issues.push(`Missing frames: ${missing.join(', ')}`)
    }
    else {
      issues.push(`Missing ${missing.length} frames (first: ${missing[0]}, last: ${missing[missing.length - 1]})`)
    }
  }

  // Check for consistent format
  const formats = new Set<string>()
  for (const filename of frames.values()) {
    const format = detectImageFormat(filename)
    if (format) formats.add(format)
  }

  if (formats.size > 1) {
    issues.push(`Multiple image formats found: ${Array.from(formats).join(', ')}`)
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/** Estimate file size for image sequence */
export function estimateSequenceSize(
  frameCount: number,
  width: number,
  height: number,
  format: ImageFormat,
  quality: number = 90,
): number {
  // Rough estimates based on format and dimensions
  const pixels = width * height

  // Bytes per pixel estimates
  const bytesPerPixel: Record<ImageFormat, number> = {
    png: 2.5, // Lossless, varies by content
    jpeg: 0.3 + (quality / 100) * 0.5, // ~0.3-0.8 depending on quality
    webp: 0.2 + (quality / 100) * 0.4, // ~0.2-0.6 depending on quality
    bmp: 3, // Uncompressed RGB
    tiff: 3, // Uncompressed (could be less with compression)
    gif: 1, // Limited palette
  }

  const bytesPerFrame = pixels * (bytesPerPixel[format] ?? 1)
  return Math.ceil(bytesPerFrame * frameCount)
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

/** Get recommended settings for different use cases */
export function getRecommendedSettings(
  useCase: 'web' | 'archive' | 'editing' | 'preview',
): { format: ImageFormat; quality: number; pattern: string } {
  switch (useCase) {
    case 'web':
      return {
        format: 'webp',
        quality: 85,
        pattern: 'frame_%04d.webp',
      }
    case 'archive':
      return {
        format: 'png',
        quality: 100,
        pattern: 'frame_%06d.png',
      }
    case 'editing':
      return {
        format: 'tiff',
        quality: 100,
        pattern: 'frame_%05d.tiff',
      }
    case 'preview':
      return {
        format: 'jpeg',
        quality: 70,
        pattern: 'preview_%04d.jpg',
      }
  }
}
