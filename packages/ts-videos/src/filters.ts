/**
 * Video filters for frame processing
 * Provides scale, crop, rotate, overlay, and color adjustment filters
 */

/**
 * Filter that processes video frames
 */
export interface VideoFilter {
  /** Filter name */
  name: string
  /** Process a frame */
  process(frame: VideoFrame, canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D): Promise<void>
  /** Get output dimensions */
  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number }
}

/**
 * Scale filter options
 */
export interface ScaleOptions {
  /** Target width (-1 for auto based on height) */
  width?: number
  /** Target height (-1 for auto based on width) */
  height?: number
  /** Scale algorithm */
  algorithm?: 'pixelated' | 'smooth'
  /** Fit mode */
  fit?: 'fill' | 'contain' | 'cover' | 'scale-down'
}

/**
 * Scale filter - resize video frames
 */
export class ScaleFilter implements VideoFilter {
  name = 'scale'
  private options: Required<ScaleOptions>
  private outputWidth = 0
  private outputHeight = 0

  constructor(options: ScaleOptions) {
    this.options = {
      width: options.width ?? -1,
      height: options.height ?? -1,
      algorithm: options.algorithm ?? 'smooth',
      fit: options.fit ?? 'fill',
    }
  }

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    let { width, height } = this.options
    const aspectRatio = inputWidth / inputHeight

    if (width === -1 && height === -1) {
      return { width: inputWidth, height: inputHeight }
    }

    if (width === -1) {
      width = Math.round(height * aspectRatio)
    }
    else if (height === -1) {
      height = Math.round(width / aspectRatio)
    }

    if (this.options.fit === 'contain' || this.options.fit === 'scale-down') {
      const scale = Math.min(width / inputWidth, height / inputHeight)
      if (this.options.fit === 'scale-down' && scale > 1) {
        return { width: inputWidth, height: inputHeight }
      }
      width = Math.round(inputWidth * scale)
      height = Math.round(inputHeight * scale)
    }
    else if (this.options.fit === 'cover') {
      const scale = Math.max(width / inputWidth, height / inputHeight)
      width = Math.round(inputWidth * scale)
      height = Math.round(inputHeight * scale)
    }

    this.outputWidth = width
    this.outputHeight = height
    return { width, height }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    const { width, height } = this.getOutputDimensions(frame.displayWidth, frame.displayHeight)

    canvas.width = width
    canvas.height = height

    ctx.imageSmoothingEnabled = this.options.algorithm === 'smooth'
    ctx.imageSmoothingQuality = 'high'

    ctx.drawImage(frame, 0, 0, width, height)
  }
}

/**
 * Crop filter options
 */
export interface CropOptions {
  /** X offset */
  x: number
  /** Y offset */
  y: number
  /** Crop width */
  width: number
  /** Crop height */
  height: number
}

/**
 * Crop filter - extract a region from frames
 */
export class CropFilter implements VideoFilter {
  name = 'crop'

  constructor(private options: CropOptions) {}

  getOutputDimensions(): { width: number; height: number } {
    return { width: this.options.width, height: this.options.height }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    const { x, y, width, height } = this.options

    canvas.width = width
    canvas.height = height

    ctx.drawImage(
      frame,
      x, y, width, height,  // Source rectangle
      0, 0, width, height,  // Destination rectangle
    )
  }
}

/**
 * Rotate filter options
 */
export interface RotateOptions {
  /** Rotation angle in degrees */
  angle: number
  /** Fill color for empty areas */
  fillColor?: string
  /** Auto-resize to fit rotated content */
  autoResize?: boolean
}

/**
 * Rotate filter - rotate frames
 */
export class RotateFilter implements VideoFilter {
  name = 'rotate'
  private options: Required<RotateOptions>

  constructor(options: RotateOptions) {
    this.options = {
      angle: options.angle,
      fillColor: options.fillColor ?? 'transparent',
      autoResize: options.autoResize ?? true,
    }
  }

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    if (!this.options.autoResize) {
      return { width: inputWidth, height: inputHeight }
    }

    const radians = (this.options.angle * Math.PI) / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))

    const width = Math.ceil(inputWidth * cos + inputHeight * sin)
    const height = Math.ceil(inputWidth * sin + inputHeight * cos)

    return { width, height }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    const { width, height } = this.getOutputDimensions(frame.displayWidth, frame.displayHeight)
    const radians = (this.options.angle * Math.PI) / 180

    canvas.width = width
    canvas.height = height

    // Fill background
    if (this.options.fillColor !== 'transparent') {
      ctx.fillStyle = this.options.fillColor
      ctx.fillRect(0, 0, width, height)
    }

    // Rotate around center
    ctx.translate(width / 2, height / 2)
    ctx.rotate(radians)
    ctx.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2)
  }
}

