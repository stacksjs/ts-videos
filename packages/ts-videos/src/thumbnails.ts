/**
 * Thumbnail and frame extraction utilities
 * Similar to mediabunny's thumbnail generation system
 */

import type { VideoSample, EncodedPacket } from './types'

/**
 * Thumbnail generation options
 */
export interface ThumbnailOptions {
  /** Output width (maintains aspect ratio if height not specified) */
  width?: number
  /** Output height (maintains aspect ratio if width not specified) */
  height?: number
  /** Output format */
  format?: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Quality for lossy formats (0-1) */
  quality?: number
  /** Fit mode when both dimensions specified */
  fit?: 'contain' | 'cover' | 'fill' | 'scale-down'
}

/**
 * Frame extraction options
 */
export interface FrameExtractionOptions {
  /** Extract only keyframes */
  keyframesOnly?: boolean
  /** Maximum number of frames to extract */
  maxFrames?: number
  /** Frame interval in seconds */
  interval?: number
  /** Start time in seconds */
  startTime?: number
  /** End time in seconds */
  endTime?: number
}

/**
 * Sprite sheet options
 */
export interface SpriteSheetOptions {
  /** Number of columns in sprite sheet */
  columns?: number
  /** Individual thumbnail width */
  thumbnailWidth?: number
  /** Individual thumbnail height */
  thumbnailHeight?: number
  /** Gap between thumbnails in pixels */
  gap?: number
  /** Output format */
  format?: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Quality for lossy formats (0-1) */
  quality?: number
}

/**
 * Thumbnail result
 */
export interface ThumbnailResult {
  /** Thumbnail data as Blob or ArrayBuffer */
  data: Blob | ArrayBuffer
  /** Timestamp in seconds */
  timestamp: number
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Format */
  format: string
}

/**
 * Sprite sheet result
 */
export interface SpriteSheetResult {
  /** Sprite sheet image data */
  data: Blob | ArrayBuffer
  /** Total width */
  width: number
  /** Total height */
  height: number
  /** Number of columns */
  columns: number
  /** Number of rows */
  rows: number
  /** Individual thumbnail dimensions */
  thumbnailSize: { width: number; height: number }
  /** Timestamps for each thumbnail (left-to-right, top-to-bottom) */
  timestamps: number[]
  /** Format */
  format: string
}

/**
 * ThumbnailGenerator - Generate thumbnails from video frames
 */
export class ThumbnailGenerator {
  private decoder: VideoDecoder | null = null
  private pendingFrames: VideoFrame[] = []
  private codecConfig: VideoDecoderConfig | null = null

  constructor(config?: VideoDecoderConfig) {
    this.codecConfig = config ?? null
  }

