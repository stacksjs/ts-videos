/**
 * Interlace detection and deinterlacing utilities
 *
 * Provides tools for detecting interlaced video content and
 * determining the best deinterlacing strategy.
 */

export interface InterlaceInfo {
  isInterlaced: boolean
  fieldOrder: 'tff' | 'bff' | 'progressive' | 'unknown'
  confidence: number
  combedFrames: number
  totalFrames: number
  combRatio: number
  telecinePattern?: TelecinePattern
  recommendedDeinterlacer: DeinterlaceMethod
}

export type FieldOrder = 'tff' | 'bff' | 'progressive' | 'unknown'

export interface TelecinePattern {
  type: '3:2' | '2:2' | 'mixed' | 'none'
  cadence: number[]
  confidence: number
}

export type DeinterlaceMethod =
  | 'yadif'
  | 'yadif_2x'
  | 'bwdif'
  | 'w3fdif'
  | 'kerndeint'
  | 'bob'
  | 'blend'
  | 'ivtc'
  | 'none'

export interface InterlaceDetectionOptions {
  sampleFrames?: number
  sampleInterval?: number
  combThreshold?: number
  fieldDifferenceThreshold?: number
  detectTelecine?: boolean
}

export interface CombDetectionResult {
  frameIndex: number
  combScore: number
  isCombed: boolean
  fieldDifference: number
  motionScore: number
}

export interface FieldAnalysis {
  topFieldEnergy: number
  bottomFieldEnergy: number
  interFieldMotion: number
  fieldOrder: FieldOrder
}

/**
 * Calculate the comb score for a frame
 * Higher scores indicate more interlacing artifacts
 */
export function calculateCombScore(
  frameData: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 30
): number {
  let combPixels = 0
  let totalPixels = 0

  // Check for comb patterns (horizontal line differences)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4

      // Get luminance for current row and adjacent rows
      const lumAbove = getLuminance(frameData[idx - width * 4], frameData[idx - width * 4 + 1], frameData[idx - width * 4 + 2])
      const lumCurrent = getLuminance(frameData[idx], frameData[idx + 1], frameData[idx + 2])
      const lumBelow = getLuminance(frameData[idx + width * 4], frameData[idx + width * 4 + 1], frameData[idx + width * 4 + 2])

      // Detect comb pattern: current line differs significantly from both neighbors
      const diffAbove = Math.abs(lumCurrent - lumAbove)
      const diffBelow = Math.abs(lumCurrent - lumBelow)
      const neighborDiff = Math.abs(lumAbove - lumBelow)

      // Comb pattern: current differs from both neighbors, but neighbors are similar
      if (diffAbove > threshold && diffBelow > threshold && neighborDiff < threshold / 2) {
        combPixels++
      }
      totalPixels++
    }
  }

  return combPixels / totalPixels
}

/**
 * Analyze field order by comparing field motion patterns
 */
