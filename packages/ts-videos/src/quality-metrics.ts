/**
 * Video quality metrics
 * Implements PSNR, SSIM, and related quality assessment algorithms
 */

// ============================================================================
// Types
// ============================================================================

/** Quality assessment result */
export interface QualityResult {
  /** Peak Signal-to-Noise Ratio (dB) */
  psnr: number
  /** Structural Similarity Index (0-1) */
  ssim: number
  /** Mean Squared Error */
  mse: number
  /** Per-channel PSNR */
  psnrChannels?: { r: number; g: number; b: number }
  /** Per-channel SSIM */
  ssimChannels?: { r: number; g: number; b: number }
}

/** Frame data for quality analysis */
export interface QualityFrameData {
  /** RGBA pixel data */
  data: Uint8Array | Uint8ClampedArray
  /** Frame width */
  width: number
  /** Frame height */
  height: number
}

/** SSIM calculation options */
export interface SsimOptions {
  /** Window size for local statistics (default: 11) */
  windowSize?: number
  /** K1 constant (default: 0.01) */
  k1?: number
  /** K2 constant (default: 0.03) */
  k2?: number
  /** Use luminance only (default: false) */
  luminanceOnly?: boolean
}

/** Quality metrics over time */
export interface QualityTimeSeries {
  /** Frame numbers */
  frames: number[]
  /** PSNR values per frame */
  psnr: number[]
  /** SSIM values per frame */
  ssim: number[]
  /** Average PSNR */
  avgPsnr: number
  /** Average SSIM */
  avgSsim: number
  /** Minimum PSNR */
  minPsnr: number
  /** Minimum SSIM */
  minSsim: number
  /** Frames below quality threshold */
  lowQualityFrames: number[]
}

// ============================================================================
// MSE and PSNR
// ============================================================================

/** Calculate Mean Squared Error between two frames */
export function calculateMse(
  original: QualityFrameData,
  compressed: QualityFrameData,
  channel?: 'r' | 'g' | 'b' | 'luma',
): number {
  if (original.width !== compressed.width || original.height !== compressed.height) {
    throw new Error('Frame dimensions must match')
  }

  const data1 = original.data
  const data2 = compressed.data
  let sum = 0
  let count = 0

  for (let i = 0; i < data1.length; i += 4) {
    let v1: number
    let v2: number

    switch (channel) {
      case 'r':
        v1 = data1[i]
        v2 = data2[i]
        break
      case 'g':
        v1 = data1[i + 1]
        v2 = data2[i + 1]
        break
      case 'b':
        v1 = data1[i + 2]
        v2 = data2[i + 2]
        break
      case 'luma':
        v1 = 0.299 * data1[i] + 0.587 * data1[i + 1] + 0.114 * data1[i + 2]
        v2 = 0.299 * data2[i] + 0.587 * data2[i + 1] + 0.114 * data2[i + 2]
        break
      default:
        // Average of RGB
        v1 = (data1[i] + data1[i + 1] + data1[i + 2]) / 3
        v2 = (data2[i] + data2[i + 1] + data2[i + 2]) / 3
    }

    sum += Math.pow(v1 - v2, 2)
    count++
  }

  return sum / count
}

/** Calculate PSNR from MSE */
export function mseToPsnr(mse: number, maxValue: number = 255): number {
  if (mse === 0) return Infinity
  return 10 * Math.log10((maxValue * maxValue) / mse)
}

/** Calculate Peak Signal-to-Noise Ratio */
export function calculatePsnr(
  original: QualityFrameData,
  compressed: QualityFrameData,
  maxValue: number = 255,
): number {
  const mse = calculateMse(original, compressed)
  return mseToPsnr(mse, maxValue)
}

/** Calculate PSNR for each color channel */
export function calculatePsnrChannels(
  original: QualityFrameData,
  compressed: QualityFrameData,
): { r: number; g: number; b: number; luma: number } {
  return {
    r: mseToPsnr(calculateMse(original, compressed, 'r')),
    g: mseToPsnr(calculateMse(original, compressed, 'g')),
    b: mseToPsnr(calculateMse(original, compressed, 'b')),
    luma: mseToPsnr(calculateMse(original, compressed, 'luma')),
  }
}

// ============================================================================
// SSIM (Structural Similarity Index)
// ============================================================================

