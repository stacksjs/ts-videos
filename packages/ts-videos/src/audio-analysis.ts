/**
 * Comprehensive audio analysis utilities
 * Similar to mediabunny's audio analysis system
 */

import type { AudioSample } from './types'

/**
 * Audio level measurement
 */
export interface AudioLevels {
  /** Peak amplitude (0-1) */
  peak: number
  /** Peak in dBFS */
  peakDb: number
  /** RMS (root mean square) level (0-1) */
  rms: number
  /** RMS in dBFS */
  rmsDb: number
  /** True peak (intersample) level (0-1) */
  truePeak?: number
  /** True peak in dBFS */
  truePeakDb?: number
}

/**
 * Loudness measurement (ITU-R BS.1770 compatible)
 */
export interface LoudnessMeasurement {
  /** Integrated loudness in LUFS */
  integrated: number
  /** Loudness range in LU */
  range: number
  /** Short-term loudness in LUFS */
  shortTerm: number
  /** Momentary loudness in LUFS */
  momentary: number
  /** True peak in dBTP */
  truePeak: number
}

/**
 * Spectral analysis result
 */
export interface SpectralAnalysis {
  /** Frequency bins */
  frequencies: Float32Array
  /** Magnitude for each frequency bin */
  magnitudes: Float32Array
  /** Phase for each frequency bin */
  phases?: Float32Array
  /** Spectral centroid */
  centroid: number
  /** Spectral spread */
  spread: number
  /** Spectral rolloff frequency */
  rolloff: number
  /** Spectral flatness (0-1, 0 = tonal, 1 = noise) */
  flatness: number
}

/**
 * Beat detection result
 */
export interface BeatInfo {
  /** Estimated BPM */
  bpm: number
  /** Confidence of BPM estimate (0-1) */
  confidence: number
  /** Beat timestamps in seconds */
  beats: number[]
  /** Time signature estimate */
  timeSignature?: { numerator: number; denominator: number }
}

/**
 * Silence detection result
 */
export interface SilenceRegion {
  /** Start time in seconds */
  start: number
  /** End time in seconds */
  end: number
  /** Duration in seconds */
  duration: number
  /** Average level during silence */
  averageLevel: number
}

/**
 * Audio statistics
 */
export interface AudioStats {
  /** Duration in seconds */
  duration: number
  /** Sample rate */
  sampleRate: number
  /** Number of channels */
  channels: number
  /** Total number of samples */
  totalSamples: number
  /** DC offset per channel */
  dcOffset: number[]
  /** Crest factor (peak/rms) per channel */
  crestFactor: number[]
  /** Dynamic range in dB */
  dynamicRange: number
  /** Zero crossing rate per channel */
  zeroCrossingRate: number[]
  /** Clipping percentage */
  clippingPercent: number
}

/**
 * AudioAnalyzer - Comprehensive audio analysis
 */
export class AudioAnalyzer {
  private samples: Float32Array[] = []
  private sampleRate = 44100
  private channels = 2
  private totalSamples = 0

  /**
   * Add audio samples for analysis
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
   * Analyze from async sample stream
   */
  async analyzeStream(samples: AsyncIterable<AudioSample>): Promise<void> {
    for await (const sample of samples) {
      this.addSamples(sample)
    }
  }