/**
 * Flip filter options
 */
export interface FlipOptions {
  /** Flip horizontally */
  horizontal?: boolean
  /** Flip vertically */
  vertical?: boolean
}

/**
 * Flip filter - mirror frames
 */
export class FlipFilter implements VideoFilter {
  name = 'flip'

  constructor(private options: FlipOptions) {}

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    return { width: inputWidth, height: inputHeight }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    const width = frame.displayWidth
    const height = frame.displayHeight

    canvas.width = width
    canvas.height = height

    ctx.save()

    if (this.options.horizontal && this.options.vertical) {
      ctx.scale(-1, -1)
      ctx.drawImage(frame, -width, -height)
    }
    else if (this.options.horizontal) {
      ctx.scale(-1, 1)
      ctx.drawImage(frame, -width, 0)
    }
    else if (this.options.vertical) {
      ctx.scale(1, -1)
      ctx.drawImage(frame, 0, -height)
    }
    else {
      ctx.drawImage(frame, 0, 0)
    }

    ctx.restore()
  }
}

/**
 * Color adjustment options
 */
export interface ColorAdjustOptions {
  /** Brightness adjustment (-1 to 1) */
  brightness?: number
  /** Contrast adjustment (-1 to 1) */
  contrast?: number
  /** Saturation adjustment (-1 to 1) */
  saturation?: number
  /** Hue rotation in degrees */
  hueRotate?: number
  /** Grayscale amount (0 to 1) */
  grayscale?: number
  /** Sepia amount (0 to 1) */
  sepia?: number
  /** Invert amount (0 to 1) */
  invert?: number
  /** Opacity (0 to 1) */
  opacity?: number
}

/**
 * Color adjustment filter
 */
export class ColorAdjustFilter implements VideoFilter {
  name = 'colorAdjust'

  constructor(private options: ColorAdjustOptions) {}

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    return { width: inputWidth, height: inputHeight }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    const width = frame.displayWidth
    const height = frame.displayHeight

    canvas.width = width
    canvas.height = height

    // Build filter string
    const filters: string[] = []

    if (this.options.brightness !== undefined && this.options.brightness !== 0) {
      filters.push(`brightness(${1 + this.options.brightness})`)
    }
    if (this.options.contrast !== undefined && this.options.contrast !== 0) {
      filters.push(`contrast(${1 + this.options.contrast})`)
    }
    if (this.options.saturation !== undefined && this.options.saturation !== 0) {
      filters.push(`saturate(${1 + this.options.saturation})`)
    }
    if (this.options.hueRotate !== undefined && this.options.hueRotate !== 0) {
      filters.push(`hue-rotate(${this.options.hueRotate}deg)`)
    }
    if (this.options.grayscale !== undefined && this.options.grayscale > 0) {
      filters.push(`grayscale(${this.options.grayscale})`)
    }
    if (this.options.sepia !== undefined && this.options.sepia > 0) {
      filters.push(`sepia(${this.options.sepia})`)
    }
    if (this.options.invert !== undefined && this.options.invert > 0) {
      filters.push(`invert(${this.options.invert})`)
    }
    if (this.options.opacity !== undefined && this.options.opacity < 1) {
      filters.push(`opacity(${this.options.opacity})`)
    }

    ctx.filter = filters.length > 0 ? filters.join(' ') : 'none'
    ctx.drawImage(frame, 0, 0)
    ctx.filter = 'none'
  }
}

/**
 * Blur filter options
 */
export interface BlurOptions {
  /** Blur radius in pixels */
  radius: number
}

/**
 * Blur filter
 */
export class BlurFilter implements VideoFilter {
  name = 'blur'

  constructor(private options: BlurOptions) {}

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    return { width: inputWidth, height: inputHeight }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    canvas.width = frame.displayWidth
    canvas.height = frame.displayHeight

    ctx.filter = `blur(${this.options.radius}px)`
    ctx.drawImage(frame, 0, 0)
    ctx.filter = 'none'
  }
}

/**
 * Overlay filter options
 */
export interface OverlayOptions {
  /** Overlay image or canvas */
  overlay: ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLImageElement
  /** X position */
  x: number
  /** Y position */
  y: number
  /** Overlay width (optional, uses natural size if not specified) */
  width?: number
  /** Overlay height (optional) */
  height?: number
  /** Opacity (0 to 1) */
  opacity?: number
  /** Blend mode */
  blendMode?: GlobalCompositeOperation
}

/**
 * Overlay filter - composite images/watermarks
 */
export class OverlayFilter implements VideoFilter {
  name = 'overlay'

  constructor(private options: OverlayOptions) {}

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    return { width: inputWidth, height: inputHeight }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    canvas.width = frame.displayWidth
    canvas.height = frame.displayHeight

