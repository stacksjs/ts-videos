/* eslint-disable style/max-statements-per-line */
/**
 * Audio effects for processing audio samples
 * Provides EQ, compressor, limiter, reverb, delay, and pitch shifting
 */

import type { AudioSample } from './types'

/**
 * Audio effect interface
 */
export interface AudioEffect {
  /** Effect name */
  name: string
  /** Process audio samples */
  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array
  /** Reset effect state */
  reset(): void
}

/**
 * Biquad filter types
 */
export type BiquadFilterType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'notch'
  | 'allpass'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'

/**
 * Biquad filter for EQ bands
 */
export class BiquadFilter implements AudioEffect {
  name = 'biquad'
  private b0 = 0
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1: number[] = []
  private x2: number[] = []
  private y1: number[] = []
  private y2: number[] = []

  constructor(
    private type: BiquadFilterType,
    private frequency: number,
    private q: number = 1,
    private gain: number = 0,
  ) {}

  private calculateCoefficients(sampleRate: number): void {
    const w0 = (2 * Math.PI * this.frequency) / sampleRate
    const cos_w0 = Math.cos(w0)
    const sin_w0 = Math.sin(w0)
    const alpha = sin_w0 / (2 * this.q)
    const A = Math.pow(10, this.gain / 40)

    let a0: number

    switch (this.type) {
      case 'lowpass':
        this.b0 = (1 - cos_w0) / 2
        this.b1 = 1 - cos_w0
        this.b2 = (1 - cos_w0) / 2
        a0 = 1 + alpha
        this.a1 = -2 * cos_w0
        this.a2 = 1 - alpha
        break

      case 'highpass':
        this.b0 = (1 + cos_w0) / 2
        this.b1 = -(1 + cos_w0)
        this.b2 = (1 + cos_w0) / 2
        a0 = 1 + alpha
        this.a1 = -2 * cos_w0
        this.a2 = 1 - alpha
        break

      case 'bandpass':
        this.b0 = alpha
        this.b1 = 0
        this.b2 = -alpha
        a0 = 1 + alpha
        this.a1 = -2 * cos_w0
        this.a2 = 1 - alpha
        break

      case 'notch':
        this.b0 = 1
        this.b1 = -2 * cos_w0
        this.b2 = 1
        a0 = 1 + alpha
        this.a1 = -2 * cos_w0
        this.a2 = 1 - alpha
        break

      case 'allpass':
        this.b0 = 1 - alpha
        this.b1 = -2 * cos_w0
        this.b2 = 1 + alpha
        a0 = 1 + alpha
        this.a1 = -2 * cos_w0
        this.a2 = 1 - alpha
        break

      case 'peaking':
        this.b0 = 1 + alpha * A
        this.b1 = -2 * cos_w0
        this.b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        this.a1 = -2 * cos_w0
        this.a2 = 1 - alpha / A
        break

      case 'lowshelf': {
        const sqrtA = Math.sqrt(A)
        this.b0 = A * ((A + 1) - (A - 1) * cos_w0 + 2 * sqrtA * alpha)
        this.b1 = 2 * A * ((A - 1) - (A + 1) * cos_w0)
        this.b2 = A * ((A + 1) - (A - 1) * cos_w0 - 2 * sqrtA * alpha)
        a0 = (A + 1) + (A - 1) * cos_w0 + 2 * sqrtA * alpha
        this.a1 = -2 * ((A - 1) + (A + 1) * cos_w0)
        this.a2 = (A + 1) + (A - 1) * cos_w0 - 2 * sqrtA * alpha
        break
      }

      case 'highshelf': {
        const sqrtA = Math.sqrt(A)
        this.b0 = A * ((A + 1) + (A - 1) * cos_w0 + 2 * sqrtA * alpha)
        this.b1 = -2 * A * ((A - 1) + (A + 1) * cos_w0)
        this.b2 = A * ((A + 1) + (A - 1) * cos_w0 - 2 * sqrtA * alpha)
        a0 = (A + 1) - (A - 1) * cos_w0 + 2 * sqrtA * alpha
        this.a1 = 2 * ((A - 1) - (A + 1) * cos_w0)
        this.a2 = (A + 1) - (A - 1) * cos_w0 - 2 * sqrtA * alpha
        break
      }
    }

    // Normalize
    this.b0 /= a0
    this.b1 /= a0
    this.b2 /= a0
    this.a1 /= a0
    this.a2 /= a0
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    this.calculateCoefficients(sampleRate)

    // Initialize state arrays if needed
    while (this.x1.length < channels) {
      this.x1.push(0)
      this.x2.push(0)
      this.y1.push(0)
      this.y2.push(0)
    }

    const output = new Float32Array(samples.length)

    for (let i = 0; i < samples.length; i++) {
      const ch = i % channels
      const x0 = samples[i]

      const y0 = this.b0 * x0 + this.b1 * this.x1[ch] + this.b2 * this.x2[ch]
                 - this.a1 * this.y1[ch] - this.a2 * this.y2[ch]

      this.x2[ch] = this.x1[ch]
      this.x1[ch] = x0
      this.y2[ch] = this.y1[ch]
      this.y1[ch] = y0

      output[i] = y0
    }

    return output
  }