export function analyzeFieldOrder(
  frame1Data: Uint8Array | Uint8ClampedArray,
  frame2Data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): FieldAnalysis {
  let topFieldEnergy = 0
  let bottomFieldEnergy = 0
  let interFieldMotion = 0

  // Analyze top field (even lines) and bottom field (odd lines)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4

      const lum1 = getLuminance(frame1Data[idx], frame1Data[idx + 1], frame1Data[idx + 2])
      const lum2 = getLuminance(frame2Data[idx], frame2Data[idx + 1], frame2Data[idx + 2])

      const diff = Math.abs(lum1 - lum2)

      if (y % 2 === 0) {
        topFieldEnergy += diff
      }
      else {
        bottomFieldEnergy += diff
      }
    }
  }

  // Calculate inter-field motion
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const idxAbove = ((y - 1) * width + x) * 4
      const idxBelow = ((y + 1) * width + x) * 4

      const lumCurrent = getLuminance(frame1Data[idx], frame1Data[idx + 1], frame1Data[idx + 2])
      const lumAbove = getLuminance(frame1Data[idxAbove], frame1Data[idxAbove + 1], frame1Data[idxAbove + 2])
      const lumBelow = getLuminance(frame1Data[idxBelow], frame1Data[idxBelow + 1], frame1Data[idxBelow + 2])

      interFieldMotion += Math.abs(lumCurrent - (lumAbove + lumBelow) / 2)
    }
  }

  const totalPixels = width * height / 2
  topFieldEnergy /= totalPixels
  bottomFieldEnergy /= totalPixels
  interFieldMotion /= totalPixels

  // Determine field order based on which field has more temporal energy
  let fieldOrder: FieldOrder = 'unknown'
  const energyRatio = topFieldEnergy / (bottomFieldEnergy || 1)

  if (topFieldEnergy < 0.01 && bottomFieldEnergy < 0.01) {
    fieldOrder = 'progressive'
  }
  else if (energyRatio > 1.2) {
    fieldOrder = 'tff' // Top field first (top field moves first)
  }
  else if (energyRatio < 0.8) {
    fieldOrder = 'bff' // Bottom field first
  }

  return {
    topFieldEnergy,
    bottomFieldEnergy,
    interFieldMotion,
    fieldOrder,
  }
}

/**
 * Detect telecine pattern (3:2 pulldown)
 */
export function detectTelecinePattern(
  combScores: number[],
  threshold: number = 0.02
): TelecinePattern {
  if (combScores.length < 10) {
    return { type: 'none', cadence: [], confidence: 0 }
  }

  // Look for 3:2 pulldown pattern (2 clean, 3 interlaced or vice versa)
  const pattern32 = [0, 0, 1, 1, 1] // AABBB or similar
  const pattern22 = [0, 1, 0, 1] // Alternating

  const combedFrames = combScores.map(s => s > threshold ? 1 : 0)

  // Check for 3:2 pattern
  let pattern32Matches = 0
  let pattern32Tests = 0
  for (let i = 0; i <= combedFrames.length - 5; i++) {
    const window = combedFrames.slice(i, i + 5)
    // Check all rotations of 3:2 pattern
    for (let rotation = 0; rotation < 5; rotation++) {
      const rotatedPattern = [...pattern32.slice(rotation), ...pattern32.slice(0, rotation)]
      if (arraysMatch(window, rotatedPattern)) {
        pattern32Matches++
        break
      }
    }
    pattern32Tests++
  }

  // Check for 2:2 pattern
  let pattern22Matches = 0
  let pattern22Tests = 0
  for (let i = 0; i <= combedFrames.length - 4; i++) {
    const window = combedFrames.slice(i, i + 4)
    for (let rotation = 0; rotation < 4; rotation++) {
      const rotatedPattern = [...pattern22.slice(rotation), ...pattern22.slice(0, rotation)]
      if (arraysMatch(window, rotatedPattern)) {
        pattern22Matches++
        break
      }
    }
    pattern22Tests++
  }

  const pattern32Confidence = pattern32Matches / (pattern32Tests || 1)
  const pattern22Confidence = pattern22Matches / (pattern22Tests || 1)

  if (pattern32Confidence > 0.6) {
    return {
      type: '3:2',
      cadence: [3, 2],
      confidence: pattern32Confidence,
    }
  }
  else if (pattern22Confidence > 0.6) {
    return {
      type: '2:2',
      cadence: [2, 2],
      confidence: pattern22Confidence,
    }
  }
  else if (pattern32Confidence > 0.3 || pattern22Confidence > 0.3) {
    return {
      type: 'mixed',
      cadence: [],
      confidence: Math.max(pattern32Confidence, pattern22Confidence),
    }
  }

  return { type: 'none', cadence: [], confidence: 1 - Math.max(pattern32Confidence, pattern22Confidence) }
}

/**
 * Recommend the best deinterlacing method based on content analysis
 */
