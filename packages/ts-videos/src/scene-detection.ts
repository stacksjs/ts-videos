/**
 * Scene detection for video analysis
 * Detects cuts, fades, and dissolves using various algorithms
 */

// ============================================================================
// Types
// ============================================================================

/** Scene change type */
export type SceneChangeType = 'cut' | 'fade-in' | 'fade-out' | 'dissolve' | 'unknown'

/** Detected scene change */
export interface SceneChange {
  /** Frame number where scene change occurs */
  frameNumber: number
  /** Timestamp in milliseconds */
  timestamp: number
  /** Type of scene change */
  type: SceneChangeType
  /** Confidence score (0-1) */
  confidence: number
  /** Difference score that triggered detection */
  score: number
}

/** Scene segment */
export interface SceneSegment {
  /** Start frame number */
  startFrame: number
  /** End frame number */
  endFrame: number
  /** Start timestamp in milliseconds */
  startTime: number
  /** End timestamp in milliseconds */
  endTime: number
  /** Duration in milliseconds */
  duration: number
  /** Number of frames */
  frameCount: number
  /** Average brightness */
  avgBrightness?: number
  /** Dominant color */
  dominantColor?: [number, number, number]
}

/** Scene detection options */
export interface SceneDetectionOptions {
  /** Detection method */
  method?: 'histogram' | 'content' | 'threshold' | 'adaptive'
  /** Threshold for cut detection (0-1) */
  threshold?: number
  /** Minimum scene length in frames */
  minSceneLength?: number
  /** Detect fade transitions */
  detectFades?: boolean
  /** Frame rate for timestamp calculation */
  frameRate?: number
  /** Window size for adaptive threshold */
  adaptiveWindow?: number
}

/** Frame data for analysis */
export interface FrameData {
  /** Frame number */
  frameNumber: number
  /** RGBA pixel data */
  data: Uint8Array | Uint8ClampedArray
  /** Frame width */
  width: number
  /** Frame height */
  height: number
}

// ============================================================================
// Histogram-Based Detection
// ============================================================================

/** Calculate color histogram for a frame */
export function calculateHistogram(frame: FrameData, bins: number = 64): {
  r: number[]
  g: number[]
  b: number[]
  luma: number[]
} {
  const { data, width, height } = frame
  const pixelCount = width * height

  const r = new Array(bins).fill(0)
  const g = new Array(bins).fill(0)
  const b = new Array(bins).fill(0)
  const luma = new Array(bins).fill(0)

  const binSize = 256 / bins

  for (let i = 0; i < data.length; i += 4) {
    const red = data[i]
    const green = data[i + 1]
    const blue = data[i + 2]

    r[Math.floor(red / binSize)]++
    g[Math.floor(green / binSize)]++
    b[Math.floor(blue / binSize)]++

    // BT.601 luma
    const y = 0.299 * red + 0.587 * green + 0.114 * blue
    luma[Math.floor(y / binSize)]++
  }

  // Normalize
  for (let i = 0; i < bins; i++) {
    r[i] /= pixelCount
    g[i] /= pixelCount
    b[i] /= pixelCount
    luma[i] /= pixelCount
  }

  return { r, g, b, luma }
}

