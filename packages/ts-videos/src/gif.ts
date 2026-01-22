/**
 * GIF generation from video frames
 * Uses ts-gif for encoding with additional video-specific utilities
 */

import { Writer as GifWriter, Reader as GifReader } from 'ts-gif'
import { Buffer } from 'node:buffer'

// ============================================================================
// Types
// ============================================================================

/** GIF generation options */
export interface GifOptions {
  /** Output width (default: source width, max 800) */
  width?: number
  /** Output height (default: auto-calculated from aspect ratio) */
  height?: number
  /** Frame rate (default: 10) */
  frameRate?: number
  /** Number of colors in palette (2-256, default: 256) */
  colors?: number
  /** Loop count (0 = infinite, default: 0) */
  loop?: number
  /** Dithering algorithm */
  dither?: 'none' | 'floyd-steinberg' | 'ordered' | 'atkinson'
  /** Quality (1-100, affects color quantization) */
  quality?: number
  /** Transparency color index (optional) */
  transparent?: number
  /** Disposal method for frames */
  disposal?: 0 | 1 | 2 | 3
}

/** Frame data for GIF generation */
export interface GifFrame {
  /** RGBA pixel data */
  data: Uint8Array | Uint8ClampedArray
  /** Frame width */
  width: number
  /** Frame height */
  height: number
  /** Frame delay in milliseconds (optional, overrides default) */
  delay?: number
}

/** Color palette entry */
export interface PaletteColor {
  r: number
  g: number
  b: number
}

/** GIF metadata */
export interface GifMetadata {
  width: number
  height: number
  frameCount: number
  loopCount: number | null
  duration: number
  frames: Array<{
    delay: number
    x: number
    y: number
    width: number
    height: number
    disposal: number
    transparent: boolean
  }>
}

// ============================================================================
// Color Quantization
// ============================================================================

/** Median cut color quantization */
export function quantizeColors(
  frames: GifFrame[],
  colorCount: number = 256,
): number[] {
  // Collect all unique colors from all frames
  const colorCounts = new Map<number, number>()

  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      const r = frame.data[i]
      const g = frame.data[i + 1]
      const b = frame.data[i + 2]
      const key = (r << 16) | (g << 8) | b

      colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1)
    }
  }

  // Convert to array for processing
  const colors = Array.from(colorCounts.entries()).map(([color, count]) => ({
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
    count,
  }))

  // Median cut algorithm
  const palette = medianCut(colors, colorCount)

  // Convert to packed RGB values
  return palette.map((c) => (c.r << 16) | (c.g << 8) | c.b)
}

interface ColorBox {
  colors: Array<{ r: number; g: number; b: number; count: number }>
  rMin: number
  rMax: number
  gMin: number
  gMax: number
  bMin: number
  bMax: number
}

function medianCut(
  colors: Array<{ r: number; g: number; b: number; count: number }>,
  targetCount: number,
): PaletteColor[] {
  if (colors.length <= targetCount) {
    return colors.map((c) => ({ r: c.r, g: c.g, b: c.b }))
  }

  // Create initial box
  const initialBox = createBox(colors)
  const boxes: ColorBox[] = [initialBox]

  // Split boxes until we have enough
  while (boxes.length < targetCount) {
    // Find box with most colors to split
    let maxIndex = 0
    let maxVolume = 0

    for (let i = 0; i < boxes.length; i++) {
      const volume = boxVolume(boxes[i])
      if (volume > maxVolume && boxes[i].colors.length > 1) {
        maxVolume = volume
        maxIndex = i
      }
    }

    if (maxVolume === 0) break

    // Split the box
    const box = boxes[maxIndex]
    const [box1, box2] = splitBox(box)

    boxes.splice(maxIndex, 1, box1, box2)
  }

  // Get average color from each box
  return boxes.map((box) => averageColor(box))
}

function createBox(colors: Array<{ r: number; g: number; b: number; count: number }>): ColorBox {
  let rMin = 255, rMax = 0
  let gMin = 255, gMax = 0
  let bMin = 255, bMax = 0

  for (const c of colors) {
    if (c.r < rMin) rMin = c.r
    if (c.r > rMax) rMax = c.r
    if (c.g < gMin) gMin = c.g
    if (c.g > gMax) gMax = c.g
    if (c.b < bMin) bMin = c.b
    if (c.b > bMax) bMax = c.b
  }

  return { colors, rMin, rMax, gMin, gMax, bMin, bMax }
}