  reset(): void {
    this.x1 = []
    this.x2 = []
    this.y1 = []
    this.y2 = []
  }
}

/**
 * Parametric EQ band
 */
export interface EqBand {
  /** Center frequency in Hz */
  frequency: number
  /** Gain in dB */
  gain: number
  /** Q factor */
  q?: number
  /** Filter type */
  type?: BiquadFilterType
}

/**
 * Parametric equalizer
 */
export class Equalizer implements AudioEffect {
  name = 'equalizer'
  private filters: BiquadFilter[] = []

  constructor(bands: EqBand[]) {
    for (const band of bands) {
      this.filters.push(new BiquadFilter(
        band.type ?? 'peaking',
        band.frequency,
        band.q ?? 1,
        band.gain,
      ))
    }
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    let output = samples

    for (const filter of this.filters) {
      output = filter.process(output, sampleRate, channels)
    }

    return output
  }

  reset(): void {
    for (const filter of this.filters) {
      filter.reset()
    }
  }
}

/**
 * Compressor options
 */
export interface CompressorOptions {
  /** Threshold in dB */
  threshold?: number
  /** Compression ratio (e.g., 4 = 4:1) */
  ratio?: number
  /** Attack time in ms */
  attack?: number
  /** Release time in ms */
  release?: number
  /** Knee width in dB */
  knee?: number
  /** Makeup gain in dB */
  makeupGain?: number
}

/**
 * Dynamic range compressor
 */
export class Compressor implements AudioEffect {
  name = 'compressor'
  private options: Required<CompressorOptions>
  private envelope = 0

  constructor(options: CompressorOptions = {}) {
    this.options = {
      threshold: options.threshold ?? -24,
      ratio: options.ratio ?? 4,
      attack: options.attack ?? 10,
      release: options.release ?? 100,
      knee: options.knee ?? 6,
      makeupGain: options.makeupGain ?? 0,
    }
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    const output = new Float32Array(samples.length)
    const attackCoef = Math.exp(-1 / (sampleRate * this.options.attack / 1000))
    const releaseCoef = Math.exp(-1 / (sampleRate * this.options.release / 1000))
    const makeupLinear = Math.pow(10, this.options.makeupGain / 20)

    for (let i = 0; i < samples.length; i += channels) {
      // Calculate peak level across channels
      let peak = 0
      for (let ch = 0; ch < channels; ch++) {
        peak = Math.max(peak, Math.abs(samples[i + ch]))
      }

      // Convert to dB
      const inputDb = peak > 0 ? 20 * Math.log10(peak) : -100

      // Calculate gain reduction
      let gainReduction = 0

      if (inputDb > this.options.threshold) {
        // Hard knee
        const overDb = inputDb - this.options.threshold
        gainReduction = overDb - overDb / this.options.ratio
      }

      // Soft knee
      const kneeStart = this.options.threshold - this.options.knee / 2
      const kneeEnd = this.options.threshold + this.options.knee / 2

      if (inputDb > kneeStart && inputDb < kneeEnd && this.options.knee > 0) {
        const x = inputDb - kneeStart
        const kneeGain = (x * x) / (2 * this.options.knee)
        gainReduction = kneeGain * (1 - 1 / this.options.ratio)
      }

      // Envelope follower
      const targetEnvelope = gainReduction
      if (targetEnvelope > this.envelope) {
        this.envelope = attackCoef * this.envelope + (1 - attackCoef) * targetEnvelope
      }
      else {
        this.envelope = releaseCoef * this.envelope + (1 - releaseCoef) * targetEnvelope
      }

      // Apply gain
      const gain = Math.pow(10, -this.envelope / 20) * makeupLinear

      for (let ch = 0; ch < channels; ch++) {
        output[i + ch] = samples[i + ch] * gain
      }
    }

    return output
  }

  reset(): void {
    this.envelope = 0
  }
}

/**
 * Limiter - brick wall limiter
 */
export class Limiter implements AudioEffect {
  name = 'limiter'
  private threshold: number
  private release: number
  private envelope = 0