/** Calculate SSIM between two frames */
export function calculateSsim(
  original: QualityFrameData,
  compressed: QualityFrameData,
  options: SsimOptions = {},
): number {
  if (original.width !== compressed.width || original.height !== compressed.height) {
    throw new Error('Frame dimensions must match')
  }

  const windowSize = options.windowSize ?? 11
  const k1 = options.k1 ?? 0.01
  const k2 = options.k2 ?? 0.03
  const luminanceOnly = options.luminanceOnly ?? true

  const L = 255 // Dynamic range
  const c1 = Math.pow(k1 * L, 2)
  const c2 = Math.pow(k2 * L, 2)

  // Convert to grayscale (luminance)
  const width = original.width
  const height = original.height

  const gray1 = new Float32Array(width * height)
  const gray2 = new Float32Array(width * height)

  for (let i = 0, j = 0; i < original.data.length; i += 4, j++) {
    if (luminanceOnly) {
      gray1[j] = 0.299 * original.data[i] + 0.587 * original.data[i + 1] + 0.114 * original.data[i + 2]
      gray2[j] = 0.299 * compressed.data[i] + 0.587 * compressed.data[i + 1] + 0.114 * compressed.data[i + 2]
    }
    else {
      gray1[j] = (original.data[i] + original.data[i + 1] + original.data[i + 2]) / 3
      gray2[j] = (compressed.data[i] + compressed.data[i + 1] + compressed.data[i + 2]) / 3
    }
  }

  // Calculate SSIM using sliding window
  const halfWindow = Math.floor(windowSize / 2)
  let ssimSum = 0
  let count = 0

  for (let y = halfWindow; y < height - halfWindow; y++) {
    for (let x = halfWindow; x < width - halfWindow; x++) {
      // Calculate local statistics
      let sum1 = 0, sum2 = 0
      let sumSq1 = 0, sumSq2 = 0
      let sumProd = 0
      let n = 0

      for (let wy = -halfWindow; wy <= halfWindow; wy++) {
        for (let wx = -halfWindow; wx <= halfWindow; wx++) {
          const idx = (y + wy) * width + (x + wx)
          const v1 = gray1[idx]
          const v2 = gray2[idx]

          sum1 += v1
          sum2 += v2
          sumSq1 += v1 * v1
          sumSq2 += v2 * v2
          sumProd += v1 * v2
          n++
        }
      }

      const mean1 = sum1 / n
      const mean2 = sum2 / n
      const var1 = sumSq1 / n - mean1 * mean1
      const var2 = sumSq2 / n - mean2 * mean2
      const covar = sumProd / n - mean1 * mean2

      // SSIM formula
      const numerator = (2 * mean1 * mean2 + c1) * (2 * covar + c2)
      const denominator = (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2)

      ssimSum += numerator / denominator
      count++
    }
  }

  return ssimSum / count
}

/** Calculate SSIM for each color channel */
export function calculateSsimChannels(
  original: QualityFrameData,
  compressed: QualityFrameData,
  options: SsimOptions = {},
): { r: number; g: number; b: number } {
  // Extract individual channels
  const extractChannel = (data: Uint8Array | Uint8ClampedArray, offset: number): Uint8Array => {
    const result = new Uint8Array(data.length / 4)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      result[j] = data[i + offset]
    }
    return result
  }

  const calcChannelSsim = (orig: Uint8Array, comp: Uint8Array, width: number, height: number): number => {
    const origData = new Uint8Array(width * height * 4)
    const compData = new Uint8Array(width * height * 4)

    for (let i = 0, j = 0; i < orig.length; i++, j += 4) {
      origData[j] = orig[i]
      compData[j] = comp[i]
    }

    return calculateSsim(
      { data: origData, width, height },
      { data: compData, width, height },
      { ...options, luminanceOnly: false },
    )
  }

  const rOrig = extractChannel(original.data, 0)
  const gOrig = extractChannel(original.data, 1)
  const bOrig = extractChannel(original.data, 2)

  const rComp = extractChannel(compressed.data, 0)
  const gComp = extractChannel(compressed.data, 1)
  const bComp = extractChannel(compressed.data, 2)

  return {
    r: calcChannelSsim(rOrig, rComp, original.width, original.height),
    g: calcChannelSsim(gOrig, gComp, original.width, original.height),
    b: calcChannelSsim(bOrig, bComp, original.width, original.height),
  }
}

// ============================================================================
// Multi-Scale SSIM (MS-SSIM)
// ============================================================================

/** Calculate Multi-Scale SSIM */
export function calculateMsSsim(
  original: QualityFrameData,
  compressed: QualityFrameData,
  levels: number = 5,
): number {
  // MS-SSIM weights for 5 levels
  const weights = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333]

  let msSsim = 1
  let currentOrig = original
  let currentComp = compressed

  for (let level = 0; level < levels; level++) {
    const ssim = calculateSsim(currentOrig, currentComp)
    const weight = weights[Math.min(level, weights.length - 1)]

    // Use contrast and structure for intermediate levels, all components for last level
    if (level === levels - 1) {
      msSsim *= Math.pow(ssim, weight)
    }
    else {
      // Approximate: use SSIM as proxy for contrast/structure
      msSsim *= Math.pow(Math.max(0, ssim), weight)
    }

    // Downsample for next level
    if (level < levels - 1) {
      currentOrig = downsample(currentOrig)
      currentComp = downsample(currentComp)
    }
  }

  return msSsim
}

