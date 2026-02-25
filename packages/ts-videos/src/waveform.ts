/**
 * Waveform generation utilities for audio visualization
 * Similar to mediabunny's waveform system
 */

import type { AudioSample } from './types'

/**
 * Waveform data point
 */
export interface WaveformPoint {
  /** Minimum amplitude at this point (-1 to 1) */
  min: number
  /** Maximum amplitude at this point (-1 to 1) */
  max: number
  /** RMS (root mean square) amplitude */
  rms: number
}

/**
 * Waveform generation options
 */
export interface WaveformOptions {
  /** Number of data points to generate */
  points?: number
  /** Channel to analyze (0 = left, 1 = right, -1 = mix all) */
  channel?: number
  /** Normalization mode */
  normalize?: 'peak' | 'rms' | 'none'
  /** Start time in seconds */
  startTime?: number
  /** End time in seconds */
  endTime?: number
}

/**
 * Waveform rendering options
 */
export interface WaveformRenderOptions {
  /** Canvas width */
  width?: number
  /** Canvas height */
  height?: number
  /** Waveform color or gradient */
  color?: string | CanvasGradient
  /** Background color */
  backgroundColor?: string
  /** Draw style */
  style?: 'bars' | 'line' | 'mirror'
  /** Bar width (for bars style) */
  barWidth?: number
  /** Gap between bars (for bars style) */
  barGap?: number
  /** Line width (for line style) */
  lineWidth?: number
  /** Vertical padding ratio (0-0.5) */
  padding?: number
}

/**
 * Waveform result
 */
export interface WaveformResult {
  /** Waveform data points */
  data: WaveformPoint[]
  /** Sample rate of source audio */
  sampleRate: number
  /** Number of channels */
  channels: number
  /** Duration in seconds */
  duration: number
  /** Samples per point */
  samplesPerPoint: number
}

/**
 * WaveformGenerator - Generate waveform data from audio samples
 */
export class WaveformGenerator {
  private samples: Float32Array[] = []
  private sampleRate = 44100
  private channels = 2
  private totalSamples = 0

  /**
   * Add audio samples to the generator
   */
  addSamples(sample: AudioSample): void {
    if (!(sample.data instanceof Float32Array)) {
      throw new Error('Sample data must be Float32Array')
    }

    this.samples.push(sample.data)
    this.sampleRate = sample.sampleRate ?? 44100
    this.channels = sample.channels ?? 2
    this.totalSamples += sample.data.length / this.channels
  }

  /**
   * Add raw audio data
   */
  addRawData(data: Float32Array, channels: number, sampleRate: number): void {
    this.samples.push(data)
    this.sampleRate = sampleRate
    this.channels = channels
    this.totalSamples += data.length / channels
  }

  /**
   * Generate waveform data
   */
  generate(options: WaveformOptions = {}): WaveformResult {
    const {
      points = 800,
      channel = -1,
      normalize = 'peak',
      startTime = 0,
      endTime = this.totalSamples / this.sampleRate,
    } = options

    const startSample = Math.floor(startTime * this.sampleRate)
    const endSample = Math.ceil(endTime * this.sampleRate)
    const sampleRange = endSample - startSample
    const samplesPerPoint = Math.max(1, Math.floor(sampleRange / points))

    const data: WaveformPoint[] = []

    // Flatten all samples into a single array for easier processing
    const flatSamples = this.flattenSamples()

    for (let i = 0; i < points; i++) {
      const pointStart = startSample + i * samplesPerPoint
      const pointEnd = Math.min(pointStart + samplesPerPoint, endSample)

      let min = Infinity
      let max = -Infinity
      let sumSquares = 0
      let count = 0

      for (let s = pointStart; s < pointEnd; s++) {
        let value: number

        if (channel >= 0 && channel < this.channels) {
          // Specific channel
          const sampleIndex = s * this.channels + channel
          value = flatSamples[sampleIndex] ?? 0
        }
        else {
          // Mix all channels
          value = 0
          for (let ch = 0; ch < this.channels; ch++) {
            const sampleIndex = s * this.channels + ch
            value += flatSamples[sampleIndex] ?? 0
          }
          value /= this.channels
        }

        min = Math.min(min, value)
        max = Math.max(max, value)
        sumSquares += value * value
        count++
      }

      const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0

      data.push({
        min: min === Infinity ? 0 : min,
        max: max === -Infinity ? 0 : max,
        rms,
      })
    }

    // Normalize if requested
    if (normalize !== 'none') {
      this.normalizeData(data, normalize)
    }

    return {
      data,
      sampleRate: this.sampleRate,
      channels: this.channels,
      duration: this.totalSamples / this.sampleRate,
      samplesPerPoint,
    }
  }