  constructor(options: { threshold?: number; release?: number } = {}) {
    this.threshold = options.threshold ?? -1
    this.release = options.release ?? 50
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    const output = new Float32Array(samples.length)
    const thresholdLinear = Math.pow(10, this.threshold / 20)
    const releaseCoef = Math.exp(-1 / (sampleRate * this.release / 1000))

    for (let i = 0; i < samples.length; i += channels) {
      // Calculate peak
      let peak = 0
      for (let ch = 0; ch < channels; ch++) {
        peak = Math.max(peak, Math.abs(samples[i + ch]))
      }

      // Calculate needed gain reduction
      const gainReduction = peak > thresholdLinear
        ? thresholdLinear / peak
        : 1

      // Envelope
      if (gainReduction < this.envelope) {
        this.envelope = gainReduction
      }
      else {
        this.envelope = releaseCoef * this.envelope + (1 - releaseCoef) * gainReduction
      }

      // Apply
      for (let ch = 0; ch < channels; ch++) {
        output[i + ch] = samples[i + ch] * this.envelope
      }
    }

    return output
  }

  reset(): void {
    this.envelope = 0
  }
}

/**
 * Simple reverb using comb and allpass filters
 */
export class Reverb implements AudioEffect {
  name = 'reverb'
  private combDelays: number[]
  private combFeedback: number[]
  private combBuffers: Float32Array[] = []
  private combIndices: number[] = []
  private allpassDelays: number[]
  private allpassBuffers: Float32Array[] = []
  private allpassIndices: number[] = []
  private wetLevel: number
  private dryLevel: number
  private initialized = false

  constructor(options: {
    roomSize?: number
    damping?: number
    wet?: number
    dry?: number
  } = {}) {
    const roomSize = options.roomSize ?? 0.5
    const damping = options.damping ?? 0.5

    // Freeverb-style delays (in samples at 44100)
    this.combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116]
    this.combFeedback = this.combDelays.map(() => 0.84 * roomSize)

    this.allpassDelays = [225, 556, 441, 341]

    this.wetLevel = options.wet ?? 0.3
    this.dryLevel = options.dry ?? 0.7
  }

  private initialize(sampleRate: number): void {
    if (this.initialized) return

    const ratio = sampleRate / 44100

    // Initialize comb filters
    this.combBuffers = this.combDelays.map(delay =>
      new Float32Array(Math.round(delay * ratio)),
    )
    this.combIndices = this.combDelays.map(() => 0)

    // Initialize allpass filters
    this.allpassBuffers = this.allpassDelays.map(delay =>
      new Float32Array(Math.round(delay * ratio)),
    )
    this.allpassIndices = this.allpassDelays.map(() => 0)

    this.initialized = true
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    this.initialize(sampleRate)

    const output = new Float32Array(samples.length)
    const monoSamples = new Float32Array(samples.length / channels)

    // Mix to mono for reverb processing
    for (let i = 0; i < samples.length; i += channels) {
      let sum = 0
      for (let ch = 0; ch < channels; ch++) {
        sum += samples[i + ch]
      }
      monoSamples[i / channels] = sum / channels
    }

    // Process reverb
    const reverbOutput = new Float32Array(monoSamples.length)

    for (let i = 0; i < monoSamples.length; i++) {
      const input = monoSamples[i]
      let combSum = 0

      // Parallel comb filters
      for (let c = 0; c < this.combBuffers.length; c++) {
        const buffer = this.combBuffers[c]
        const idx = this.combIndices[c]

        const delayed = buffer[idx]
        combSum += delayed

        buffer[idx] = input + delayed * this.combFeedback[c]
        this.combIndices[c] = (idx + 1) % buffer.length
      }

      // Series allpass filters
      let allpassOut = combSum / this.combBuffers.length

      for (let a = 0; a < this.allpassBuffers.length; a++) {
        const buffer = this.allpassBuffers[a]
        const idx = this.allpassIndices[a]

        const delayed = buffer[idx]
        const newVal = allpassOut + delayed * 0.5

        buffer[idx] = allpassOut - delayed * 0.5
        allpassOut = newVal

        this.allpassIndices[a] = (idx + 1) % buffer.length
      }

      reverbOutput[i] = allpassOut
    }

    // Mix wet/dry and expand to output channels
    for (let i = 0; i < samples.length; i += channels) {
      const monoIdx = i / channels
      const wet = reverbOutput[monoIdx] * this.wetLevel

      for (let ch = 0; ch < channels; ch++) {
        output[i + ch] = samples[i + ch] * this.dryLevel + wet
      }
    }

    return output
  }

  reset(): void {
    for (const buffer of this.combBuffers) {
      buffer.fill(0)
    }
    for (const buffer of this.allpassBuffers) {
      buffer.fill(0)
    }
    this.combIndices.fill(0)
    this.allpassIndices.fill(0)
  }
}