/** Downsample frame by factor of 2 */
function downsample(frame: QualityFrameData): QualityFrameData {
  const newWidth = Math.floor(frame.width / 2)
  const newHeight = Math.floor(frame.height / 2)
  const newData = new Uint8Array(newWidth * newHeight * 4)

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = x * 2
      const srcY = y * 2

      // Average 2x2 block
      for (let c = 0; c < 4; c++) {
        const idx00 = (srcY * frame.width + srcX) * 4 + c
        const idx01 = (srcY * frame.width + srcX + 1) * 4 + c
        const idx10 = ((srcY + 1) * frame.width + srcX) * 4 + c
        const idx11 = ((srcY + 1) * frame.width + srcX + 1) * 4 + c

        const avg = (frame.data[idx00] + frame.data[idx01] + frame.data[idx10] + frame.data[idx11]) / 4
        newData[(y * newWidth + x) * 4 + c] = Math.round(avg)
      }
    }
  }

  return { data: newData, width: newWidth, height: newHeight }
}

// ============================================================================
// Complete Quality Assessment
// ============================================================================

/** Perform complete quality assessment */
export function assessQuality(
  original: QualityFrameData,
  compressed: QualityFrameData,
  options: SsimOptions = {},
): QualityResult {
  const mse = calculateMse(original, compressed)
  const psnr = mseToPsnr(mse)
  const ssim = calculateSsim(original, compressed, options)

  return {
    psnr,
    ssim,
    mse,
    psnrChannels: calculatePsnrChannels(original, compressed),
    ssimChannels: calculateSsimChannels(original, compressed, options),
  }
}

/** Assess quality over a sequence of frames */
export function assessQualitySequence(
  originalFrames: QualityFrameData[],
  compressedFrames: QualityFrameData[],
  options: { ssimOptions?: SsimOptions; psnrThreshold?: number; ssimThreshold?: number } = {},
): QualityTimeSeries {
  if (originalFrames.length !== compressedFrames.length) {
    throw new Error('Frame sequences must have the same length')
  }

  const psnrThreshold = options.psnrThreshold ?? 30
  const ssimThreshold = options.ssimThreshold ?? 0.9

  const frames: number[] = []
  const psnrValues: number[] = []
  const ssimValues: number[] = []
  const lowQualityFrames: number[] = []

  let psnrSum = 0
  let ssimSum = 0
  let minPsnr = Infinity
  let minSsim = Infinity

  for (let i = 0; i < originalFrames.length; i++) {
    const result = assessQuality(originalFrames[i], compressedFrames[i], options.ssimOptions)

    frames.push(i)
    psnrValues.push(result.psnr)
    ssimValues.push(result.ssim)

    psnrSum += result.psnr
    ssimSum += result.ssim

    if (result.psnr < minPsnr) minPsnr = result.psnr
    if (result.ssim < minSsim) minSsim = result.ssim

    if (result.psnr < psnrThreshold || result.ssim < ssimThreshold) {
      lowQualityFrames.push(i)
    }
  }

  return {
    frames,
    psnr: psnrValues,
    ssim: ssimValues,
    avgPsnr: psnrSum / originalFrames.length,
    avgSsim: ssimSum / originalFrames.length,
    minPsnr: minPsnr === Infinity ? 0 : minPsnr,
    minSsim: minSsim === Infinity ? 0 : minSsim,
    lowQualityFrames,
  }
}

// ============================================================================
// Additional Metrics
// ============================================================================

/** Calculate Visual Information Fidelity (VIF) - simplified version */
export function calculateVif(
  original: QualityFrameData,
  compressed: QualityFrameData,
): number {
  // Simplified VIF using variance ratio
  // Full VIF requires wavelet decomposition

  const width = original.width
  const height = original.height
  const blockSize = 8

  let numerator = 0
  let denominator = 0

  for (let y = 0; y + blockSize <= height; y += blockSize) {
    for (let x = 0; x + blockSize <= width; x += blockSize) {
      // Calculate block variance for original
      let sum1 = 0, sumSq1 = 0
      let sum2 = 0, sumSq2 = 0
      let sumProd = 0
      const n = blockSize * blockSize

      for (let by = 0; by < blockSize; by++) {
        for (let bx = 0; bx < blockSize; bx++) {
          const idx = ((y + by) * width + (x + bx)) * 4
          const v1 = 0.299 * original.data[idx] + 0.587 * original.data[idx + 1] + 0.114 * original.data[idx + 2]
          const v2 = 0.299 * compressed.data[idx] + 0.587 * compressed.data[idx + 1] + 0.114 * compressed.data[idx + 2]

          sum1 += v1
          sumSq1 += v1 * v1
          sum2 += v2
          sumSq2 += v2 * v2
          sumProd += v1 * v2
        }
      }

      const mean1 = sum1 / n
      const mean2 = sum2 / n
      const var1 = Math.max(0, sumSq1 / n - mean1 * mean1)
      const var2 = Math.max(0, sumSq2 / n - mean2 * mean2)
      const covar = sumProd / n - mean1 * mean2

      const sigma = 0.1 // Noise variance estimate
      const g = covar / (var1 + sigma)
      const sv = var2 - g * covar

      // Mutual information approximation
      const eps = 1e-10
      numerator += Math.log2(1 + g * g * var1 / (sv + sigma + eps))
      denominator += Math.log2(1 + var1 / sigma)
    }
  }

  return denominator > 0 ? numerator / denominator : 0
}