/** Calculate histogram difference between two frames */
export function calculateHistogramDifference(
  hist1: { r: number[]; g: number[]; b: number[]; luma: number[] },
  hist2: { r: number[]; g: number[]; b: number[]; luma: number[] },
  method: 'chi-square' | 'correlation' | 'intersection' | 'bhattacharyya' = 'correlation',
): number {
  const bins = hist1.r.length

  switch (method) {
    case 'chi-square': {
      let sum = 0
      for (let i = 0; i < bins; i++) {
        const h1 = hist1.luma[i]
        const h2 = hist2.luma[i]
        if (h1 + h2 > 0) {
          sum += Math.pow(h1 - h2, 2) / (h1 + h2)
        }
      }
      return sum / 2
    }

    case 'correlation': {
      let sum1 = 0, sum2 = 0, sumProd = 0, sumSq1 = 0, sumSq2 = 0

      for (let i = 0; i < bins; i++) {
        sum1 += hist1.luma[i]
        sum2 += hist2.luma[i]
      }

      const mean1 = sum1 / bins
      const mean2 = sum2 / bins

      for (let i = 0; i < bins; i++) {
        const d1 = hist1.luma[i] - mean1
        const d2 = hist2.luma[i] - mean2
        sumProd += d1 * d2
        sumSq1 += d1 * d1
        sumSq2 += d2 * d2
      }

      const denom = Math.sqrt(sumSq1 * sumSq2)
      if (denom === 0) return 0
      // Return 1 - correlation so higher = more different
      return 1 - (sumProd / denom)
    }

    case 'intersection': {
      let sum = 0
      for (let i = 0; i < bins; i++) {
        sum += Math.min(hist1.luma[i], hist2.luma[i])
      }
      // Return 1 - intersection so higher = more different
      return 1 - sum
    }

    case 'bhattacharyya': {
      let sum = 0
      for (let i = 0; i < bins; i++) {
        sum += Math.sqrt(hist1.luma[i] * hist2.luma[i])
      }
      // Bhattacharyya distance
      return Math.sqrt(1 - sum)
    }

    default:
      return 0
  }
}

// ============================================================================
// Content-Based Detection
// ============================================================================

/** Calculate average pixel difference between frames */
export function calculatePixelDifference(frame1: FrameData, frame2: FrameData): number {
  if (frame1.width !== frame2.width || frame1.height !== frame2.height) {
    throw new Error('Frame dimensions must match')
  }

  const data1 = frame1.data
  const data2 = frame2.data
  let totalDiff = 0
  const pixelCount = frame1.width * frame1.height

  for (let i = 0; i < data1.length; i += 4) {
    // Luma difference
    const y1 = 0.299 * data1[i] + 0.587 * data1[i + 1] + 0.114 * data1[i + 2]
    const y2 = 0.299 * data2[i] + 0.587 * data2[i + 1] + 0.114 * data2[i + 2]
    totalDiff += Math.abs(y1 - y2)
  }

  return totalDiff / (pixelCount * 255)
}

/** Calculate edge-based difference using Sobel operator */
export function calculateEdgeDifference(frame1: FrameData, frame2: FrameData): number {
  const edges1 = detectEdges(frame1)
  const edges2 = detectEdges(frame2)

  let diff = 0
  for (let i = 0; i < edges1.length; i++) {
    diff += Math.abs(edges1[i] - edges2[i])
  }

  return diff / (edges1.length * 255)
}

/** Detect edges using Sobel operator */
function detectEdges(frame: FrameData): Uint8Array {
  const { data, width, height } = frame
  const gray = new Uint8Array(width * height)
  const edges = new Uint8Array(width * height)

  // Convert to grayscale
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1]

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0
      let gy = 0

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx)
          const kidx = (ky + 1) * 3 + (kx + 1)
          gx += gray[idx] * sobelX[kidx]
          gy += gray[idx] * sobelY[kidx]
        }
      }

      edges[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy))
    }
  }

  return edges
}

// ============================================================================
// Fade Detection
// ============================================================================

/** Calculate average brightness of a frame */
export function calculateBrightness(frame: FrameData): number {
  const { data } = frame
  let sum = 0
  const pixelCount = data.length / 4

  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  return sum / (pixelCount * 255)
}

/** Detect fade-in or fade-out patterns */
export function detectFade(
  brightnessValues: number[],
  startIndex: number,
  windowSize: number = 10,
  threshold: number = 0.3,
): { type: 'fade-in' | 'fade-out' | null; confidence: number } {
  if (startIndex + windowSize > brightnessValues.length) {
    return { type: null, confidence: 0 }
  }

  const window = brightnessValues.slice(startIndex, startIndex + windowSize)

  // Check for monotonic increase (fade-in)
  let increasing = true
  let decreasing = true

  for (let i = 1; i < window.length; i++) {
    if (window[i] < window[i - 1]) increasing = false
    if (window[i] > window[i - 1]) decreasing = false
  }

  const diff = Math.abs(window[window.length - 1] - window[0])

  if (increasing && diff >= threshold) {
    return { type: 'fade-in', confidence: Math.min(1, diff / threshold) }
  }

  if (decreasing && diff >= threshold) {
    return { type: 'fade-out', confidence: Math.min(1, diff / threshold) }
  }

  return { type: null, confidence: 0 }
}