  /**
   * Generate waveform from async audio sample stream
   */
  async generateFromStream(
    samples: AsyncIterable<AudioSample>,
    options: WaveformOptions = {},
  ): Promise<WaveformResult> {
    for await (const sample of samples) {
      this.addSamples(sample)
    }
    return this.generate(options)
  }

  private flattenSamples(): Float32Array {
    const totalLength = this.samples.reduce((sum, s) => sum + s.length, 0)
    const result = new Float32Array(totalLength)
    let offset = 0

    for (const sample of this.samples) {
      result.set(sample, offset)
      offset += sample.length
    }

    return result
  }

  private normalizeData(data: WaveformPoint[], mode: 'peak' | 'rms'): void {
    let maxValue = 0

    if (mode === 'peak') {
      for (const point of data) {
        maxValue = Math.max(maxValue, Math.abs(point.min), Math.abs(point.max))
      }
    }
    else {
      for (const point of data) {
        maxValue = Math.max(maxValue, point.rms)
      }
    }

    if (maxValue > 0) {
      const scale = 1 / maxValue
      for (const point of data) {
        point.min *= scale
        point.max *= scale
        point.rms *= scale
      }
    }
  }

  /**
   * Clear all samples
   */
  clear(): void {
    this.samples = []
    this.totalSamples = 0
  }
}

/**
 * WaveformRenderer - Render waveform data to canvas
 */
export class WaveformRenderer {
  /**
   * Render waveform to OffscreenCanvas
   */
  render(
    waveform: WaveformResult,
    options: WaveformRenderOptions = {},
  ): OffscreenCanvas {
    const {
      width = 800,
      height = 200,
      color = '#4a9eff',
      backgroundColor = 'transparent',
      style = 'bars',
      barWidth = 2,
      barGap = 1,
      lineWidth = 1,
      padding = 0.1,
    } = options

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    // Background
    if (backgroundColor !== 'transparent') {
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, width, height)
    }

    const centerY = height / 2
    const maxAmplitude = (height / 2) * (1 - padding * 2)

    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth

    switch (style) {
      case 'bars':
        this.renderBars(ctx, waveform.data, width, centerY, maxAmplitude, barWidth, barGap)
        break
      case 'line':
        this.renderLine(ctx, waveform.data, width, centerY, maxAmplitude)
        break
      case 'mirror':
        this.renderMirror(ctx, waveform.data, width, centerY, maxAmplitude, barWidth, barGap)
        break
    }