/** Calculate Delta E (color difference) in Lab color space */
export function calculateDeltaE(
  original: QualityFrameData,
  compressed: QualityFrameData,
): number {
  let deltaESum = 0
  const pixelCount = original.width * original.height

  for (let i = 0; i < original.data.length; i += 4) {
    // Convert RGB to Lab
    const lab1 = rgbToLab(original.data[i], original.data[i + 1], original.data[i + 2])
    const lab2 = rgbToLab(compressed.data[i], compressed.data[i + 1], compressed.data[i + 2])

    // Calculate Delta E (CIE76)
    const deltaE = Math.sqrt(
      Math.pow(lab1.l - lab2.l, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2),
    )

    deltaESum += deltaE
  }

  return deltaESum / pixelCount
}

/** Convert RGB to Lab color space */
function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  // Normalize to 0-1
  let rn = r / 255
  let gn = g / 255
  let bn = b / 255

  // Linearize (gamma correction)
  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92

  // Convert to XYZ (D65 illuminant)
  const x = (rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375) / 0.95047
  const y = (rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750)
  const z = (rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041) / 1.08883

  // Convert to Lab
  const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116)

  const l = 116 * f(y) - 16
  const a = 500 * (f(x) - f(y))
  const labB = 200 * (f(y) - f(z))

  return { l, a, b: labB }
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Get quality rating from PSNR value */
export function getPsnrRating(psnr: number): string {
  if (psnr >= 50) return 'Excellent'
  if (psnr >= 40) return 'Good'
  if (psnr >= 30) return 'Acceptable'
  if (psnr >= 20) return 'Poor'
  return 'Bad'
}

/** Get quality rating from SSIM value */
export function getSsimRating(ssim: number): string {
  if (ssim >= 0.99) return 'Excellent'
  if (ssim >= 0.95) return 'Good'
  if (ssim >= 0.90) return 'Acceptable'
  if (ssim >= 0.80) return 'Poor'
  return 'Bad'
}

/** Format quality result for display */
export function formatQualityResult(result: QualityResult): string {
  const lines = [
    `PSNR: ${result.psnr.toFixed(2)} dB (${getPsnrRating(result.psnr)})`,
    `SSIM: ${result.ssim.toFixed(4)} (${getSsimRating(result.ssim)})`,
    `MSE: ${result.mse.toFixed(4)}`,
  ]

  if (result.psnrChannels) {
    lines.push(`PSNR (R/G/B): ${result.psnrChannels.r.toFixed(2)} / ${result.psnrChannels.g.toFixed(2)} / ${result.psnrChannels.b.toFixed(2)} dB`)
  }

  return lines.join('\n')
}

/** Estimate bitrate needed for target quality */
export function estimateBitrateForQuality(
  width: number,
  height: number,
  frameRate: number,
  targetSsim: number = 0.95,
): number {
  // Empirical formula based on resolution and target quality
  const pixels = width * height
  const baseBitrate = pixels * frameRate * 0.1 // bits per second

  // Adjust based on target quality
  const qualityMultiplier = 1 + (targetSsim - 0.9) * 10

  return Math.round(baseBitrate * qualityMultiplier / 1000) * 1000 // Round to nearest kbps
}

/** Compare two compression settings */
export function compareSettings(
  results: { name: string; result: QualityResult; bitrate?: number }[],
): { winner: string; comparison: string[] } {
  let bestSsim = -Infinity
  let winner = ''

  const comparison: string[] = []

  for (const r of results) {
    if (r.result.ssim > bestSsim) {
      bestSsim = r.result.ssim
      winner = r.name
    }

    let line = `${r.name}: PSNR=${r.result.psnr.toFixed(2)}dB, SSIM=${r.result.ssim.toFixed(4)}`
    if (r.bitrate) {
      const efficiency = r.result.ssim / (r.bitrate / 1000000)
      line += `, Bitrate=${(r.bitrate / 1000).toFixed(0)}kbps, Efficiency=${efficiency.toFixed(4)}`
    }
    comparison.push(line)
  }

  return { winner, comparison }
}