  /**
   * Initialize the decoder
   */
  async init(config?: VideoDecoderConfig): Promise<void> {
    if (config) this.codecConfig = config
    if (!this.codecConfig) {
      throw new Error('VideoDecoderConfig required')
    }

    if (typeof VideoDecoder === 'undefined') {
      throw new Error('WebCodecs VideoDecoder not available')
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.pendingFrames.push(frame)
      },
      error: (e) => {
        console.error('VideoDecoder error:', e)
      },
    })

    this.decoder.configure(this.codecConfig)
  }

  /**
   * Generate a thumbnail from a video frame
   */
  async generateThumbnail(
    frame: VideoFrame,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    const {
      width: targetWidth,
      height: targetHeight,
      format = 'image/png',
      quality = 0.92,
      fit = 'contain',
    } = options

    const sourceWidth = frame.displayWidth
    const sourceHeight = frame.displayHeight
    const aspectRatio = sourceWidth / sourceHeight

    // Calculate output dimensions
    let outputWidth: number
    let outputHeight: number

    if (targetWidth && targetHeight) {
      switch (fit) {
        case 'fill':
          outputWidth = targetWidth
          outputHeight = targetHeight
          break
        case 'cover': {
          const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
          outputWidth = Math.round(sourceWidth * scale)
          outputHeight = Math.round(sourceHeight * scale)
          break
        }
        case 'scale-down':
        case 'contain':
        default: {
          const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
          if (fit === 'scale-down' && scale > 1) {
            outputWidth = sourceWidth
            outputHeight = sourceHeight
          } else {
            outputWidth = Math.round(sourceWidth * scale)
            outputHeight = Math.round(sourceHeight * scale)
          }
          break
        }
      }
    } else if (targetWidth) {
      outputWidth = targetWidth
      outputHeight = Math.round(targetWidth / aspectRatio)
    } else if (targetHeight) {
      outputHeight = targetHeight
      outputWidth = Math.round(targetHeight * aspectRatio)
    } else {
      outputWidth = sourceWidth
      outputHeight = sourceHeight
    }

    // Create canvas and draw frame
    const canvas = new OffscreenCanvas(outputWidth, outputHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    // Draw with proper scaling
    if (fit === 'cover' && targetWidth && targetHeight) {
      // Center crop for cover mode
      const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      const scaledWidth = sourceWidth * scale
      const scaledHeight = sourceHeight * scale
      const offsetX = (targetWidth - scaledWidth) / 2
      const offsetY = (targetHeight - scaledHeight) / 2

      canvas.width = targetWidth
      canvas.height = targetHeight
      ctx.drawImage(frame, offsetX, offsetY, scaledWidth, scaledHeight)
    } else {
      ctx.drawImage(frame, 0, 0, outputWidth, outputHeight)
    }

    // Convert to blob
    const blob = await canvas.convertToBlob({ type: format, quality })

    return {
      data: blob,
      timestamp: frame.timestamp / 1_000_000,
      width: outputWidth,
      height: outputHeight,
      format,
    }
  }

  /**
   * Generate thumbnail from encoded packet
   */
  async generateFromPacket(
    packet: EncodedPacket,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult | null> {
    if (!this.decoder) {
      throw new Error('Decoder not initialized')
    }

    const chunk = new EncodedVideoChunk({
      type: packet.isKeyframe ? 'key' : 'delta',
      timestamp: packet.timestamp * 1_000_000,
      data: packet.data,
    })

    this.decoder.decode(chunk)
    await this.decoder.flush()

    if (this.pendingFrames.length === 0) {
      return null
    }

    const frame = this.pendingFrames.shift()!
    const result = await this.generateThumbnail(frame, options)
    frame.close()

    // Close remaining frames
    for (const f of this.pendingFrames) {
      f.close()
    }
    this.pendingFrames = []

    return result
  }

  /**
   * Generate thumbnail from video sample
   */
  async generateFromSample(
    sample: VideoSample,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    if (!(sample.data instanceof VideoFrame)) {
      throw new Error('Sample data must be VideoFrame')
    }

    const result = await this.generateThumbnail(sample.data, options)
    return result
  }

  /**
   * Extract frames at specific timestamps
   */
  async *extractFrames(
    packets: AsyncIterable<EncodedPacket>,
    timestamps: number[],
    options: ThumbnailOptions = {},
  ): AsyncGenerator<ThumbnailResult> {
    if (!this.decoder) {
      throw new Error('Decoder not initialized')
    }

    const sortedTimestamps = [...timestamps].sort((a, b) => a - b)
    let timestampIndex = 0

    for await (const packet of packets) {
      if (timestampIndex >= sortedTimestamps.length) break

      const chunk = new EncodedVideoChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.timestamp * 1_000_000,
        data: packet.data,
      })

      this.decoder.decode(chunk)
      await this.decoder.flush()

      for (const frame of this.pendingFrames) {
        const frameTimestamp = frame.timestamp / 1_000_000
        const targetTimestamp = sortedTimestamps[timestampIndex]

        if (Math.abs(frameTimestamp - targetTimestamp) < 0.05) {
          yield await this.generateThumbnail(frame, options)
          timestampIndex++
        }
        frame.close()
      }
      this.pendingFrames = []
    }
  }

  /**
   * Extract frames at regular intervals
   */
  async *extractFramesAtInterval(
    packets: AsyncIterable<EncodedPacket>,
    options: FrameExtractionOptions & ThumbnailOptions = {},
  ): AsyncGenerator<ThumbnailResult> {
    if (!this.decoder) {
      throw new Error('Decoder not initialized')
    }

    const {
      interval = 1,
      startTime = 0,
      endTime = Infinity,
      maxFrames = Infinity,
      keyframesOnly = false,
    } = options

    let frameCount = 0
    let lastExtractedTime = startTime - interval

    for await (const packet of packets) {
      if (frameCount >= maxFrames) break
      if (packet.timestamp < startTime) continue
      if (packet.timestamp > endTime) break

      if (keyframesOnly && !packet.isKeyframe) continue

      // Check if enough time has passed
      if (packet.timestamp - lastExtractedTime < interval) continue

      const chunk = new EncodedVideoChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.timestamp * 1_000_000,
        data: packet.data,
      })

      this.decoder.decode(chunk)
      await this.decoder.flush()

      for (const frame of this.pendingFrames) {
        const frameTimestamp = frame.timestamp / 1_000_000

        if (frameTimestamp - lastExtractedTime >= interval) {
          yield await this.generateThumbnail(frame, options)
          lastExtractedTime = frameTimestamp
          frameCount++
        }
        frame.close()
      }
      this.pendingFrames = []
    }
  }

  /**
   * Close and release resources
   */
  close(): void {
    if (this.decoder) {
      this.decoder.close()
      this.decoder = null
    }
    for (const frame of this.pendingFrames) {
      frame.close()
    }
    this.pendingFrames = []
  }
}

