/* eslint-disable style/max-statements-per-line */
/**
 * Loudness measurement and normalization
 * Implements EBU R128 / ITU-R BS.1770 standards
 */

// ============================================================================
// Types
// ============================================================================

/** Loudness measurement result */
export interface LoudnessResult {
  /** Integrated loudness (LUFS) */
  integrated: number
  /** Loudness range (LU) */
  range: number
  /** True peak (dBTP) */
  truePeak: number
  /** Short-term loudness values (LUFS) */
  shortTerm: number[]
  /** Momentary loudness values (LUFS) */
  momentary: number[]
  /** Sample peak (dBFS) */
  samplePeak: number
}

/** Loudness normalization options */
export interface LoudnessNormOptions {
  /** Target integrated loudness (LUFS), default -14 for streaming */
  targetLufs?: number
  /** Target true peak (dBTP), default -1.0 */
  targetPeak?: number
  /** Normalization mode */
  mode?: 'integrated' | 'peak' | 'dual'
  /** Allow upward normalization */
  allowUpward?: boolean
  /** Maximum gain adjustment (dB) */
  maxGain?: number
}

/** Loudness gate state */
interface GateState {
  threshold: number
  enabled: boolean
}

// ============================================================================
// ITU-R BS.1770 K-weighting Filter
// ============================================================================

/** Pre-filter coefficients (high shelf) for 48kHz */
const PRE_FILTER_48K = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1.0, -1.69065929318241, 0.73248077421585],
}

/** High-pass filter coefficients for 48kHz */
const HP_FILTER_48K = {
  b: [1.0, -2.0, 1.0],
  a: [1.0, -1.99004745483398, 0.99007225036621],
}

/** Calculate K-weighting filter coefficients for a given sample rate */
export function calculateKWeightingCoeffs(sampleRate: number): {
  preFilter: { b: number[]; a: number[] }
  hpFilter: { b: number[]; a: number[] }
} {
  // For simplicity, use pre-calculated coefficients for common sample rates
  // A full implementation would calculate these using bilinear transform

  if (sampleRate === 48000) {
    return { preFilter: PRE_FILTER_48K, hpFilter: HP_FILTER_48K }
  }

  // Scale coefficients for other sample rates (approximation)
  const ratio = 48000 / sampleRate

  return {
    preFilter: {
      b: PRE_FILTER_48K.b.map((v, i) => i === 0 ? v : v * Math.pow(ratio, i)),
      a: PRE_FILTER_48K.a.map((v, i) => i === 0 ? v : v * Math.pow(ratio, i)),
    },
    hpFilter: {
      b: HP_FILTER_48K.b,
      a: HP_FILTER_48K.a.map((v, i) => i === 0 ? v : v * Math.pow(ratio, i)),
    },
  }
}

/** Apply biquad filter to samples */
export function applyBiquadFilter(
  samples: Float32Array,
  b: number[],
  a: number[],
): Float32Array {
  const output = new Float32Array(samples.length)
  const x = [0, 0, 0] // Input history
  const y = [0, 0, 0] // Output history

  for (let i = 0; i < samples.length; i++) {
    x[0] = samples[i]

    // Direct Form II Transposed
    y[0] = b[0] * x[0] + b[1] * x[1] + b[2] * x[2] - a[1] * y[1] - a[2] * y[2]

    output[i] = y[0]

    // Shift history
    x[2] = x[1]
    x[1] = x[0]
    y[2] = y[1]
    y[1] = y[0]
  }

  return output
}

/** Apply K-weighting filter to audio samples */
export function applyKWeighting(samples: Float32Array, sampleRate: number): Float32Array {
  const coeffs = calculateKWeightingCoeffs(sampleRate)

  // Apply pre-filter (high shelf)
  let filtered = applyBiquadFilter(samples, coeffs.preFilter.b, coeffs.preFilter.a)

  // Apply high-pass filter
  filtered = applyBiquadFilter(filtered, coeffs.hpFilter.b, coeffs.hpFilter.a)

  return filtered
}

// ============================================================================
// Loudness Measurement
// ============================================================================

/** Channel weights for surround sound (ITU-R BS.1770) */
export const CHANNEL_WEIGHTS: Record<string, number> = {
  left: 1.0,
  right: 1.0,
  center: 1.0,
  lfe: 0.0, // LFE is excluded
  leftSurround: 1.41, // +1.5 dB
  rightSurround: 1.41,
  leftBack: 1.41,
  rightBack: 1.41,
}