    return canvas
  }

  /**
   * Render to an existing canvas context
   */
  renderToContext(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    waveform: WaveformResult,
    x: number,
    y: number,
    width: number,
    height: number,
    options: Omit<WaveformRenderOptions, 'width' | 'height'> = {},
  ): void {
    const {
      color = '#4a9eff',
      style = 'bars',
      barWidth = 2,
      barGap = 1,
      lineWidth = 1,
      padding = 0.1,
    } = options

    ctx.save()
    ctx.translate(x, y)

    const centerY = height / 2
    const maxAmplitude = (height / 2) * (1 - padding * 2)

    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth

    switch (style) {
      case 'bars':
        this.renderBars(ctx, waveform.data, width, centerY, maxAmplitude, barWidth, barGap)
        break
      case 'line':
        this.renderLine(ctx, waveform.data, width, centerY, maxAmplitude)
        break
      case 'mirror':
        this.renderMirror(ctx, waveform.data, width, centerY, maxAmplitude, barWidth, barGap)
        break
    }

    ctx.restore()
  }

  private renderBars(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    data: WaveformPoint[],
    width: number,
    centerY: number,
    maxAmplitude: number,
    barWidth: number,
    barGap: number,
  ): void {
    const totalBarWidth = barWidth + barGap
    const visibleBars = Math.floor(width / totalBarWidth)
    const step = Math.max(1, Math.floor(data.length / visibleBars))

    for (let i = 0; i < visibleBars && i * step < data.length; i++) {
      const point = data[Math.floor(i * step)]
      const x = i * totalBarWidth
      const barHeight = Math.max(1, point.rms * maxAmplitude * 2)

      ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight)
    }
  }

  private renderLine(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    data: WaveformPoint[],
    width: number,
    centerY: number,
    maxAmplitude: number,
  ): void {
    if (data.length === 0) return

    const step = width / (data.length - 1 || 1)

    // Draw min-max filled area
    ctx.beginPath()
    ctx.moveTo(0, centerY - data[0].max * maxAmplitude)

    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(i * step, centerY - data[i].max * maxAmplitude)
    }

    for (let i = data.length - 1; i >= 0; i--) {
      ctx.lineTo(i * step, centerY - data[i].min * maxAmplitude)
    }

    ctx.closePath()
    ctx.globalAlpha = 0.3
    ctx.fill()
    ctx.globalAlpha = 1

    // Draw RMS line
    ctx.beginPath()
    ctx.moveTo(0, centerY - data[0].rms * maxAmplitude)
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(i * step, centerY - data[i].rms * maxAmplitude)
    }
    ctx.stroke()
  }

  private renderMirror(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    data: WaveformPoint[],
    width: number,
    centerY: number,
    maxAmplitude: number,
    barWidth: number,
    barGap: number,
  ): void {
    const totalBarWidth = barWidth + barGap
    const visibleBars = Math.floor(width / totalBarWidth)
    const step = Math.max(1, Math.floor(data.length / visibleBars))

    for (let i = 0; i < visibleBars && i * step < data.length; i++) {
      const point = data[Math.floor(i * step)]
      const x = i * totalBarWidth

      // Upper bar (max)
      const upperHeight = Math.max(1, Math.abs(point.max) * maxAmplitude)
      ctx.fillRect(x, centerY - upperHeight, barWidth, upperHeight)

      // Lower bar (min)
      const lowerHeight = Math.max(1, Math.abs(point.min) * maxAmplitude)
      ctx.fillRect(x, centerY, barWidth, lowerHeight)
    }
  }

  /**
   * Export rendered waveform as Blob
   */
  async toBlob(
    waveform: WaveformResult,
    options: WaveformRenderOptions & { format?: 'image/png' | 'image/jpeg' | 'image/webp', quality?: number } = {},
  ): Promise<Blob> {
    const { format = 'image/png', quality = 0.92, ...renderOptions } = options
    const canvas = this.render(waveform, renderOptions)
    return await canvas.convertToBlob({ type: format, quality })
  }
}

/**
 * Peaks data for efficient waveform storage
 */
export interface PeaksData {
  /** Version identifier */
  version: number
  /** Number of channels */
  channels: number
  /** Sample rate */
  sampleRate: number
  /** Samples per pixel/point */
  samplesPerPixel: number
  /** Number of data points */
  length: number
  /** Interleaved min/max data for each channel */
  data: Float32Array
}

/**
 * PeaksExporter - Export waveform data in peaks.js compatible format
 */
export class PeaksExporter {
  /**
   * Export waveform to peaks.js JSON format
   */
  static toJSON(waveform: WaveformResult): object {
    const data: number[] = []

    for (const point of waveform.data) {
      // Scale to 8-bit integer range (-128 to 127)
      data.push(Math.round(point.min * 127))
      data.push(Math.round(point.max * 127))
    }

    return {
      version: 2,
      channels: 1,
      sample_rate: waveform.sampleRate,
      samples_per_pixel: waveform.samplesPerPoint,
      bits: 8,
      length: waveform.data.length,
      data,
    }
  }