  /**
   * Get audio levels
   */
  getLevels(channel?: number): AudioLevels {
    const data = this.flattenSamples()

    let peak = 0
    let sumSquares = 0
    let count = 0

    if (channel !== undefined && channel >= 0 && channel < this.channels) {
      // Analyze specific channel
      for (let i = channel; i < data.length; i += this.channels) {
        const value = Math.abs(data[i])
        peak = Math.max(peak, value)
        sumSquares += data[i] * data[i]
        count++
      }
    }
    else {
      // Analyze all samples
      for (let i = 0; i < data.length; i++) {
        const value = Math.abs(data[i])
        peak = Math.max(peak, value)
        sumSquares += data[i] * data[i]
        count++
      }
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0

    return {
      peak,
      peakDb: this.toDb(peak),
      rms,
      rmsDb: this.toDb(rms),
    }
  }

  /**
   * Get comprehensive audio statistics
   */
  getStats(): AudioStats {
    const data = this.flattenSamples()
    const channelStats: Array<{
      sum: number
      sumSquares: number
      peak: number
      zeroCrossings: number
      clippedSamples: number
      count: number
      prevSign: number
    }> = []

    // Initialize per-channel stats
    for (let ch = 0; ch < this.channels; ch++) {
      channelStats.push({
        sum: 0,
        sumSquares: 0,
        peak: 0,
        zeroCrossings: 0,
        clippedSamples: 0,
        count: 0,
        prevSign: 0,
      })
    }

    // Collect stats
    for (let i = 0; i < data.length; i++) {
      const ch = i % this.channels
      const value = data[i]
      const stats = channelStats[ch]

      stats.sum += value
      stats.sumSquares += value * value
      stats.peak = Math.max(stats.peak, Math.abs(value))
      stats.count++

      // Zero crossing detection
      const sign = value >= 0 ? 1 : -1
      if (stats.prevSign !== 0 && sign !== stats.prevSign) {
        stats.zeroCrossings++
      }
      stats.prevSign = sign

      // Clipping detection
      if (Math.abs(value) >= 0.999) {
        stats.clippedSamples++
      }
    }

    // Calculate derived stats
    const dcOffset = channelStats.map(s => s.count > 0 ? s.sum / s.count : 0)
    const rmsValues = channelStats.map(s => s.count > 0 ? Math.sqrt(s.sumSquares / s.count) : 0)
    const crestFactor = channelStats.map((s, i) => rmsValues[i] > 0 ? s.peak / rmsValues[i] : 0)
    const zeroCrossingRate = channelStats.map(s => s.count > 1 ? s.zeroCrossings / (s.count - 1) : 0)

    const totalClipped = channelStats.reduce((sum, s) => sum + s.clippedSamples, 0)
    const clippingPercent = data.length > 0 ? (totalClipped / data.length) * 100 : 0

    // Dynamic range calculation
    const overallPeak = Math.max(...channelStats.map(s => s.peak))
    const overallRms = Math.sqrt(rmsValues.reduce((sum, r) => sum + r * r, 0) / rmsValues.length)
    const dynamicRange = overallPeak > 0 && overallRms > 0
      ? this.toDb(overallPeak) - this.toDb(overallRms)
      : 0

    return {
      duration: this.totalSamples / this.sampleRate,
      sampleRate: this.sampleRate,
      channels: this.channels,
      totalSamples: this.totalSamples,
      dcOffset,
      crestFactor,
      dynamicRange,
      zeroCrossingRate,
      clippingPercent,
    }
  }

  /**
   * Detect silence regions
   */
  detectSilence(options: {
    threshold?: number
    minDuration?: number
    attackTime?: number
    releaseTime?: number
  } = {}): SilenceRegion[] {
    const {
      threshold = -60, // dBFS
      minDuration = 0.5, // seconds
      attackTime = 0.01,
      releaseTime = 0.1,
    } = options

    const data = this.flattenSamples()
    const windowSize = Math.floor(this.sampleRate * 0.01) // 10ms windows
    const thresholdLinear = this.fromDb(threshold)
    const regions: SilenceRegion[] = []

    let inSilence = false
    let silenceStart = 0
    let silenceSum = 0
    let silenceSamples = 0

    for (let i = 0; i < data.length; i += windowSize * this.channels) {
      // Calculate RMS for this window
      let sumSquares = 0
      let count = 0
      const windowEnd = Math.min(i + windowSize * this.channels, data.length)

      for (let j = i; j < windowEnd; j++) {
        sumSquares += data[j] * data[j]
        count++
      }

      const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0
      const currentTime = (i / this.channels) / this.sampleRate

      if (rms < thresholdLinear) {
        if (!inSilence) {
          inSilence = true
          silenceStart = currentTime
          silenceSum = 0
          silenceSamples = 0
        }
        silenceSum += rms
        silenceSamples++
      }
      else if (inSilence) {
        const duration = currentTime - silenceStart
        if (duration >= minDuration) {
          regions.push({
            start: silenceStart,
            end: currentTime,
            duration,
            averageLevel: silenceSamples > 0 ? silenceSum / silenceSamples : 0,
          })
        }
        inSilence = false
      }
    }

    // Check if audio ends with silence
    if (inSilence) {
      const endTime = this.totalSamples / this.sampleRate
      const duration = endTime - silenceStart
      if (duration >= minDuration) {
        regions.push({
          start: silenceStart,
          end: endTime,
          duration,
          averageLevel: silenceSamples > 0 ? silenceSum / silenceSamples : 0,
        })
      }
    }

    return regions
  }

  /**
   * Perform spectral analysis using FFT
   */
  getSpectrum(options: {
    windowSize?: number
    hopSize?: number
    windowFunction?: 'hann' | 'hamming' | 'blackman' | 'rectangular'
    startTime?: number
    endTime?: number
  } = {}): SpectralAnalysis {
    const {
      windowSize = 2048,
      windowFunction = 'hann',
      startTime = 0,
    } = options

    const data = this.flattenSamples()
    const startSample = Math.floor(startTime * this.sampleRate) * this.channels
    const endSample = Math.min(startSample + windowSize * this.channels, data.length)

    // Extract mono signal for analysis
    const signal = new Float32Array(windowSize)
    for (let i = 0; i < windowSize && startSample + i * this.channels < endSample; i++) {
      let sum = 0
      for (let ch = 0; ch < this.channels; ch++) {
        sum += data[startSample + i * this.channels + ch] ?? 0
      }
      signal[i] = sum / this.channels
    }

    // Apply window function
    this.applyWindow(signal, windowFunction)

    // Compute FFT (simplified DFT for demonstration - in production use FFT library)
    const { magnitudes, phases } = this.computeDFT(signal)

    // Calculate frequency bins
    const frequencies = new Float32Array(windowSize / 2)
    for (let i = 0; i < frequencies.length; i++) {
      frequencies[i] = (i * this.sampleRate) / windowSize
    }

    // Calculate spectral features
    const centroid = this.calculateSpectralCentroid(frequencies, magnitudes)
    const spread = this.calculateSpectralSpread(frequencies, magnitudes, centroid)
    const rolloff = this.calculateSpectralRolloff(frequencies, magnitudes, 0.85)
    const flatness = this.calculateSpectralFlatness(magnitudes)

    return {
      frequencies,
      magnitudes,
      phases,
      centroid,
      spread,
      rolloff,
      flatness,
    }
  }

  /**
   * Detect beats and estimate BPM
   */
  detectBeats(options: {
    minBpm?: number
    maxBpm?: number
    sensitivity?: number
  } = {}): BeatInfo {
    const {
      minBpm = 60,
      maxBpm = 200,
      sensitivity = 0.5,
    } = options

    const data = this.flattenSamples()

    // Calculate onset strength function using energy difference
    const hopSize = Math.floor(this.sampleRate * 0.01) // 10ms hop
    const onsetStrength: number[] = []
    let prevEnergy = 0

    for (let i = 0; i < data.length - hopSize * this.channels; i += hopSize * this.channels) {
      let energy = 0
      for (let j = 0; j < hopSize * this.channels; j++) {
        energy += data[i + j] * data[i + j]
      }
      energy /= hopSize * this.channels

      const onset = Math.max(0, energy - prevEnergy)
      onsetStrength.push(onset)
      prevEnergy = energy
    }

    // Autocorrelation to find periodicity
    const minLag = Math.floor((60 / maxBpm) * (this.sampleRate / hopSize))
    const maxLag = Math.floor((60 / minBpm) * (this.sampleRate / hopSize))

    let bestLag = minLag
    let bestCorrelation = -Infinity

    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0
      for (let i = 0; i < onsetStrength.length - lag; i++) {
        correlation += onsetStrength[i] * onsetStrength[i + lag]
      }

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation
        bestLag = lag
      }
    }