/** Get channel weight for multi-channel audio */
export function getChannelWeight(channelIndex: number, channelCount: number): number {
  switch (channelCount) {
    case 1: // Mono
      return 1.0
    case 2: // Stereo
      return 1.0
    case 6: // 5.1
      return [1.0, 1.0, 1.0, 0.0, 1.41, 1.41][channelIndex] ?? 1.0
    case 8: // 7.1
      return [1.0, 1.0, 1.0, 0.0, 1.41, 1.41, 1.41, 1.41][channelIndex] ?? 1.0
    default:
      return 1.0
  }
}

/** Calculate mean square of samples */
export function calculateMeanSquare(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return sum / samples.length
}

/** Calculate loudness in LUFS from mean square */
export function meanSquareToLufs(meanSquare: number): number {
  if (meanSquare <= 0) return -Infinity
  return -0.691 + 10 * Math.log10(meanSquare)
}

/** Measure momentary loudness (400ms window) */
export function measureMomentaryLoudness(
  channels: Float32Array[],
  sampleRate: number,
  offset: number = 0,
): number {
  const windowSize = Math.floor(sampleRate * 0.4) // 400ms
  let sumSquare = 0

  for (let ch = 0; ch < channels.length; ch++) {
    const weight = getChannelWeight(ch, channels.length)
    if (weight === 0) continue

    const weighted = applyKWeighting(
      channels[ch].slice(offset, offset + windowSize),
      sampleRate,
    )

    sumSquare += calculateMeanSquare(weighted) * weight
  }

  return meanSquareToLufs(sumSquare)
}

/** Measure short-term loudness (3s window) */
export function measureShortTermLoudness(
  channels: Float32Array[],
  sampleRate: number,
  offset: number = 0,
): number {
  const windowSize = Math.floor(sampleRate * 3) // 3s
  let sumSquare = 0

  for (let ch = 0; ch < channels.length; ch++) {
    const weight = getChannelWeight(ch, channels.length)
    if (weight === 0) continue

    const weighted = applyKWeighting(
      channels[ch].slice(offset, offset + windowSize),
      sampleRate,
    )

    sumSquare += calculateMeanSquare(weighted) * weight
  }

  return meanSquareToLufs(sumSquare)
}

/** Measure integrated loudness with gating (EBU R128) */
export function measureIntegratedLoudness(
  channels: Float32Array[],
  sampleRate: number,
): { integrated: number; gatedBlocks: number; totalBlocks: number } {
  const windowSize = Math.floor(sampleRate * 0.4) // 400ms
  const hopSize = Math.floor(sampleRate * 0.1) // 100ms overlap (75%)
  const sampleCount = channels[0].length

  // Pre-filter all channels
  const filteredChannels = channels.map((ch) => applyKWeighting(ch, sampleRate))

  // Calculate block loudness
  const blockLoudness: number[] = []

  for (let offset = 0; offset + windowSize <= sampleCount; offset += hopSize) {
    let sumSquare = 0

    for (let ch = 0; ch < filteredChannels.length; ch++) {
      const weight = getChannelWeight(ch, channels.length)
      if (weight === 0) continue

      const block = filteredChannels[ch].slice(offset, offset + windowSize)
      sumSquare += calculateMeanSquare(block) * weight
    }

    blockLoudness.push(meanSquareToLufs(sumSquare))
  }

  // Absolute gate (-70 LUFS)
  const absoluteThreshold = -70
  const afterAbsoluteGate = blockLoudness.filter((l) => l > absoluteThreshold)

  if (afterAbsoluteGate.length === 0) {
    return { integrated: -Infinity, gatedBlocks: 0, totalBlocks: blockLoudness.length }
  }

  // Calculate mean of blocks above absolute threshold
  const absoluteMean =
    afterAbsoluteGate.reduce((sum, l) => sum + Math.pow(10, l / 10), 0) / afterAbsoluteGate.length
  const absoluteMeanLufs = 10 * Math.log10(absoluteMean)

  // Relative gate (-10 LU below absolute mean)
  const relativeThreshold = absoluteMeanLufs - 10
  const afterRelativeGate = afterAbsoluteGate.filter((l) => l > relativeThreshold)

  if (afterRelativeGate.length === 0) {
    return { integrated: -Infinity, gatedBlocks: 0, totalBlocks: blockLoudness.length }
  }

  // Calculate integrated loudness
  const relativeMean =
    afterRelativeGate.reduce((sum, l) => sum + Math.pow(10, l / 10), 0) / afterRelativeGate.length
  const integrated = 10 * Math.log10(relativeMean)

  return {
    integrated,
    gatedBlocks: afterRelativeGate.length,
    totalBlocks: blockLoudness.length,
  }
}