// ============================================================================
// Main Scene Detection
// ============================================================================

/** Scene detector class */
export class SceneDetector {
  private options: Required<SceneDetectionOptions>
  private previousFrame: FrameData | null = null
  private previousHistogram: ReturnType<typeof calculateHistogram> | null = null
  private frameNumber: number = 0
  private scores: number[] = []
  private brightnessHistory: number[] = []
  private sceneChanges: SceneChange[] = []

  constructor(options: SceneDetectionOptions = {}) {
    this.options = {
      method: options.method ?? 'histogram',
      threshold: options.threshold ?? 0.4,
      minSceneLength: options.minSceneLength ?? 15,
      detectFades: options.detectFades ?? true,
      frameRate: options.frameRate ?? 30,
      adaptiveWindow: options.adaptiveWindow ?? 30,
    }
  }

  /** Process a frame and check for scene change */
  processFrame(frame: FrameData): SceneChange | null {
    const timestamp = (this.frameNumber / this.options.frameRate) * 1000
    const brightness = calculateBrightness(frame)
    this.brightnessHistory.push(brightness)

    let score = 0
    let sceneChange: SceneChange | null = null

    if (this.previousFrame !== null) {
      // Calculate difference based on method
      switch (this.options.method) {
        case 'histogram': {
          const currentHist = calculateHistogram(frame)
          if (this.previousHistogram) {
            score = calculateHistogramDifference(this.previousHistogram, currentHist)
          }
          this.previousHistogram = currentHist
          break
        }

        case 'content':
          score = calculatePixelDifference(this.previousFrame, frame)
          break

        case 'threshold':
          score = calculatePixelDifference(this.previousFrame, frame)
          break

        case 'adaptive': {
          const currentHist = calculateHistogram(frame)
          if (this.previousHistogram) {
            score = calculateHistogramDifference(this.previousHistogram, currentHist)
          }
          this.previousHistogram = currentHist
          break
        }
      }

      this.scores.push(score)

      // Determine threshold
      let threshold = this.options.threshold
      if (this.options.method === 'adaptive' && this.scores.length > this.options.adaptiveWindow) {
        const recentScores = this.scores.slice(-this.options.adaptiveWindow)
        const mean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length
        const stdDev = Math.sqrt(
          recentScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / recentScores.length,
        )
        threshold = mean + 2 * stdDev
      }

      // Check for scene change
      if (score > threshold) {
        // Check minimum scene length
        const lastChange = this.sceneChanges[this.sceneChanges.length - 1]
        if (!lastChange || this.frameNumber - lastChange.frameNumber >= this.options.minSceneLength) {
          let type: SceneChangeType = 'cut'
          let confidence = Math.min(1, score / threshold)

          // Check for fades
          if (this.options.detectFades && this.brightnessHistory.length >= 10) {
            const fadeResult = detectFade(this.brightnessHistory, this.brightnessHistory.length - 10)
            if (fadeResult.type) {
              type = fadeResult.type
              confidence = fadeResult.confidence
            }
          }

          sceneChange = {
            frameNumber: this.frameNumber,
            timestamp,
            type,
            confidence,
            score,
          }

          this.sceneChanges.push(sceneChange)
        }
      }
    } else {
      // First frame - calculate initial histogram
      if (this.options.method === 'histogram' || this.options.method === 'adaptive') {
        this.previousHistogram = calculateHistogram(frame)
      }
    }

    this.previousFrame = frame
    this.frameNumber++

    return sceneChange
  }

  /** Get all detected scene changes */
  getSceneChanges(): SceneChange[] {
    return [...this.sceneChanges]
  }

  /** Get scene segments from detected changes */
  getSceneSegments(): SceneSegment[] {
    const segments: SceneSegment[] = []
    const changes = this.getSceneChanges()

    let startFrame = 0
    let startTime = 0

    for (const change of changes) {
      if (change.frameNumber > startFrame) {
        segments.push({
          startFrame,
          endFrame: change.frameNumber - 1,
          startTime,
          endTime: change.timestamp - (1000 / this.options.frameRate),
          duration: change.timestamp - startTime - (1000 / this.options.frameRate),
          frameCount: change.frameNumber - startFrame,
        })
      }

      startFrame = change.frameNumber
      startTime = change.timestamp
    }

    // Add final segment
    if (this.frameNumber > startFrame) {
      const endTime = (this.frameNumber / this.options.frameRate) * 1000
      segments.push({
        startFrame,
        endFrame: this.frameNumber - 1,
        startTime,
        endTime,
        duration: endTime - startTime,
        frameCount: this.frameNumber - startFrame,
      })
    }

    return segments
  }