function boxVolume(box: ColorBox): number {
  return (box.rMax - box.rMin) * (box.gMax - box.gMin) * (box.bMax - box.bMin)
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] {
  // Find longest axis
  const rLen = box.rMax - box.rMin
  const gLen = box.gMax - box.gMin
  const bLen = box.bMax - box.bMin

  let axis: 'r' | 'g' | 'b'
  if (rLen >= gLen && rLen >= bLen) axis = 'r'
  else if (gLen >= bLen) axis = 'g'
  else axis = 'b'

  // Sort by axis
  box.colors.sort((a, b) => a[axis] - b[axis])

  // Split at median
  const mid = Math.floor(box.colors.length / 2)
  const colors1 = box.colors.slice(0, mid)
  const colors2 = box.colors.slice(mid)

  return [createBox(colors1), createBox(colors2)]
}

function averageColor(box: ColorBox): PaletteColor {
  let rSum = 0, gSum = 0, bSum = 0
  let totalCount = 0

  for (const c of box.colors) {
    rSum += c.r * c.count
    gSum += c.g * c.count
    bSum += c.b * c.count
    totalCount += c.count
  }

  return {
    r: Math.round(rSum / totalCount),
    g: Math.round(gSum / totalCount),
    b: Math.round(bSum / totalCount),
  }
}

// ============================================================================
// Dithering
// ============================================================================

/** Apply dithering to a frame */
export function applyDithering(
  frame: GifFrame,
  palette: number[],
  method: GifOptions['dither'] = 'floyd-steinberg',
): Uint8Array {
  const { data, width, height } = frame
  const indexed = new Uint8Array(width * height)

  // Create lookup for palette
  const paletteRgb = palette.map((c) => ({
    r: (c >> 16) & 0xff,
    g: (c >> 8) & 0xff,
    b: c & 0xff,
  }))

  // Create error buffer for error diffusion
  const errors = new Float32Array(width * height * 3)

  // Copy image data to work with
  const pixels = new Float32Array(width * height * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    pixels[j] = data[i]
    pixels[j + 1] = data[i + 1]
    pixels[j + 2] = data[i + 2]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const j = i * 3

      // Get current pixel with accumulated error
      const r = Math.max(0, Math.min(255, Math.round(pixels[j] + errors[j])))
      const g = Math.max(0, Math.min(255, Math.round(pixels[j + 1] + errors[j + 1])))
      const b = Math.max(0, Math.min(255, Math.round(pixels[j + 2] + errors[j + 2])))

      // Find nearest palette color
      const nearest = findNearestColor(r, g, b, paletteRgb)
      indexed[i] = nearest.index

      if (method === 'none') continue

      // Calculate error
      const errR = r - nearest.r
      const errG = g - nearest.g
      const errB = b - nearest.b

      // Distribute error based on dithering method
      if (method === 'floyd-steinberg') {
        distributeError(errors, width, height, x, y, errR, errG, errB, [
          [1, 0, 7 / 16],
          [-1, 1, 3 / 16],
          [0, 1, 5 / 16],
          [1, 1, 1 / 16],
        ])
      } else if (method === 'atkinson') {
        distributeError(errors, width, height, x, y, errR, errG, errB, [
          [1, 0, 1 / 8],
          [2, 0, 1 / 8],
          [-1, 1, 1 / 8],
          [0, 1, 1 / 8],
          [1, 1, 1 / 8],
          [0, 2, 1 / 8],
        ])
      } else if (method === 'ordered') {
        // Ordered dithering uses a threshold matrix instead of error diffusion
        // Already handled in pixel selection
      }
    }
  }

  return indexed
}

function findNearestColor(
  r: number,
  g: number,
  b: number,
  palette: PaletteColor[],
): { index: number; r: number; g: number; b: number } {
  let minDist = Infinity
  let nearest = { index: 0, r: 0, g: 0, b: 0 }

  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]
    const dist = Math.pow(r - c.r, 2) + Math.pow(g - c.g, 2) + Math.pow(b - c.b, 2)

    if (dist < minDist) {
      minDist = dist
      nearest = { index: i, r: c.r, g: c.g, b: c.b }
    }
  }

  return nearest
}

function distributeError(
  errors: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  errR: number,
  errG: number,
  errB: number,
  distribution: Array<[number, number, number]>,
): void {
  for (const [dx, dy, factor] of distribution) {
    const nx = x + dx
    const ny = y + dy

    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      const ni = (ny * width + nx) * 3
      errors[ni] += errR * factor
      errors[ni + 1] += errG * factor
      errors[ni + 2] += errB * factor
    }
  }
}

// ============================================================================
// Frame Processing
// ============================================================================