/** Measure loudness range (LRA) */
export function measureLoudnessRange(
  channels: Float32Array[],
  sampleRate: number,
): number {
  const windowSize = Math.floor(sampleRate * 3) // 3s
  const hopSize = Math.floor(sampleRate * 1) // 1s overlap

  // Pre-filter all channels
  const filteredChannels = channels.map((ch) => applyKWeighting(ch, sampleRate))

  // Calculate short-term loudness values
  const shortTermValues: number[] = []

  for (let offset = 0; offset + windowSize <= filteredChannels[0].length; offset += hopSize) {
    let sumSquare = 0

    for (let ch = 0; ch < filteredChannels.length; ch++) {
      const weight = getChannelWeight(ch, channels.length)
      if (weight === 0) continue

      const block = filteredChannels[ch].slice(offset, offset + windowSize)
      sumSquare += calculateMeanSquare(block) * weight
    }

    shortTermValues.push(meanSquareToLufs(sumSquare))
  }

  if (shortTermValues.length === 0) return 0

  // Apply absolute gate (-70 LUFS)
  const afterAbsoluteGate = shortTermValues.filter((l) => l > -70)
  if (afterAbsoluteGate.length === 0) return 0

  // Calculate mean and relative gate
  const mean =
    afterAbsoluteGate.reduce((sum, l) => sum + Math.pow(10, l / 10), 0) / afterAbsoluteGate.length
  const meanLufs = 10 * Math.log10(mean)
  const relativeThreshold = meanLufs - 20

  const afterRelativeGate = afterAbsoluteGate.filter((l) => l > relativeThreshold)
  if (afterRelativeGate.length < 2) return 0

  // Sort and calculate LRA
  afterRelativeGate.sort((a, b) => a - b)
  const low = afterRelativeGate[Math.floor(afterRelativeGate.length * 0.1)]
  const high = afterRelativeGate[Math.floor(afterRelativeGate.length * 0.95)]

  return high - low
}

/** Measure true peak using oversampling */
export function measureTruePeak(samples: Float32Array, sampleRate: number): number {
  // Simple 4x oversampling with linear interpolation
  // A full implementation would use sinc interpolation
  const oversampleFactor = 4
  let maxPeak = 0

  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i]
    const s1 = samples[i + 1]

    for (let j = 0; j < oversampleFactor; j++) {
      const t = j / oversampleFactor
      const interpolated = s0 + (s1 - s0) * t
      const abs = Math.abs(interpolated)
      if (abs > maxPeak) maxPeak = abs
    }
  }

  // Also check last sample
  const lastAbs = Math.abs(samples[samples.length - 1])
  if (lastAbs > maxPeak) maxPeak = lastAbs

  return maxPeak > 0 ? 20 * Math.log10(maxPeak) : -Infinity
}

/** Measure sample peak */
export function measureSamplePeak(samples: Float32Array): number {
  let maxPeak = 0

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > maxPeak) maxPeak = abs
  }

  return maxPeak > 0 ? 20 * Math.log10(maxPeak) : -Infinity
}

// ============================================================================
// Complete Loudness Analysis
// ============================================================================