    // Draw base frame
    ctx.drawImage(frame, 0, 0)

    // Apply overlay
    ctx.save()

    if (this.options.opacity !== undefined && this.options.opacity < 1) {
      ctx.globalAlpha = this.options.opacity
    }

    if (this.options.blendMode) {
      ctx.globalCompositeOperation = this.options.blendMode
    }

    const width = this.options.width ?? this.getOverlayWidth()
    const height = this.options.height ?? this.getOverlayHeight()

    ctx.drawImage(
      this.options.overlay,
      this.options.x,
      this.options.y,
      width,
      height,
    )

    ctx.restore()
  }

  private getOverlayWidth(): number {
    const overlay = this.options.overlay
    if (overlay instanceof ImageBitmap) return overlay.width
    if (overlay instanceof OffscreenCanvas) return overlay.width
    if (overlay instanceof HTMLCanvasElement) return overlay.width
    if (overlay instanceof HTMLImageElement) return overlay.naturalWidth
    return 0
  }

  private getOverlayHeight(): number {
    const overlay = this.options.overlay
    if (overlay instanceof ImageBitmap) return overlay.height
    if (overlay instanceof OffscreenCanvas) return overlay.height
    if (overlay instanceof HTMLCanvasElement) return overlay.height
    if (overlay instanceof HTMLImageElement) return overlay.naturalHeight
    return 0
  }
}

/**
 * Text overlay options
 */
export interface TextOverlayOptions {
  /** Text to render */
  text: string
  /** X position */
  x: number
  /** Y position */
  y: number
  /** Font (CSS font string) */
  font?: string
  /** Text color */
  color?: string
  /** Text alignment */
  align?: CanvasTextAlign
  /** Text baseline */
  baseline?: CanvasTextBaseline
  /** Stroke color (for outline) */
  strokeColor?: string
  /** Stroke width */
  strokeWidth?: number
  /** Shadow color */
  shadowColor?: string
  /** Shadow blur */
  shadowBlur?: number
  /** Shadow offset X */
  shadowOffsetX?: number
  /** Shadow offset Y */
  shadowOffsetY?: number
  /** Background color */
  backgroundColor?: string
  /** Background padding */
  backgroundPadding?: number
}

/**
 * Text overlay filter - add text to frames
 */
export class TextOverlayFilter implements VideoFilter {
  name = 'textOverlay'
  private options: TextOverlayOptions

  constructor(options: TextOverlayOptions) {
    this.options = {
      font: '24px sans-serif',
      color: 'white',
      align: 'left',
      baseline: 'top',
      ...options,
    }
  }

  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    return { width: inputWidth, height: inputHeight }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    canvas.width = frame.displayWidth
    canvas.height = frame.displayHeight

    // Draw base frame
    ctx.drawImage(frame, 0, 0)

    // Setup text style
    ctx.font = this.options.font!
    ctx.textAlign = this.options.align!
    ctx.textBaseline = this.options.baseline!

    // Background
    if (this.options.backgroundColor) {
      const metrics = ctx.measureText(this.options.text)
      const padding = this.options.backgroundPadding ?? 4

      ctx.fillStyle = this.options.backgroundColor
      ctx.fillRect(
        this.options.x - padding,
        this.options.y - padding,
        metrics.width + padding * 2,
        parseInt(this.options.font!) + padding * 2,
      )
    }

    // Shadow
    if (this.options.shadowColor) {
      ctx.shadowColor = this.options.shadowColor
      ctx.shadowBlur = this.options.shadowBlur ?? 0
      ctx.shadowOffsetX = this.options.shadowOffsetX ?? 0
      ctx.shadowOffsetY = this.options.shadowOffsetY ?? 0
    }

    // Stroke
    if (this.options.strokeColor && this.options.strokeWidth) {
      ctx.strokeStyle = this.options.strokeColor
      ctx.lineWidth = this.options.strokeWidth
      ctx.strokeText(this.options.text, this.options.x, this.options.y)
    }

    // Fill
    ctx.fillStyle = this.options.color!
    ctx.fillText(this.options.text, this.options.x, this.options.y)

    // Reset shadow
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }
}

/**
 * Pad filter options
 */
export interface PadOptions {
  /** Total width */
  width: number
  /** Total height */
  height: number
  /** X offset for input */
  x?: number
  /** Y offset for input */
  y?: number
  /** Padding color */
  color?: string
}

/**
 * Pad filter - add letterbox/pillarbox
 */
export class PadFilter implements VideoFilter {
  name = 'pad'

  constructor(private options: PadOptions) {}

  getOutputDimensions(): { width: number; height: number } {
    return { width: this.options.width, height: this.options.height }
  }