/**
 * SpriteSheetGenerator - Generate sprite sheets from video frames
 */
export class SpriteSheetGenerator {
  private thumbnailGenerator: ThumbnailGenerator

  constructor(config?: VideoDecoderConfig) {
    this.thumbnailGenerator = new ThumbnailGenerator(config)
  }

  async init(config?: VideoDecoderConfig): Promise<void> {
    await this.thumbnailGenerator.init(config)
  }

  /**
   * Generate a sprite sheet from video packets
   */
  async generate(
    packets: AsyncIterable<EncodedPacket>,
    frameCount: number,
    options: SpriteSheetOptions = {},
  ): Promise<SpriteSheetResult> {
    const {
      columns = Math.ceil(Math.sqrt(frameCount)),
      thumbnailWidth = 160,
      thumbnailHeight = 90,
      gap = 0,
      format = 'image/jpeg',
      quality = 0.8,
    } = options

    const rows = Math.ceil(frameCount / columns)
    const spriteWidth = columns * thumbnailWidth + (columns - 1) * gap
    const spriteHeight = rows * thumbnailHeight + (rows - 1) * gap

    const canvas = new OffscreenCanvas(spriteWidth, spriteHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    // Fill with black background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, spriteWidth, spriteHeight)

    const timestamps: number[] = []
    let thumbnailIndex = 0

    // Calculate interval based on desired frame count
    // This is a simplified approach - in practice, you'd want to know the video duration first
    const thumbnailOptions: ThumbnailOptions = {
      width: thumbnailWidth,
      height: thumbnailHeight,
      format: 'image/png',
      fit: 'contain',
    }

    for await (const result of this.thumbnailGenerator.extractFramesAtInterval(packets, {
      maxFrames: frameCount,
      ...thumbnailOptions,
    })) {
      const col = thumbnailIndex % columns
      const row = Math.floor(thumbnailIndex / columns)
      const x = col * (thumbnailWidth + gap)
      const y = row * (thumbnailHeight + gap)

      // Draw thumbnail onto sprite sheet
      const blob = result.data as Blob
      const bitmap = await createImageBitmap(blob)
      ctx.drawImage(bitmap, x, y, thumbnailWidth, thumbnailHeight)
      bitmap.close()

      timestamps.push(result.timestamp)
      thumbnailIndex++

      if (thumbnailIndex >= frameCount) break
    }

    const spriteBlob = await canvas.convertToBlob({ type: format, quality })

    return {
      data: spriteBlob,
      width: spriteWidth,
      height: spriteHeight,
      columns,
      rows,
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
      timestamps,
      format,
    }
  }

  /**
   * Generate sprite sheet at specific timestamps
   */
  async generateAtTimestamps(
    packets: AsyncIterable<EncodedPacket>,
    timestamps: number[],
    options: SpriteSheetOptions = {},
  ): Promise<SpriteSheetResult> {
    const {
      columns = Math.ceil(Math.sqrt(timestamps.length)),
      thumbnailWidth = 160,
      thumbnailHeight = 90,
      gap = 0,
      format = 'image/jpeg',
      quality = 0.8,
    } = options

    const rows = Math.ceil(timestamps.length / columns)
    const spriteWidth = columns * thumbnailWidth + (columns - 1) * gap
    const spriteHeight = rows * thumbnailHeight + (rows - 1) * gap

    const canvas = new OffscreenCanvas(spriteWidth, spriteHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, spriteWidth, spriteHeight)

    const resultTimestamps: number[] = []
    let thumbnailIndex = 0

    const thumbnailOptions: ThumbnailOptions = {
      width: thumbnailWidth,
      height: thumbnailHeight,
      format: 'image/png',
      fit: 'contain',
    }

    for await (const result of this.thumbnailGenerator.extractFrames(
      packets,
      timestamps,
      thumbnailOptions,
    )) {
      const col = thumbnailIndex % columns
      const row = Math.floor(thumbnailIndex / columns)
      const x = col * (thumbnailWidth + gap)
      const y = row * (thumbnailHeight + gap)

      const blob = result.data as Blob
      const bitmap = await createImageBitmap(blob)
      ctx.drawImage(bitmap, x, y, thumbnailWidth, thumbnailHeight)
      bitmap.close()

      resultTimestamps.push(result.timestamp)
      thumbnailIndex++
    }

    const spriteBlob = await canvas.convertToBlob({ type: format, quality })

    return {
      data: spriteBlob,
      width: spriteWidth,
      height: spriteHeight,
      columns,
      rows,
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
      timestamps: resultTimestamps,
      format,
    }
  }

  close(): void {
    this.thumbnailGenerator.close()
  }
}

/**
 * Convenience function to generate a single thumbnail at timestamp
 */
export async function generateThumbnailAt(
  packets: AsyncIterable<EncodedPacket>,
  timestamp: number,
  config: VideoDecoderConfig,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult | null> {
  const generator = new ThumbnailGenerator(config)
  await generator.init()

  try {
    for await (const result of generator.extractFrames(packets, [timestamp], options)) {
      return result
    }
    return null
  } finally {
    generator.close()
  }
}

/**
 * Convenience function to generate thumbnails at regular intervals
 */
export async function generateThumbnails(
  packets: AsyncIterable<EncodedPacket>,
  config: VideoDecoderConfig,
  options: FrameExtractionOptions & ThumbnailOptions = {},
): Promise<ThumbnailResult[]> {
  const generator = new ThumbnailGenerator(config)
  await generator.init()

  const results: ThumbnailResult[] = []
  try {
    for await (const result of generator.extractFramesAtInterval(packets, options)) {
      results.push(result)
    }
    return results
  } finally {
    generator.close()
  }
}

/**
 * Convenience function to generate a sprite sheet
 */
export async function generateSpriteSheet(
  packets: AsyncIterable<EncodedPacket>,
  frameCount: number,
  config: VideoDecoderConfig,
  options: SpriteSheetOptions = {},
): Promise<SpriteSheetResult> {
  const generator = new SpriteSheetGenerator(config)
  await generator.init()

  try {
    return await generator.generate(packets, frameCount, options)
  } finally {
    generator.close()
  }
}