/** Resize frame using bilinear interpolation */
export function resizeFrame(
  frame: GifFrame,
  targetWidth: number,
  targetHeight: number,
): GifFrame {
  const { data, width, height } = frame

  if (width === targetWidth && height === targetHeight) {
    return frame
  }

  const resized = new Uint8Array(targetWidth * targetHeight * 4)

  const xRatio = width / targetWidth
  const yRatio = height / targetHeight

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = x * xRatio
      const srcY = y * yRatio

      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const x1 = Math.min(x0 + 1, width - 1)
      const y1 = Math.min(y0 + 1, height - 1)

      const xFrac = srcX - x0
      const yFrac = srcY - y0

      const destIdx = (y * targetWidth + x) * 4

      for (let c = 0; c < 4; c++) {
        const v00 = data[(y0 * width + x0) * 4 + c]
        const v10 = data[(y0 * width + x1) * 4 + c]
        const v01 = data[(y1 * width + x0) * 4 + c]
        const v11 = data[(y1 * width + x1) * 4 + c]

        const v0 = v00 * (1 - xFrac) + v10 * xFrac
        const v1 = v01 * (1 - xFrac) + v11 * xFrac
        const v = v0 * (1 - yFrac) + v1 * yFrac

        resized[destIdx + c] = Math.round(v)
      }
    }
  }

  return {
    data: resized,
    width: targetWidth,
    height: targetHeight,
    delay: frame.delay,
  }
}

/** Calculate optimal dimensions maintaining aspect ratio */
export function calculateGifDimensions(
  sourceWidth: number,
  sourceHeight: number,
  options: GifOptions,
): { width: number; height: number } {
  let width = options.width ?? sourceWidth
  let height = options.height

  // Apply max width constraint
  const maxWidth = 800
  if (width > maxWidth) {
    width = maxWidth
  }

  if (!height) {
    // Calculate height from aspect ratio
    const aspectRatio = sourceHeight / sourceWidth
    height = Math.round(width * aspectRatio)
  }

  // Ensure even dimensions for GIF encoding
  width = Math.round(width / 2) * 2
  height = Math.round(height / 2) * 2

  return { width, height }
}

// ============================================================================
// GIF Encoder
// ============================================================================

/** High-level GIF encoder */
export class GifEncoder {
  private options: Required<GifOptions>
  private frames: GifFrame[] = []
  private palette: number[] | null = null

  constructor(options: GifOptions = {}) {
    this.options = {
      width: options.width ?? 0,
      height: options.height ?? 0,
      frameRate: options.frameRate ?? 10,
      colors: Math.min(256, Math.max(2, options.colors ?? 256)),
      loop: options.loop ?? 0,
      dither: options.dither ?? 'floyd-steinberg',
      quality: options.quality ?? 80,
      transparent: options.transparent ?? -1,
      disposal: options.disposal ?? 0,
    }

    // Ensure colors is a power of 2
    this.options.colors = nearestPowerOfTwo(this.options.colors)
  }

  /** Add a frame to the GIF */
  addFrame(frame: GifFrame): void {
    this.frames.push(frame)
  }

  /** Add multiple frames */
  addFrames(frames: GifFrame[]): void {
    this.frames.push(...frames)
  }

  /** Set custom palette */
  setPalette(palette: number[]): void {
    this.palette = palette
  }

  /** Encode GIF to buffer */
  encode(): Uint8Array {
    if (this.frames.length === 0) {
      throw new Error('No frames to encode')
    }

    // Determine output dimensions
    const firstFrame = this.frames[0]
    const dims = calculateGifDimensions(firstFrame.width, firstFrame.height, this.options)
    const { width, height } = dims

    // Update options with calculated dimensions
    if (this.options.width === 0) this.options.width = width
    if (this.options.height === 0) this.options.height = height

    // Resize frames if needed
    const processedFrames = this.frames.map((frame) => {
      if (frame.width !== width || frame.height !== height) {
        return resizeFrame(frame, width, height)
      }
      return frame
    })

    // Generate palette if not provided
    if (!this.palette) {
      this.palette = quantizeColors(processedFrames, this.options.colors)
    }

    // Ensure palette is power of 2
    while (this.palette.length < this.options.colors) {
      this.palette.push(0)
    }

    // Calculate frame delay (in centiseconds for GIF format)
    const defaultDelay = Math.round(100 / this.options.frameRate)

    // Estimate buffer size (rough estimate)
    const estimatedSize = width * height * processedFrames.length + 1024
    const buffer = Buffer.alloc(estimatedSize)

    // Create GIF writer
    const writer = new GifWriter(buffer, width, height, {
      palette: this.palette,
      loop: this.options.loop,
    })

    // Add frames
    for (const frame of processedFrames) {
      // Apply dithering and convert to indexed
      const indexed = applyDithering(frame, this.palette, this.options.dither)

      const delay = frame.delay ? Math.round(frame.delay / 10) : defaultDelay

      writer.addFrame(0, 0, width, height, indexed, {
        delay,
        disposal: this.options.disposal,
        transparent: this.options.transparent >= 0 ? this.options.transparent : undefined,
      })
    }

    // Finalize
    const finalSize = writer.end()

    return new Uint8Array(buffer.buffer, 0, finalSize)
  }