    const bpm = (60 * this.sampleRate) / (bestLag * hopSize)

    // Find beat times using onset detection
    const beats: number[] = []
    const threshold = this.calculateAdaptiveThreshold(onsetStrength, sensitivity)

    for (let i = 1; i < onsetStrength.length - 1; i++) {
      if (onsetStrength[i] > threshold &&
          onsetStrength[i] > onsetStrength[i - 1] &&
          onsetStrength[i] > onsetStrength[i + 1]) {
        beats.push((i * hopSize) / this.sampleRate)
      }
    }

    // Calculate confidence based on correlation strength
    const maxPossibleCorrelation = onsetStrength.reduce((sum, v) => sum + v * v, 0)
    const confidence = maxPossibleCorrelation > 0 ? Math.min(1, bestCorrelation / maxPossibleCorrelation * 2) : 0

    return {
      bpm: Math.round(bpm * 10) / 10,
      confidence,
      beats,
    }
  }

  /**
   * Calculate loudness (simplified LUFS-like measurement)
   */
  getLoudness(): LoudnessMeasurement {
    const data = this.flattenSamples()

    // K-weighted filter approximation (simplified)
    // In production, implement proper K-weighting filter
    const filtered = this.applyKWeighting(data)

    // Calculate momentary loudness (400ms windows)
    const momentaryWindow = Math.floor(this.sampleRate * 0.4) * this.channels
    const shortTermWindow = Math.floor(this.sampleRate * 3) * this.channels

    let momentaryMax = -Infinity
    let shortTermMax = -Infinity
    const blockLoudness: number[] = []

    for (let i = 0; i < filtered.length - momentaryWindow; i += momentaryWindow / 4) {
      let sumSquares = 0
      const windowEnd = Math.min(i + momentaryWindow, filtered.length)

      for (let j = i; j < windowEnd; j++) {
        sumSquares += filtered[j] * filtered[j]
      }

      const meanSquare = sumSquares / (windowEnd - i)
      const loudness = -0.691 + 10 * Math.log10(meanSquare || 1e-10)

      momentaryMax = Math.max(momentaryMax, loudness)
      blockLoudness.push(loudness)
    }

    // Short-term loudness (3s windows)
    for (let i = 0; i < filtered.length - shortTermWindow; i += shortTermWindow / 4) {
      let sumSquares = 0
      const windowEnd = Math.min(i + shortTermWindow, filtered.length)

      for (let j = i; j < windowEnd; j++) {
        sumSquares += filtered[j] * filtered[j]
      }

      const meanSquare = sumSquares / (windowEnd - i)
      const loudness = -0.691 + 10 * Math.log10(meanSquare || 1e-10)
      shortTermMax = Math.max(shortTermMax, loudness)
    }

    // Integrated loudness (gated)
    const sortedLoudness = [...blockLoudness].sort((a, b) => a - b)
    const absoluteThreshold = -70 // LUFS

    const gatedBlocks = sortedLoudness.filter(l => l > absoluteThreshold)
    const relativeThreshold = gatedBlocks.length > 0
      ? gatedBlocks.reduce((sum, l) => sum + l, 0) / gatedBlocks.length - 10
      : absoluteThreshold

    const finalGated = gatedBlocks.filter(l => l > relativeThreshold)
    const integrated = finalGated.length > 0
      ? finalGated.reduce((sum, l) => sum + l, 0) / finalGated.length
      : -70

    // Loudness range
    const p10 = sortedLoudness[Math.floor(sortedLoudness.length * 0.1)] ?? -70
    const p95 = sortedLoudness[Math.floor(sortedLoudness.length * 0.95)] ?? 0
    const range = p95 - p10

    // True peak
    let truePeak = 0
    for (let i = 0; i < data.length; i++) {
      truePeak = Math.max(truePeak, Math.abs(data[i]))
    }

    return {
      integrated,
      range: Math.max(0, range),
      shortTerm: isFinite(shortTermMax) ? shortTermMax : -70,
      momentary: isFinite(momentaryMax) ? momentaryMax : -70,
      truePeak: this.toDb(truePeak),
    }
  }

  /**
   * Clear all samples
   */
  clear(): void {
    this.samples = []
    this.totalSamples = 0
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

  private toDb(linear: number): number {
    return linear > 0 ? 20 * Math.log10(linear) : -Infinity
  }

  private fromDb(db: number): number {
    return 10 ** (db / 20)
  }

  private applyWindow(signal: Float32Array, type: string): void {
    const N = signal.length

    for (let i = 0; i < N; i++) {
      let window = 1

      switch (type) {
        case 'hann':
          window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
          break
        case 'hamming':
          window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1))
          break
        case 'blackman':
          window = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) +
                   0.08 * Math.cos((4 * Math.PI * i) / (N - 1))
          break
      }

      signal[i] *= window
    }
  }

  private computeDFT(signal: Float32Array): { magnitudes: Float32Array; phases: Float32Array } {
    const N = signal.length
    const halfN = N / 2
    const magnitudes = new Float32Array(halfN)
    const phases = new Float32Array(halfN)

    for (let k = 0; k < halfN; k++) {
      let real = 0
      let imag = 0

      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * k * n) / N
        real += signal[n] * Math.cos(angle)
        imag -= signal[n] * Math.sin(angle)
      }

      magnitudes[k] = Math.sqrt(real * real + imag * imag) / N
      phases[k] = Math.atan2(imag, real)
    }

    return { magnitudes, phases }
  }

  private calculateSpectralCentroid(frequencies: Float32Array, magnitudes: Float32Array): number {
    let weightedSum = 0
    let magnitudeSum = 0

    for (let i = 0; i < frequencies.length; i++) {
      weightedSum += frequencies[i] * magnitudes[i]
      magnitudeSum += magnitudes[i]
    }

    return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0
  }

  private calculateSpectralSpread(
    frequencies: Float32Array,
    magnitudes: Float32Array,
    centroid: number,
  ): number {
    let weightedVariance = 0
    let magnitudeSum = 0

    for (let i = 0; i < frequencies.length; i++) {
      const diff = frequencies[i] - centroid
      weightedVariance += diff * diff * magnitudes[i]
      magnitudeSum += magnitudes[i]
    }

    return magnitudeSum > 0 ? Math.sqrt(weightedVariance / magnitudeSum) : 0
  }

  private calculateSpectralRolloff(
    frequencies: Float32Array,
    magnitudes: Float32Array,
    threshold: number,
  ): number {
    let totalEnergy = 0
    for (const mag of magnitudes) {
      totalEnergy += mag * mag
    }

    let cumulativeEnergy = 0
    for (let i = 0; i < frequencies.length; i++) {
      cumulativeEnergy += magnitudes[i] * magnitudes[i]
      if (cumulativeEnergy >= threshold * totalEnergy) {
        return frequencies[i]
      }
    }

    return frequencies[frequencies.length - 1]
  }

  private calculateSpectralFlatness(magnitudes: Float32Array): number {
    let geometricMean = 0
    let arithmeticMean = 0
    let nonZeroCount = 0

    for (const mag of magnitudes) {
      if (mag > 0) {
        geometricMean += Math.log(mag)
        arithmeticMean += mag
        nonZeroCount++
      }
    }

    if (nonZeroCount === 0) return 0

    geometricMean = Math.exp(geometricMean / nonZeroCount)
    arithmeticMean /= nonZeroCount

    return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0
  }

  private calculateAdaptiveThreshold(values: number[], sensitivity: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)

    return median + std * (1 - sensitivity) * 2
  }

  private applyKWeighting(data: Float32Array): Float32Array {
    // Simplified K-weighting approximation
    // In production, implement proper biquad filters for K-weighting
    const result = new Float32Array(data.length)

    // High-shelf boost at high frequencies (simplified)
    let prevIn = 0
    let prevOut = 0
    const alpha = 0.1

    for (let i = 0; i < data.length; i++) {
      const input = data[i]
      result[i] = input + alpha * (input - prevIn) + (1 - alpha) * prevOut
      prevIn = input
      prevOut = result[i]
    }

    return result
  }
}