/** Perform complete loudness analysis */
export function analyzeLoudness(
  channels: Float32Array[],
  sampleRate: number,
): LoudnessResult {
  // Measure integrated loudness
  const { integrated } = measureIntegratedLoudness(channels, sampleRate)

  // Measure loudness range
  const range = measureLoudnessRange(channels, sampleRate)

  // Measure peaks
  let truePeak = -Infinity
  let samplePeak = -Infinity

  for (const channel of channels) {
    const tp = measureTruePeak(channel, sampleRate)
    const sp = measureSamplePeak(channel)
    if (tp > truePeak) truePeak = tp
    if (sp > samplePeak) samplePeak = sp
  }

  // Calculate momentary loudness over time
  const momentary: number[] = []
  const windowSize400ms = Math.floor(sampleRate * 0.4)
  const hopSize100ms = Math.floor(sampleRate * 0.1)

  for (let offset = 0; offset + windowSize400ms <= channels[0].length; offset += hopSize100ms) {
    momentary.push(measureMomentaryLoudness(channels, sampleRate, offset))
  }

  // Calculate short-term loudness over time
  const shortTerm: number[] = []
  const windowSize3s = Math.floor(sampleRate * 3)
  const hopSize1s = Math.floor(sampleRate * 1)

  for (let offset = 0; offset + windowSize3s <= channels[0].length; offset += hopSize1s) {
    shortTerm.push(measureShortTermLoudness(channels, sampleRate, offset))
  }

  return {
    integrated,
    range,
    truePeak,
    samplePeak,
    momentary,
    shortTerm,
  }
}

// ============================================================================
// Loudness Normalization
// ============================================================================

/** Calculate gain needed for loudness normalization */
export function calculateNormalizationGain(
  currentLufs: number,
  currentTruePeak: number,
  options: LoudnessNormOptions = {},
): number {
  const targetLufs = options.targetLufs ?? -14
  const targetPeak = options.targetPeak ?? -1.0
  const mode = options.mode ?? 'dual'
  const allowUpward = options.allowUpward ?? true
  const maxGain = options.maxGain ?? 20

  // Calculate gain needed for integrated loudness target
  const integratedGain = targetLufs - currentLufs

  // Calculate gain needed for peak limiting
  const peakGain = targetPeak - currentTruePeak

  // Apply gain based on mode
  let gain: number

  switch (mode) {
    case 'integrated':
      gain = integratedGain
      break
    case 'peak':
      gain = peakGain
      break
    case 'dual':
    default:
      // Use the smaller gain to satisfy both constraints
      gain = Math.min(integratedGain, peakGain)
      break
  }

  // Apply constraints
  if (!allowUpward && gain > 0) {
    gain = 0
  }

  if (Math.abs(gain) > maxGain) {
    gain = gain > 0 ? maxGain : -maxGain
  }

  return gain
}

/** Apply gain to audio samples */
export function applyGain(samples: Float32Array, gainDb: number): Float32Array {
  const linearGain = Math.pow(10, gainDb / 20)
  const output = new Float32Array(samples.length)

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * linearGain
  }

  return output
}

/** Normalize audio to target loudness */
export function normalizeLoudness(
  channels: Float32Array[],
  sampleRate: number,
  options: LoudnessNormOptions = {},
): { channels: Float32Array[]; gainApplied: number; before: LoudnessResult; after: LoudnessResult } {
  // Analyze current loudness
  const before = analyzeLoudness(channels, sampleRate)

  // Calculate required gain
  const gainDb = calculateNormalizationGain(before.integrated, before.truePeak, options)

  // Apply gain to all channels
  const normalizedChannels = channels.map((ch) => applyGain(ch, gainDb))

  // Analyze after normalization
  const after = analyzeLoudness(normalizedChannels, sampleRate)

  return {
    channels: normalizedChannels,
    gainApplied: gainDb,
    before,
    after,
  }
}

// ============================================================================
// Streaming Loudness Meter
// ============================================================================

/** Real-time loudness meter for streaming analysis */
export class LoudnessMeter {
  private sampleRate: number
  private channelCount: number
  private windowSize400ms: number
  private windowSize3s: number

  private buffers: Float32Array[]
  private writeIndex: number = 0
  private samplesProcessed: number = 0

  private momentaryHistory: number[] = []
  private shortTermHistory: number[] = []

  constructor(sampleRate: number, channelCount: number) {
    this.sampleRate = sampleRate
    this.channelCount = channelCount
    this.windowSize400ms = Math.floor(sampleRate * 0.4)
    this.windowSize3s = Math.floor(sampleRate * 3)

    // Create circular buffers for 3 seconds of audio
    this.buffers = []
    for (let i = 0; i < channelCount; i++) {
      this.buffers.push(new Float32Array(this.windowSize3s))
    }
  }