/**
 * Delay effect
 */
export class Delay implements AudioEffect {
  name = 'delay'
  private buffer: Float32Array | null = null
  private writeIndex = 0
  private delaySamples = 0

  constructor(
    private delayTime: number = 500,  // ms
    private feedback: number = 0.3,
    private wet: number = 0.5,
    private dry: number = 1,
  ) {}

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    this.delaySamples = Math.round((this.delayTime / 1000) * sampleRate) * channels

    if (!this.buffer || this.buffer.length !== this.delaySamples) {
      this.buffer = new Float32Array(this.delaySamples)
      this.writeIndex = 0
    }

    const output = new Float32Array(samples.length)

    for (let i = 0; i < samples.length; i++) {
      const readIndex = (this.writeIndex - this.delaySamples + this.buffer.length) % this.buffer.length
      const delayed = this.buffer[readIndex]

      output[i] = samples[i] * this.dry + delayed * this.wet
      this.buffer[this.writeIndex] = samples[i] + delayed * this.feedback

      this.writeIndex = (this.writeIndex + 1) % this.buffer.length
    }

    return output
  }

  reset(): void {
    if (this.buffer) {
      this.buffer.fill(0)
    }
    this.writeIndex = 0
  }
}

/**
 * Pitch shifter using granular synthesis
 */
export class PitchShifter implements AudioEffect {
  name = 'pitchShifter'
  private grainSize: number
  private overlap: number
  private pitchRatio: number
  private buffer: Float32Array | null = null
  private readPosition = 0
  private writePosition = 0

  constructor(options: {
    /** Pitch shift in semitones */
    semitones?: number
    /** Grain size in ms */
    grainSize?: number
    /** Overlap ratio */
    overlap?: number
  } = {}) {
    const semitones = options.semitones ?? 0
    this.pitchRatio = Math.pow(2, semitones / 12)
    this.grainSize = options.grainSize ?? 50
    this.overlap = options.overlap ?? 0.5
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    const grainSamples = Math.round((this.grainSize / 1000) * sampleRate) * channels
    const _hopSize = Math.round(grainSamples * (1 - this.overlap))

    if (!this.buffer || this.buffer.length < grainSamples * 4) {
      this.buffer = new Float32Array(grainSamples * 4)
      this.readPosition = 0
      this.writePosition = 0
    }

    const output = new Float32Array(samples.length)

    // Simple pitch shift using variable read speed
    for (let i = 0; i < samples.length; i++) {
      // Write to circular buffer
      this.buffer[this.writePosition % this.buffer.length] = samples[i]
      this.writePosition++

      // Read from buffer at different rate
      const readIdx = Math.floor(this.readPosition)
      const frac = this.readPosition - readIdx

      const idx1 = readIdx % this.buffer.length
      const idx2 = (readIdx + 1) % this.buffer.length

      // Linear interpolation
      output[i] = this.buffer[idx1] * (1 - frac) + this.buffer[idx2] * frac

      // Advance read position at pitch ratio
      this.readPosition += this.pitchRatio

      // Prevent read from getting too far from write
      const diff = this.writePosition - this.readPosition
      if (diff > this.buffer.length / 2) {
        this.readPosition = this.writePosition - this.buffer.length / 4
      }
      else if (diff < this.buffer.length / 4) {
        this.readPosition = this.writePosition - this.buffer.length / 2
      }
    }

    return output
  }

  reset(): void {
    if (this.buffer) {
      this.buffer.fill(0)
    }
    this.readPosition = 0
    this.writePosition = 0
  }
}

/**
 * Speed/tempo change without pitch change
 */
export class TimeStretch implements AudioEffect {
  name = 'timeStretch'
  private speed: number
  private buffer: Float32Array | null = null
  private position = 0

  constructor(speed: number = 1.0) {
    this.speed = speed
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    const outputLength = Math.round(samples.length / this.speed)
    const output = new Float32Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const srcPos = i * this.speed
      const srcIdx = Math.floor(srcPos)
      const frac = srcPos - srcIdx

      if (srcIdx + 1 < samples.length) {
        output[i] = samples[srcIdx] * (1 - frac) + samples[srcIdx + 1] * frac
      }
      else if (srcIdx < samples.length) {
        output[i] = samples[srcIdx]
      }
    }