/**
 * Convenience function to analyze audio samples
 */
export function analyzeAudio(samples: AudioSample[]): AudioStats {
  const analyzer = new AudioAnalyzer()

  for (const sample of samples) {
    analyzer.addSamples(sample)
  }

  return analyzer.getStats()
}

/**
 * Convenience function to detect silence
 */
export function detectSilence(
  samples: AudioSample[],
  options?: Parameters<AudioAnalyzer['detectSilence']>[0],
): SilenceRegion[] {
  const analyzer = new AudioAnalyzer()

  for (const sample of samples) {
    analyzer.addSamples(sample)
  }

  return analyzer.detectSilence(options)
}

/**
 * Convenience function to detect beats
 */
export function detectBeats(
  samples: AudioSample[],
  options?: Parameters<AudioAnalyzer['detectBeats']>[0],
): BeatInfo {
  const analyzer = new AudioAnalyzer()

  for (const sample of samples) {
    analyzer.addSamples(sample)
  }

  return analyzer.detectBeats(options)
}

/**
 * Convenience function to measure loudness
 */
export function measureLoudness(samples: AudioSample[]): LoudnessMeasurement {
  const analyzer = new AudioAnalyzer()

  for (const sample of samples) {
    analyzer.addSamples(sample)
  }

  return analyzer.getLoudness()
}