  /** Reset the detector */
  reset(): void {
    this.previousFrame = null
    this.previousHistogram = null
    this.frameNumber = 0
    this.scores = []
    this.brightnessHistory = []
    this.sceneChanges = []
  }

  /** Get detection statistics */
  getStats(): {
    framesProcessed: number
    scenesDetected: number
    averageSceneLength: number
    scoreStats: { min: number; max: number; mean: number; stdDev: number }
  } {
    const segments = this.getSceneSegments()
    const avgLength =
      segments.length > 0
        ? segments.reduce((sum, s) => sum + s.frameCount, 0) / segments.length
        : 0

    let min = Infinity
    let max = -Infinity
    let sum = 0

    for (const score of this.scores) {
      if (score < min) min = score
      if (score > max) max = score
      sum += score
    }

    const mean = this.scores.length > 0 ? sum / this.scores.length : 0
    const variance =
      this.scores.length > 0
        ? this.scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / this.scores.length
        : 0
    const stdDev = Math.sqrt(variance)

    return {
      framesProcessed: this.frameNumber,
      scenesDetected: this.sceneChanges.length,
      averageSceneLength: avgLength,
      scoreStats: {
        min: min === Infinity ? 0 : min,
        max: max === -Infinity ? 0 : max,
        mean,
        stdDev,
      },
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Detect scenes in a sequence of frames */
export function detectScenes(
  frames: FrameData[],
  options: SceneDetectionOptions = {},
): { changes: SceneChange[]; segments: SceneSegment[] } {
  const detector = new SceneDetector(options)

  for (const frame of frames) {
    detector.processFrame(frame)
  }

  return {
    changes: detector.getSceneChanges(),
    segments: detector.getSceneSegments(),
  }
}

/** Find optimal threshold using the scores */
export function findOptimalThreshold(
  scores: number[],
  targetSceneCount?: number,
): number {
  if (scores.length === 0) return 0.5

  const sortedScores = [...scores].sort((a, b) => b - a)

  if (targetSceneCount && targetSceneCount < sortedScores.length) {
    // Return threshold that would give approximately the target scene count
    return sortedScores[targetSceneCount - 1]
  }

  // Use Otsu's method to find optimal threshold
  const histogram = new Array(100).fill(0)
  const binSize = 1 / 100

  for (const score of scores) {
    const bin = Math.min(99, Math.floor(score / binSize))
    histogram[bin]++
  }

  let maxVariance = 0
  let optimalThreshold = 0.5

  for (let t = 1; t < 99; t++) {
    let w0 = 0, w1 = 0, sum0 = 0, sum1 = 0

    for (let i = 0; i < t; i++) {
      w0 += histogram[i]
      sum0 += i * histogram[i]
    }

    for (let i = t; i < 100; i++) {
      w1 += histogram[i]
      sum1 += i * histogram[i]
    }

    if (w0 === 0 || w1 === 0) continue

    const mean0 = sum0 / w0
    const mean1 = sum1 / w1
    const variance = w0 * w1 * Math.pow(mean0 - mean1, 2)

    if (variance > maxVariance) {
      maxVariance = variance
      optimalThreshold = t * binSize
    }
  }

  return optimalThreshold
}

/** Format scene change for display */
export function formatSceneChange(change: SceneChange): string {
  const time = formatTimestamp(change.timestamp)
  const conf = (change.confidence * 100).toFixed(0)
  return `[${time}] Frame ${change.frameNumber}: ${change.type} (${conf}% confidence)`
}

/** Format timestamp as HH:MM:SS.mmm */
export function formatTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor(ms % 1000)

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

/** Get scene change timestamps for use with video splitting */
export function getSceneTimestamps(changes: SceneChange[]): number[] {
  return changes.map((c) => c.timestamp)
}