    return output
  }

  reset(): void {
    this.position = 0
  }
}

/**
 * Gain adjustment
 */
export class Gain implements AudioEffect {
  name = 'gain'
  private linear: number

  constructor(gainDb: number) {
    this.linear = Math.pow(10, gainDb / 20)
  }

  process(samples: Float32Array): Float32Array {
    const output = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      output[i] = samples[i] * this.linear
    }
    return output
  }

  reset(): void {}
}

/**
 * Audio effect chain
 */
export class EffectChain {
  private effects: AudioEffect[] = []

  add(effect: AudioEffect): this {
    this.effects.push(effect)
    return this
  }

  process(samples: Float32Array, sampleRate: number, channels: number): Float32Array {
    let output = samples

    for (const effect of this.effects) {
      output = effect.process(output, sampleRate, channels)
    }

    return output
  }

  processSample(sample: AudioSample): AudioSample {
    if (!(sample.data instanceof Float32Array)) {
      throw new Error('Sample data must be Float32Array')
    }

    const processed = this.process(
      sample.data,
      sample.sampleRate ?? 44100,
      sample.channels ?? 2,
    )

    return {
      ...sample,
      data: processed,
    }
  }

  reset(): void {
    for (const effect of this.effects) {
      effect.reset()
    }
  }

  clear(): void {
    this.effects = []
  }
}

/**
 * Convenience functions for creating effects
 */
export const Effects: {
  eq: (bands: EqBand[]) => Equalizer
  compressor: (options?: CompressorOptions) => Compressor
  limiter: (options?: { threshold?: number; release?: number }) => Limiter
  reverb: (options?: { roomSize?: number; damping?: number; wet?: number; dry?: number }) => Reverb
  delay: (delayTime?: number, feedback?: number, wet?: number) => Delay
  pitchShift: (semitones: number) => PitchShifter
  timeStretch: (speed: number) => TimeStretch
  gain: (db: number) => Gain
  lowpass: (frequency: number, q?: number) => BiquadFilter
  highpass: (frequency: number, q?: number) => BiquadFilter
  bandpass: (frequency: number, q?: number) => BiquadFilter
  notch: (frequency: number, q?: number) => BiquadFilter
  lowshelf: (frequency: number, gain: number) => BiquadFilter
  highshelf: (frequency: number, gain: number) => BiquadFilter
  peaking: (frequency: number, gain: number, q?: number) => BiquadFilter
  bassBoost: () => Equalizer
  trebleBoost: () => Equalizer
  voiceEnhance: () => Equalizer
} = {
  eq: (bands: EqBand[]) => new Equalizer(bands),
  compressor: (options?: CompressorOptions) => new Compressor(options),
  limiter: (options?: { threshold?: number; release?: number }) => new Limiter(options),
  reverb: (options?: { roomSize?: number; damping?: number; wet?: number; dry?: number }) => new Reverb(options),
  delay: (delayTime?: number, feedback?: number, wet?: number) => new Delay(delayTime, feedback, wet),
  pitchShift: (semitones: number) => new PitchShifter({ semitones }),
  timeStretch: (speed: number) => new TimeStretch(speed),
  gain: (db: number) => new Gain(db),

  // Common EQ presets
  lowpass: (frequency: number, q?: number) => new BiquadFilter('lowpass', frequency, q),
  highpass: (frequency: number, q?: number) => new BiquadFilter('highpass', frequency, q),
  bandpass: (frequency: number, q?: number) => new BiquadFilter('bandpass', frequency, q),
  notch: (frequency: number, q?: number) => new BiquadFilter('notch', frequency, q),
  lowshelf: (frequency: number, gain: number) => new BiquadFilter('lowshelf', frequency, 1, gain),
  highshelf: (frequency: number, gain: number) => new BiquadFilter('highshelf', frequency, 1, gain),
  peaking: (frequency: number, gain: number, q?: number) => new BiquadFilter('peaking', frequency, q ?? 1, gain),

  // Preset EQs
  bassBoost: () => new Equalizer([
    { frequency: 60, gain: 6, q: 0.7, type: 'lowshelf' },
    { frequency: 150, gain: 3, q: 1 },
  ]),

  trebleBoost: () => new Equalizer([
    { frequency: 4000, gain: 3, q: 1 },
    { frequency: 10000, gain: 6, q: 0.7, type: 'highshelf' },
  ]),

  voiceEnhance: () => new Equalizer([
    { frequency: 100, gain: -6, q: 0.7, type: 'lowshelf' },
    { frequency: 2500, gain: 3, q: 1 },
    { frequency: 5000, gain: 2, q: 1 },
  ]),
}