  /** Add samples to the meter */
  push(samples: Float32Array[]): void {
    for (let ch = 0; ch < this.channelCount; ch++) {
      const input = samples[ch]
      const buffer = this.buffers[ch]

      for (let i = 0; i < input.length; i++) {
        buffer[(this.writeIndex + i) % this.windowSize3s] = input[i]
      }
    }

    this.writeIndex = (this.writeIndex + samples[0].length) % this.windowSize3s
    this.samplesProcessed += samples[0].length
  }

  /** Get current momentary loudness */
  getMomentaryLoudness(): number {
    if (this.samplesProcessed < this.windowSize400ms) return -Infinity

    const startIndex =
      (this.writeIndex - this.windowSize400ms + this.windowSize3s) % this.windowSize3s

    let sumSquare = 0

    for (let ch = 0; ch < this.channelCount; ch++) {
      const weight = getChannelWeight(ch, this.channelCount)
      if (weight === 0) continue

      // Extract window from circular buffer
      const window = new Float32Array(this.windowSize400ms)
      for (let i = 0; i < this.windowSize400ms; i++) {
        window[i] = this.buffers[ch][(startIndex + i) % this.windowSize3s]
      }

      const weighted = applyKWeighting(window, this.sampleRate)
      sumSquare += calculateMeanSquare(weighted) * weight
    }

    return meanSquareToLufs(sumSquare)
  }

  /** Get current short-term loudness */
  getShortTermLoudness(): number {
    if (this.samplesProcessed < this.windowSize3s) return -Infinity

    let sumSquare = 0

    for (let ch = 0; ch < this.channelCount; ch++) {
      const weight = getChannelWeight(ch, this.channelCount)
      if (weight === 0) continue

      const weighted = applyKWeighting(this.buffers[ch], this.sampleRate)
      sumSquare += calculateMeanSquare(weighted) * weight
    }

    return meanSquareToLufs(sumSquare)
  }

  /** Reset the meter */
  reset(): void {
    for (const buffer of this.buffers) {
      buffer.fill(0)
    }
    this.writeIndex = 0
    this.samplesProcessed = 0
    this.momentaryHistory = []
    this.shortTermHistory = []
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Convert LUFS to dB relative to target */
export function lufsToDbRelative(lufs: number, target: number): number {
  return lufs - target
}

/** Format loudness value for display */
export function formatLoudness(lufs: number, decimals: number = 1): string {
  if (!isFinite(lufs)) return '-∞ LUFS'
  return `${lufs.toFixed(decimals)} LUFS`
}

/** Format peak value for display */
export function formatPeak(dbtp: number, decimals: number = 1): string {
  if (!isFinite(dbtp)) return '-∞ dBTP'
  return `${dbtp.toFixed(decimals)} dBTP`
}

/** Check if loudness meets EBU R128 broadcast standards */
export function meetsEbuR128(result: LoudnessResult): {
  passes: boolean
  issues: string[]
} {
  const issues: string[] = []

  // Target: -23 LUFS ±0.5 LU
  if (result.integrated < -23.5 || result.integrated > -22.5) {
    issues.push(`Integrated loudness ${result.integrated.toFixed(1)} LUFS is outside -23 ±0.5 LU`)
  }

  // True peak: max -1 dBTP
  if (result.truePeak > -1.0) {
    issues.push(`True peak ${result.truePeak.toFixed(1)} dBTP exceeds -1 dBTP`)
  }

  // LRA: typically 5-20 LU (informative, not mandatory)
  if (result.range > 20) {
    issues.push(`Loudness range ${result.range.toFixed(1)} LU exceeds recommended 20 LU`)
  }

  return {
    passes: issues.length === 0,
    issues,
  }
}

/** Get recommended target loudness for platform */
export function getTargetLoudness(
  platform: 'broadcast' | 'streaming' | 'podcast' | 'cinema' | 'mobile',
): { lufs: number; truePeak: number } {
  switch (platform) {
    case 'broadcast':
      return { lufs: -23, truePeak: -1.0 } // EBU R128
    case 'streaming':
      return { lufs: -14, truePeak: -1.0 } // Spotify, YouTube
    case 'podcast':
      return { lufs: -16, truePeak: -1.0 } // Apple Podcasts
    case 'cinema':
      return { lufs: -24, truePeak: -1.0 } // SMPTE RP 200
    case 'mobile':
      return { lufs: -14, truePeak: -2.0 } // Mobile with headroom
    default:
      return { lufs: -14, truePeak: -1.0 }
  }
}