  /**
   * Export waveform to binary peaks format
   */
  static toBinary(waveform: WaveformResult): ArrayBuffer {
    // Header: version (4), channels (4), sampleRate (4), samplesPerPixel (4), length (4) = 20 bytes
    // Data: min/max pairs as int8 = length * 2 bytes
    const headerSize = 20
    const dataSize = waveform.data.length * 2
    const buffer = new ArrayBuffer(headerSize + dataSize)
    const view = new DataView(buffer)

    // Header
    view.setUint32(0, 2, true) // version
    view.setUint32(4, 1, true) // channels
    view.setUint32(8, waveform.sampleRate, true)
    view.setUint32(12, waveform.samplesPerPoint, true)
    view.setUint32(16, waveform.data.length, true)

    // Data
    const int8View = new Int8Array(buffer, headerSize)
    for (let i = 0; i < waveform.data.length; i++) {
      const point = waveform.data[i]
      int8View[i * 2] = Math.round(point.min * 127)
      int8View[i * 2 + 1] = Math.round(point.max * 127)
    }

    return buffer
  }

  /**
   * Import from peaks.js JSON format
   */
  static fromJSON(json: {
    version: number
    channels: number
    sample_rate: number
    samples_per_pixel: number
    bits: number
    length: number
    data: number[]
  }): WaveformResult {
    const data: WaveformPoint[] = []
    const scale = json.bits === 8 ? 127 : 32767

    for (let i = 0; i < json.data.length; i += 2) {
      const min = json.data[i] / scale
      const max = json.data[i + 1] / scale
      data.push({
        min,
        max,
        rms: Math.sqrt((min * min + max * max) / 2),
      })
    }

    return {
      data,
      sampleRate: json.sample_rate,
      channels: json.channels,
      duration: (json.length * json.samples_per_pixel) / json.sample_rate,
      samplesPerPoint: json.samples_per_pixel,
    }
  }

  /**
   * Import from binary peaks format
   */
  static fromBinary(buffer: ArrayBuffer): WaveformResult {
    const view = new DataView(buffer)

    const version = view.getUint32(0, true)
    const channels = view.getUint32(4, true)
    const sampleRate = view.getUint32(8, true)
    const samplesPerPixel = view.getUint32(12, true)
    const length = view.getUint32(16, true)

    if (version !== 2) {
      throw new Error(`Unsupported peaks version: ${version}`)
    }

    const data: WaveformPoint[] = []
    const int8View = new Int8Array(buffer, 20)

    for (let i = 0; i < length; i++) {
      const min = int8View[i * 2] / 127
      const max = int8View[i * 2 + 1] / 127
      data.push({
        min,
        max,
        rms: Math.sqrt((min * min + max * max) / 2),
      })
    }

    return {
      data,
      sampleRate,
      channels,
      duration: (length * samplesPerPixel) / sampleRate,
      samplesPerPoint: samplesPerPixel,
    }
  }
}

/**
 * Convenience function to generate waveform from audio samples
 */
export function generateWaveform(
  samples: AudioSample[],
  options: WaveformOptions = {},
): WaveformResult {
  const generator = new WaveformGenerator()

  for (const sample of samples) {
    generator.addSamples(sample)
  }

  return generator.generate(options)
}

/**
 * Convenience function to generate waveform from raw audio data
 */
export function generateWaveformFromRaw(
  data: Float32Array,
  channels: number,
  sampleRate: number,
  options: WaveformOptions = {},
): WaveformResult {
  const generator = new WaveformGenerator()
  generator.addRawData(data, channels, sampleRate)
  return generator.generate(options)
}

/**
 * Convenience function to render waveform to image
 */
export async function renderWaveformToImage(
  waveform: WaveformResult,
  options: WaveformRenderOptions & { format?: 'image/png' | 'image/jpeg' | 'image/webp', quality?: number } = {},
): Promise<Blob> {
  const renderer = new WaveformRenderer()
  return await renderer.toBlob(waveform, options)
}