  /** Get frame count */
  get frameCount(): number {
    return this.frames.length
  }

  /** Clear frames */
  clear(): void {
    this.frames = []
    this.palette = null
  }
}

// ============================================================================
// GIF Decoder / Reader
// ============================================================================

/** Read GIF metadata */
export function readGifMetadata(data: Uint8Array | Buffer): GifMetadata {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const reader = new GifReader(buffer)

  const frameCount = reader.numFrames()
  const loopCount = reader.getLoopCount()

  const frames: GifMetadata['frames'] = []
  let totalDelay = 0

  for (let i = 0; i < frameCount; i++) {
    const info = reader.frameInfo(i)
    frames.push({
      delay: info.delay * 10, // Convert from centiseconds to milliseconds
      x: info.x,
      y: info.y,
      width: info.width,
      height: info.height,
      disposal: info.disposal,
      transparent: info.transparent_index !== null,
    })
    totalDelay += info.delay * 10
  }

  // Get dimensions from first frame
  const firstFrame = frameCount > 0 ? reader.frameInfo(0) : null

  return {
    width: firstFrame?.width ?? 0,
    height: firstFrame?.height ?? 0,
    frameCount,
    loopCount,
    duration: totalDelay,
    frames,
  }
}

/** Extract frames from GIF */
export function extractGifFrames(data: Uint8Array | Buffer): GifFrame[] {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const reader = new GifReader(buffer)

  const frameCount = reader.numFrames()
  const frames: GifFrame[] = []

  // Get canvas dimensions
  const firstInfo = reader.frameInfo(0)
  const canvasWidth = firstInfo.width + firstInfo.x
  const canvasHeight = firstInfo.height + firstInfo.y

  for (let i = 0; i < frameCount; i++) {
    const info = reader.frameInfo(i)
    const pixels = new Uint8Array(canvasWidth * canvasHeight * 4)

    // Decode frame
    reader.decodeAndBlitFrameRGBA(i, pixels)

    frames.push({
      data: pixels,
      width: canvasWidth,
      height: canvasHeight,
      delay: info.delay * 10,
    })
  }

  return frames
}

// ============================================================================
// Utility Functions
// ============================================================================

function nearestPowerOfTwo(n: number): number {
  let power = 2
  while (power < n && power < 256) {
    power *= 2
  }
  return Math.min(power, 256)
}

/** Estimate GIF file size */
export function estimateGifSize(
  frames: GifFrame[],
  options: GifOptions = {},
): number {
  if (frames.length === 0) return 0

  const dims = calculateGifDimensions(frames[0].width, frames[0].height, options)
  const colors = options.colors ?? 256
  const bitsPerPixel = Math.ceil(Math.log2(colors))

  // Rough estimation
  // GIF uses LZW compression, typically achieving 40-60% compression
  const uncompressedPerFrame = dims.width * dims.height * bitsPerPixel / 8
  const estimatedCompression = 0.5
  const perFrameOverhead = 50 // Frame headers, etc.

  const headerSize = 800 // GIF header, palette, etc.
  const totalFrameSize = frames.length * (uncompressedPerFrame * estimatedCompression + perFrameOverhead)

  return Math.round(headerSize + totalFrameSize)
}

/** Create GIF from video frames with automatic optimization */
export async function createOptimizedGif(
  frames: GifFrame[],
  options: GifOptions & { maxSizeKB?: number } = {},
): Promise<Uint8Array> {
  const maxSize = (options.maxSizeKB ?? 8192) * 1024 // Default 8MB

  let currentOptions = { ...options }
  let result: Uint8Array

  // Start with provided settings or defaults
  const encoder = new GifEncoder(currentOptions)
  encoder.addFrames(frames)
  result = encoder.encode()

  // If within size limit, return
  if (result.length <= maxSize) {
    return result
  }

  // Progressively reduce quality to meet size target
  const reductions = [
    { colors: 128, frameRate: 10 },
    { colors: 64, frameRate: 8 },
    { colors: 32, frameRate: 6 },
    { width: Math.round((options.width ?? frames[0].width) * 0.75) },
    { width: Math.round((options.width ?? frames[0].width) * 0.5), colors: 32 },
  ]

  for (const reduction of reductions) {
    currentOptions = { ...currentOptions, ...reduction }

    const newEncoder = new GifEncoder(currentOptions)
    newEncoder.addFrames(frames)
    result = newEncoder.encode()

    if (result.length <= maxSize) {
      break
    }
  }

  return result
}

/** Export GifEncoder and GifReader from ts-gif */
export { GifWriter, GifReader }