export function recommendDeinterlacer(info: Partial<InterlaceInfo>): DeinterlaceMethod {
  if (!info.isInterlaced || info.combRatio === 0) {
    return 'none'
  }

  // If telecine is detected, use IVTC (inverse telecine)
  if (info.telecinePattern?.type === '3:2' && info.telecinePattern.confidence > 0.7) {
    return 'ivtc'
  }

  // For mixed or low confidence telecine, use yadif
  if (info.telecinePattern?.type === 'mixed') {
    return 'yadif'
  }

  // High motion content benefits from yadif_2x (double framerate)
  if (info.combRatio && info.combRatio > 0.5) {
    return 'yadif_2x'
  }

  // For moderate interlacing, standard yadif works well
  if (info.combRatio && info.combRatio > 0.1) {
    return 'yadif'
  }

  // For light interlacing, bwdif provides good quality
  if (info.combRatio && info.combRatio > 0.02) {
    return 'bwdif'
  }

  // Very light interlacing can use simple blend
  return 'blend'
}

/**
 * Interlace detector class for analyzing video frames
 */
export class InterlaceDetector {
  private options: Required<InterlaceDetectionOptions>
  private combScores: number[] = []
  private fieldAnalyses: FieldAnalysis[] = []
  private frameCount: number = 0

  constructor(options: InterlaceDetectionOptions = {}) {
    this.options = {
      sampleFrames: options.sampleFrames ?? 100,
      sampleInterval: options.sampleInterval ?? 1,
      combThreshold: options.combThreshold ?? 0.02,
      fieldDifferenceThreshold: options.fieldDifferenceThreshold ?? 30,
      detectTelecine: options.detectTelecine ?? true,
    }
  }

  /**
   * Analyze a single frame for interlacing
   */
  analyzeFrame(
    frameData: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    previousFrameData?: Uint8Array | Uint8ClampedArray
  ): CombDetectionResult {
    const combScore = calculateCombScore(
      frameData,
      width,
      height,
      this.options.fieldDifferenceThreshold
    )

    let fieldDifference = 0
    let motionScore = 0

    if (previousFrameData) {
      const fieldAnalysis = analyzeFieldOrder(previousFrameData, frameData, width, height)
      fieldDifference = Math.abs(fieldAnalysis.topFieldEnergy - fieldAnalysis.bottomFieldEnergy)
      motionScore = fieldAnalysis.interFieldMotion
      this.fieldAnalyses.push(fieldAnalysis)
    }

    const isCombed = combScore > this.options.combThreshold
    this.combScores.push(combScore)

    const result: CombDetectionResult = {
      frameIndex: this.frameCount,
      combScore,
      isCombed,
      fieldDifference,
      motionScore,
    }

    this.frameCount++
    return result
  }

  /**
   * Get the final interlace analysis
   */
  getAnalysis(): InterlaceInfo {
    const combedFrames = this.combScores.filter(s => s > this.options.combThreshold).length
    const totalFrames = this.combScores.length
    const combRatio = totalFrames > 0 ? combedFrames / totalFrames : 0

    // Determine field order from analyses
    let tffCount = 0
    let bffCount = 0
    let progressiveCount = 0

    for (const analysis of this.fieldAnalyses) {
      if (analysis.fieldOrder === 'tff')
        tffCount++
      else if (analysis.fieldOrder === 'bff')
        bffCount++
      else if (analysis.fieldOrder === 'progressive')
        progressiveCount++
    }

    let fieldOrder: FieldOrder = 'unknown'
    const maxCount = Math.max(tffCount, bffCount, progressiveCount)
    if (maxCount > 0) {
      if (progressiveCount === maxCount)
        fieldOrder = 'progressive'
      else if (tffCount === maxCount)
        fieldOrder = 'tff'
      else if (bffCount === maxCount)
        fieldOrder = 'bff'
    }

    const isInterlaced = combRatio > 0.05 && fieldOrder !== 'progressive'

    // Detect telecine if enabled
    let telecinePattern: TelecinePattern | undefined
    if (this.options.detectTelecine && this.combScores.length >= 10) {
      telecinePattern = detectTelecinePattern(this.combScores, this.options.combThreshold)
    }

    // Calculate confidence based on sample size and consistency
    const sampleConfidence = Math.min(1, totalFrames / this.options.sampleFrames)
    const consistencyConfidence = fieldOrder !== 'unknown' ? maxCount / (this.fieldAnalyses.length || 1) : 0.5
    const confidence = (sampleConfidence + consistencyConfidence) / 2

    const info: InterlaceInfo = {
      isInterlaced,
      fieldOrder,
      confidence,
      combedFrames,
      totalFrames,
      combRatio,
      telecinePattern,
      recommendedDeinterlacer: 'none',
    }

    info.recommendedDeinterlacer = recommendDeinterlacer(info)

    return info
  }