  async process(
    frame: VideoFrame,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    canvas.width = this.options.width
    canvas.height = this.options.height

    // Fill background
    ctx.fillStyle = this.options.color ?? 'black'
    ctx.fillRect(0, 0, this.options.width, this.options.height)

    // Calculate position (center if not specified)
    const x = this.options.x ?? (this.options.width - frame.displayWidth) / 2
    const y = this.options.y ?? (this.options.height - frame.displayHeight) / 2

    ctx.drawImage(frame, x, y)
  }
}

/**
 * Filter chain - apply multiple filters in sequence
 */
export class FilterChain {
  private filters: VideoFilter[] = []
  private canvas: OffscreenCanvas | null = null
  private ctx: OffscreenCanvasRenderingContext2D | null = null
  private tempCanvas: OffscreenCanvas | null = null
  private tempCtx: OffscreenCanvasRenderingContext2D | null = null

  /**
   * Add a filter to the chain
   */
  add(filter: VideoFilter): this {
    this.filters.push(filter)
    return this
  }

  /**
   * Process a frame through all filters
   */
  async process(frame: VideoFrame): Promise<VideoFrame> {
    if (this.filters.length === 0) {
      return frame
    }

    // Calculate final dimensions
    let width = frame.displayWidth
    let height = frame.displayHeight

    for (const filter of this.filters) {
      const dims = filter.getOutputDimensions(width, height)
      width = dims.width
      height = dims.height
    }

    // Initialize canvases
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas = new OffscreenCanvas(width, height)
      this.ctx = this.canvas.getContext('2d')!
      this.tempCanvas = new OffscreenCanvas(width, height)
      this.tempCtx = this.tempCanvas.getContext('2d')!
    }

    // Process through filters
    let currentInput: VideoFrame | OffscreenCanvas = frame
    let currentWidth = frame.displayWidth
    let currentHeight = frame.displayHeight

    for (let i = 0; i < this.filters.length; i++) {
      const filter = this.filters[i]
      const dims = filter.getOutputDimensions(currentWidth, currentHeight)

      // Use alternating canvases for intermediate results
      const outputCanvas = i % 2 === 0 ? this.canvas! : this.tempCanvas!
      const outputCtx = i % 2 === 0 ? this.ctx! : this.tempCtx!

      outputCanvas.width = dims.width
      outputCanvas.height = dims.height

      if (currentInput instanceof VideoFrame) {
        await filter.process(currentInput, outputCanvas, outputCtx)
      }
      else {
        // Create temporary VideoFrame from canvas
        const tempFrame = new VideoFrame(currentInput, {
          timestamp: frame.timestamp,
        })
        await filter.process(tempFrame, outputCanvas, outputCtx)
        tempFrame.close()
      }

      currentInput = outputCanvas
      currentWidth = dims.width
      currentHeight = dims.height
    }

    // Create output VideoFrame
    const finalCanvas = this.filters.length % 2 === 1 ? this.canvas! : this.tempCanvas!
    const outputFrame = new VideoFrame(finalCanvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
    })

    return outputFrame
  }

  /**
   * Get output dimensions for given input
   */
  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    let width = inputWidth
    let height = inputHeight

    for (const filter of this.filters) {
      const dims = filter.getOutputDimensions(width, height)
      width = dims.width
      height = dims.height
    }

    return { width, height }
  }

  /**
   * Clear all filters
   */
  clear(): void {
    this.filters = []
  }
}

/**
 * Convenience functions for creating filters
 */
export const Filters = {
  scale: (options: ScaleOptions) => new ScaleFilter(options),
  crop: (options: CropOptions) => new CropFilter(options),
  rotate: (options: RotateOptions) => new RotateFilter(options),
  flip: (options: FlipOptions) => new FlipFilter(options),
  colorAdjust: (options: ColorAdjustOptions) => new ColorAdjustFilter(options),
  blur: (options: BlurOptions) => new BlurFilter(options),
  overlay: (options: OverlayOptions) => new OverlayFilter(options),
  textOverlay: (options: TextOverlayOptions) => new TextOverlayFilter(options),
  pad: (options: PadOptions) => new PadFilter(options),

  // Common presets
  grayscale: () => new ColorAdjustFilter({ grayscale: 1 }),
  sepia: () => new ColorAdjustFilter({ sepia: 1 }),
  invert: () => new ColorAdjustFilter({ invert: 1 }),
  flipH: () => new FlipFilter({ horizontal: true }),
  flipV: () => new FlipFilter({ vertical: true }),
  rotate90: () => new RotateFilter({ angle: 90 }),
  rotate180: () => new RotateFilter({ angle: 180 }),
  rotate270: () => new RotateFilter({ angle: 270 }),
}