  /**
   * Reset the detector for a new video
   */
  reset(): void {
    this.combScores = []
    this.fieldAnalyses = []
    this.frameCount = 0
  }
}

/**
 * Quick interlace detection from frame samples
 */
export async function detectInterlace(
  frames: Array<{ data: Uint8Array | Uint8ClampedArray, width: number, height: number }>,
  options: InterlaceDetectionOptions = {}
): Promise<InterlaceInfo> {
  const detector = new InterlaceDetector(options)

  let previousFrame: Uint8Array | Uint8ClampedArray | undefined

  for (const frame of frames) {
    detector.analyzeFrame(frame.data, frame.width, frame.height, previousFrame)
    previousFrame = frame.data
  }

  return detector.getAnalysis()
}

/**
 * Generate FFmpeg filter string for deinterlacing
 */
export function getDeinterlaceFilter(
  method: DeinterlaceMethod,
  fieldOrder: FieldOrder = 'tff'
): string {
  const parity = fieldOrder === 'bff' ? 1 : 0 // 0 = tff, 1 = bff

  switch (method) {
    case 'yadif':
      return `yadif=mode=0:parity=${parity}:deint=0`
    case 'yadif_2x':
      return `yadif=mode=1:parity=${parity}:deint=0`
    case 'bwdif':
      return `bwdif=mode=0:parity=${parity}:deint=0`
    case 'w3fdif':
      return `w3fdif=filter=complex:deint=0`
    case 'kerndeint':
      return `kerndeint=thresh=10:map=0:order=${parity}:sharp=0:twoway=0`
    case 'bob':
      return `tinterlace=mode=6`
    case 'blend':
      return `tinterlace=mode=0`
    case 'ivtc':
      return `pullup,fps=24000/1001`
    case 'none':
    default:
      return ''
  }
}

/**
 * Get deinterlace filter options description
 */
export function getDeinterlaceDescription(method: DeinterlaceMethod): string {
  const descriptions: Record<DeinterlaceMethod, string> = {
    yadif: 'Yet Another DeInterlacing Filter - good balance of speed and quality',
    yadif_2x: 'Yadif with double framerate output - best for high motion content',
    bwdif: 'Bob Weaver Deinterlacing Filter - high quality, slightly slower than yadif',
    w3fdif: 'Weston Three Field Deinterlacing Filter - very high quality',
    kerndeint: 'Kernel Deinterlacer - adaptive kernel-based deinterlacing',
    bob: 'Simple bob deinterlacing - doubles framerate, fast but lower quality',
    blend: 'Simple field blending - fast, good for static content',
    ivtc: 'Inverse Telecine - removes 3:2 pulldown, restores original 24fps',
    none: 'No deinterlacing needed',
  }

  return descriptions[method]
}

// Helper functions

function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function arraysMatch(a: number[], b: number[]): boolean {
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false
  }
  return true
}

export default {
  InterlaceDetector,
  detectInterlace,
  calculateCombScore,
  analyzeFieldOrder,
  detectTelecinePattern,
  recommendDeinterlacer,
  getDeinterlaceFilter,
  getDeinterlaceDescription,
}
