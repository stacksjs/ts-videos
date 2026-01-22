/**
 * HDR to SDR conversion utilities
 *
 * Provides tone mapping algorithms and color space conversion
 * for converting HDR video content to SDR displays.
 */

export interface HdrMetadata {
  colorSpace: ColorSpace
  transferFunction: TransferFunction
  primaries: ColorPrimaries
  maxCll?: number // Maximum Content Light Level (nits)
  maxFall?: number // Maximum Frame Average Light Level (nits)
  masteringDisplay?: MasteringDisplayMetadata
}

export interface MasteringDisplayMetadata {
  redPrimary: [number, number]
  greenPrimary: [number, number]
  bluePrimary: [number, number]
  whitePoint: [number, number]
  minLuminance: number
  maxLuminance: number
}

export type ColorSpace = 'bt709' | 'bt2020' | 'dcip3' | 'displayp3' | 'adobergb'
export type TransferFunction = 'sdr' | 'pq' | 'hlg' | 'srgb' | 'gamma22' | 'gamma24' | 'linear'
export type ColorPrimaries = 'bt709' | 'bt2020' | 'dcip3' | 'aces'

export type ToneMappingAlgorithm =
  | 'reinhard'
  | 'reinhard_extended'
  | 'hable'
  | 'aces'
  | 'aces_fitted'
  | 'bt2390'
  | 'mobius'
  | 'linear'
  | 'clip'

export interface ToneMappingOptions {
  algorithm?: ToneMappingAlgorithm
  targetPeakNits?: number
  sourcePeakNits?: number
  contrast?: number
  saturation?: number
  desat?: number // Desaturation factor for highlights
  gamutMapping?: GamutMappingMethod
}

export type GamutMappingMethod = 'clip' | 'compress' | 'desaturate' | 'perceptual'

export interface ConversionOptions {
  toneMapping?: ToneMappingOptions
  targetColorSpace?: ColorSpace
  targetTransfer?: TransferFunction
  preserveDetails?: boolean
  localToneMapping?: boolean
  localRadius?: number
}

export interface ConversionResult {
  r: number
  g: number
  b: number
}

// Color space matrices
const BT2020_TO_BT709: number[][] = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187],
]

const BT709_TO_XYZ: number[][] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
]

const XYZ_TO_BT709: number[][] = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
]

const BT2020_TO_XYZ: number[][] = [
  [0.6370, 0.1446, 0.1689],
  [0.2627, 0.6780, 0.0593],
  [0.0000, 0.0281, 1.0610],
]

const XYZ_TO_BT2020: number[][] = [
  [1.7167, -0.3557, -0.2534],
  [-0.6667, 1.6165, 0.0158],
  [0.0176, -0.0428, 0.9421],
]

/**
 * Apply PQ (SMPTE ST.2084) EOTF to convert to linear light
 */
export function pqToLinear(value: number): number {
  const m1 = 0.1593017578125
  const m2 = 78.84375
  const c1 = 0.8359375
  const c2 = 18.8515625
  const c3 = 18.6875

  const Np = value ** (1 / m2)
  const numerator = Math.max(Np - c1, 0)
  const denominator = c2 - c3 * Np

  // Linear value in range [0, 10000] nits
  return ((numerator / denominator) ** (1 / m1)) * 10000
}

/**
 * Apply inverse PQ to convert from linear to PQ
 */
export function linearToPq(nits: number): number {
  const m1 = 0.1593017578125
  const m2 = 78.84375
  const c1 = 0.8359375
  const c2 = 18.8515625
  const c3 = 18.6875

  const Y = nits / 10000
  const Ym1 = Y ** m1
  const numerator = c1 + c2 * Ym1
  const denominator = 1 + c3 * Ym1

  return (numerator / denominator) ** m2
}

/**
 * Apply HLG (Hybrid Log-Gamma) OETF inverse to get linear
 */
export function hlgToLinear(value: number): number {
  const a = 0.17883277
  const b = 1 - 4 * a
  const c = 0.5 - a * Math.log(4 * a)

  if (value <= 0.5) {
    return (value ** 2) / 3
  }
  else {
    return (Math.exp((value - c) / a) + b) / 12
  }
}

/**
 * Apply HLG OETF
 */
export function linearToHlg(linear: number): number {
  const a = 0.17883277
  const b = 1 - 4 * a
  const c = 0.5 - a * Math.log(4 * a)

  const scene = linear * 12 // Assuming 12x scene reference

  if (scene <= 1 / 12) {
    return Math.sqrt(3 * scene)
  }
  else {
    return a * Math.log(12 * scene - b) + c
  }
}

/**
 * Apply gamma EOTF
 */
export function gammaToLinear(value: number, gamma: number = 2.2): number {
  return value ** gamma
}

/**
 * Apply gamma OETF
 */
export function linearToGamma(linear: number, gamma: number = 2.2): number {
  return Math.max(0, linear) ** (1 / gamma)
}

/**
 * sRGB EOTF (display-referred)
 */
export function srgbToLinear(value: number): number {
  if (value <= 0.04045) {
    return value / 12.92
  }
  return ((value + 0.055) / 1.055) ** 2.4
}

/**
 * sRGB OETF
 */
export function linearToSrgb(linear: number): number {
  const v = Math.max(0, Math.min(1, linear))
  if (v <= 0.0031308) {
    return v * 12.92
  }
  return 1.055 * (v ** (1 / 2.4)) - 0.055
}

/**
 * Reinhard tone mapping
 */
export function toneMappingReinhard(luminance: number, maxLuminance: number = 1): number {
  return luminance / (1 + luminance) * (1 + luminance / (maxLuminance ** 2))
}

/**
 * Extended Reinhard with white point
 */
export function toneMappingReinhardExtended(
  luminance: number,
  whitePoint: number = 4
): number {
  const numerator = luminance * (1 + luminance / (whitePoint * whitePoint))
  return numerator / (1 + luminance)
}

/**
 * Hable (Uncharted 2) tone mapping
 */
export function toneMappingHable(x: number): number {
  const A = 0.15
  const B = 0.50
  const C = 0.10
  const D = 0.20
  const E = 0.02
  const F = 0.30

  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F
}

/**
 * Apply Hable tone mapping with normalization
 */
export function applyHableToneMapping(luminance: number, exposureBias: number = 2): number {
  const curr = toneMappingHable(exposureBias * luminance)
  const whiteScale = 1 / toneMappingHable(11.2) // White point
  return curr * whiteScale
}

/**
 * ACES filmic tone mapping (approximate)
 */
export function toneMappingAces(x: number): number {
  const a = 2.51
  const b = 0.03
  const c = 2.43
  const d = 0.59
  const e = 0.14
  return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)))
}

/**
 * ACES fitted tone mapping (Stephen Hill's approximation)
 */
export function toneMappingAcesFitted(x: number): number {
  // sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
  const a = x * (x + 0.0245786) - 0.000090537
  const b = x * (0.983729 * x + 0.4329510) + 0.238081
  return a / b
}

/**
 * BT.2390 EETF (Electro-optical transfer function)
 * Used for HDR to SDR conversion per ITU-R BT.2390
 */
export function toneMappingBt2390(
  signal: number,
  sourceMax: number = 1000,
  targetMax: number = 100
): number {
  // Normalize to PQ range
  const Lw = sourceMax / 10000
  const Lb = 0 // Black level
  const Lmax = targetMax / 10000

  // Apply EETF
  const E1 = signal

  // Knee function parameters
  const minLum = Lb
  const maxLum = Lw
  const ks = 1.5 * Lmax - 0.5
  const b = minLum

  let E2: number
  if (E1 < ks) {
    E2 = E1
  }
  else {
    // Hermite spline roll-off
    const t = (E1 - ks) / (1 - ks)
    const t2 = t * t
    const t3 = t2 * t
    E2 = (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * Lmax
  }

  // Scale to target range
  return Math.min(E2 / Lmax, 1) * (maxLum / Lw)
}

/**
 * Mobius tone mapping (smooth roll-off)
 */
export function toneMappingMobius(x: number, linearSection: number = 0.18, maxValue: number = 1): number {
  if (x <= linearSection) {
    return x
  }

  const a = -linearSection * linearSection / (maxValue - linearSection)
  const b = linearSection * linearSection / (maxValue - linearSection)

  return maxValue - (maxValue - linearSection) * Math.exp(-(x - linearSection) / (maxValue - linearSection))
}

/**
 * Apply selected tone mapping algorithm
 */
export function applyToneMapping(
  luminance: number,
  options: ToneMappingOptions = {}
): number {
  const {
    algorithm = 'bt2390',
    sourcePeakNits = 1000,
    targetPeakNits = 100,
  } = options

  // Normalize luminance to source peak
  const normalizedLum = luminance / sourcePeakNits

  let mappedLum: number

  switch (algorithm) {
    case 'reinhard':
      mappedLum = toneMappingReinhard(normalizedLum)
      break
    case 'reinhard_extended':
      mappedLum = toneMappingReinhardExtended(normalizedLum, sourcePeakNits / targetPeakNits)
      break
    case 'hable':
      mappedLum = applyHableToneMapping(normalizedLum)
      break
    case 'aces':
      mappedLum = toneMappingAces(normalizedLum)
      break
    case 'aces_fitted':
      mappedLum = toneMappingAcesFitted(normalizedLum)
      break
    case 'bt2390':
      mappedLum = toneMappingBt2390(normalizedLum, sourcePeakNits, targetPeakNits)
      break
    case 'mobius':
      mappedLum = toneMappingMobius(normalizedLum)
      break
    case 'linear':
      mappedLum = Math.min(1, normalizedLum * (targetPeakNits / sourcePeakNits))
      break
    case 'clip':
    default:
      mappedLum = Math.min(1, normalizedLum)
  }

  return mappedLum * targetPeakNits
}

/**
 * Matrix multiplication for color conversion
 */
function multiplyMatrix(matrix: number[][], rgb: [number, number, number]): [number, number, number] {
  return [
    matrix[0][0] * rgb[0] + matrix[0][1] * rgb[1] + matrix[0][2] * rgb[2],
    matrix[1][0] * rgb[0] + matrix[1][1] * rgb[1] + matrix[1][2] * rgb[2],
    matrix[2][0] * rgb[0] + matrix[2][1] * rgb[1] + matrix[2][2] * rgb[2],
  ]
}

/**
 * Convert BT.2020 to BT.709 color space
 */
export function bt2020ToBt709(r: number, g: number, b: number): ConversionResult {
  const [rOut, gOut, bOut] = multiplyMatrix(BT2020_TO_BT709, [r, g, b])
  return { r: rOut, g: gOut, b: bOut }
}

/**
 * Convert BT.709 to XYZ
 */
export function bt709ToXyz(r: number, g: number, b: number): [number, number, number] {
  return multiplyMatrix(BT709_TO_XYZ, [r, g, b])
}

/**
 * Convert XYZ to BT.709
 */
export function xyzToBt709(x: number, y: number, z: number): ConversionResult {
  const [r, g, b] = multiplyMatrix(XYZ_TO_BT709, [x, y, z])
  return { r, g, b }
}

/**
 * Convert BT.2020 to XYZ
 */
export function bt2020ToXyz(r: number, g: number, b: number): [number, number, number] {
  return multiplyMatrix(BT2020_TO_XYZ, [r, g, b])
}

/**
 * Convert XYZ to BT.2020
 */
export function xyzToBt2020(x: number, y: number, z: number): ConversionResult {
  const [r, g, b] = multiplyMatrix(XYZ_TO_BT2020, [x, y, z])
  return { r, g, b }
}

/**
 * Apply gamut mapping to bring out-of-gamut colors back into range
 */
export function applyGamutMapping(
  r: number,
  g: number,
  b: number,
  method: GamutMappingMethod = 'compress'
): ConversionResult {
  switch (method) {
    case 'clip':
      return {
        r: Math.max(0, Math.min(1, r)),
        g: Math.max(0, Math.min(1, g)),
        b: Math.max(0, Math.min(1, b)),
      }

    case 'desaturate': {
      // Calculate luminance
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

      // Find how much to desaturate to bring in gamut
      let t = 1
      if (r > 1 || g > 1 || b > 1 || r < 0 || g < 0 || b < 0) {
        // Binary search for proper saturation level
        let lo = 0
        let hi = 1
        for (let i = 0; i < 10; i++) {
          t = (lo + hi) / 2
          const testR = lum + t * (r - lum)
          const testG = lum + t * (g - lum)
          const testB = lum + t * (b - lum)

          if (testR >= 0 && testR <= 1 && testG >= 0 && testG <= 1 && testB >= 0 && testB <= 1) {
            lo = t
          }
          else {
            hi = t
          }
        }
        t = lo
      }

      return {
        r: Math.max(0, Math.min(1, lum + t * (r - lum))),
        g: Math.max(0, Math.min(1, lum + t * (g - lum))),
        b: Math.max(0, Math.min(1, lum + t * (b - lum))),
      }
    }

    case 'compress': {
      // Soft compression using sigmoid-like function
      const compress = (v: number): number => {
        if (v <= 1 && v >= 0)
          return v
        if (v > 1) {
          const excess = v - 1
          return 1 + excess / (1 + excess) * 0.1 // Compress highlights
        }
        return v / (1 - v) * 0.1 // Compress below zero
      }

      return {
        r: Math.max(0, Math.min(1, compress(r))),
        g: Math.max(0, Math.min(1, compress(g))),
        b: Math.max(0, Math.min(1, compress(b))),
      }
    }

    case 'perceptual':
    default: {
      // Perceptual gamut mapping via XYZ
      const [x, y, z] = bt709ToXyz(r, g, b)

      // Scale to fit within displayable range
      const maxComponent = Math.max(r, g, b)
      const minComponent = Math.min(r, g, b)

      let scale = 1
      if (maxComponent > 1) {
        scale = 1 / maxComponent
      }

      let offset = 0
      if (minComponent < 0) {
        offset = -minComponent * scale
      }

      return {
        r: Math.max(0, Math.min(1, r * scale + offset)),
        g: Math.max(0, Math.min(1, g * scale + offset)),
        b: Math.max(0, Math.min(1, b * scale + offset)),
      }
    }
  }
}

/**
 * Full HDR to SDR conversion pipeline
 */
export class HdrToSdrConverter {
  private options: ConversionOptions
  private metadata: HdrMetadata

  constructor(metadata: HdrMetadata, options: ConversionOptions = {}) {
    this.metadata = metadata
    this.options = {
      toneMapping: {
        algorithm: 'bt2390',
        sourcePeakNits: metadata.maxCll ?? metadata.masteringDisplay?.maxLuminance ?? 1000,
        targetPeakNits: 100,
        saturation: 1,
        desat: 0.5,
        gamutMapping: 'desaturate',
        ...options.toneMapping,
      },
      targetColorSpace: options.targetColorSpace ?? 'bt709',
      targetTransfer: options.targetTransfer ?? 'sdr',
      preserveDetails: options.preserveDetails ?? true,
      localToneMapping: options.localToneMapping ?? false,
      localRadius: options.localRadius ?? 50,
    }
  }

  /**
   * Convert a single pixel from HDR to SDR
   */
  convertPixel(r: number, g: number, b: number): ConversionResult {
    // Step 1: Convert from encoded values to linear light
    let linearR = r
    let linearG = g
    let linearB = b

    switch (this.metadata.transferFunction) {
      case 'pq':
        linearR = pqToLinear(r)
        linearG = pqToLinear(g)
        linearB = pqToLinear(b)
        break
      case 'hlg':
        linearR = hlgToLinear(r) * 1000 // Scale HLG to nits
        linearG = hlgToLinear(g) * 1000
        linearB = hlgToLinear(b) * 1000
        break
      case 'gamma22':
        linearR = gammaToLinear(r, 2.2)
        linearG = gammaToLinear(g, 2.2)
        linearB = gammaToLinear(b, 2.2)
        break
      case 'gamma24':
        linearR = gammaToLinear(r, 2.4)
        linearG = gammaToLinear(g, 2.4)
        linearB = gammaToLinear(b, 2.4)
        break
    }

    // Step 2: Calculate luminance for tone mapping
    const luminance = 0.2627 * linearR + 0.6780 * linearG + 0.0593 * linearB // BT.2020 weights

    // Step 3: Apply tone mapping to luminance
    const toneMappedLum = applyToneMapping(luminance, this.options.toneMapping)

    // Step 4: Scale RGB by luminance ratio (preserve hue)
    const lumRatio = luminance > 0 ? toneMappedLum / luminance : 0

    // Apply desaturation for highlights
    const desat = this.options.toneMapping?.desat ?? 0.5
    const desatFactor = 1 - desat * Math.max(0, (lumRatio - 0.5) * 2)

    linearR = luminance + (linearR - luminance) * lumRatio * desatFactor
    linearG = luminance + (linearG - luminance) * lumRatio * desatFactor
    linearB = luminance + (linearB - luminance) * lumRatio * desatFactor

    // Normalize to [0, 1] range
    const targetPeak = this.options.toneMapping?.targetPeakNits ?? 100
    linearR /= targetPeak
    linearG /= targetPeak
    linearB /= targetPeak

    // Step 5: Convert color space (BT.2020 -> BT.709)
    if (this.metadata.colorSpace === 'bt2020' && this.options.targetColorSpace === 'bt709') {
      const converted = bt2020ToBt709(linearR, linearG, linearB)
      linearR = converted.r
      linearG = converted.g
      linearB = converted.b
    }

    // Step 6: Gamut mapping
    const gamutMapped = applyGamutMapping(
      linearR,
      linearG,
      linearB,
      this.options.toneMapping?.gamutMapping ?? 'desaturate'
    )
    linearR = gamutMapped.r
    linearG = gamutMapped.g
    linearB = gamutMapped.b

    // Step 7: Apply output transfer function
    let outR = linearR
    let outG = linearG
    let outB = linearB

    switch (this.options.targetTransfer) {
      case 'sdr':
      case 'srgb':
        outR = linearToSrgb(linearR)
        outG = linearToSrgb(linearG)
        outB = linearToSrgb(linearB)
        break
      case 'gamma22':
        outR = linearToGamma(linearR, 2.2)
        outG = linearToGamma(linearG, 2.2)
        outB = linearToGamma(linearB, 2.2)
        break
      case 'gamma24':
        outR = linearToGamma(linearR, 2.4)
        outG = linearToGamma(linearG, 2.4)
        outB = linearToGamma(linearB, 2.4)
        break
    }

    return {
      r: Math.max(0, Math.min(1, outR)),
      g: Math.max(0, Math.min(1, outG)),
      b: Math.max(0, Math.min(1, outB)),
    }
  }

  /**
   * Convert an entire frame from HDR to SDR
   */
  convertFrame(
    frameData: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    bitDepth: number = 10
  ): Uint8ClampedArray {
    const output = new Uint8ClampedArray(width * height * 4)
    const maxValue = (1 << bitDepth) - 1

    for (let i = 0; i < width * height; i++) {
      const srcIdx = i * 4
      const dstIdx = i * 4

      // Normalize input to [0, 1]
      const r = frameData[srcIdx] / maxValue
      const g = frameData[srcIdx + 1] / maxValue
      const b = frameData[srcIdx + 2] / maxValue
      const a = frameData[srcIdx + 3] / maxValue

      // Convert
      const converted = this.convertPixel(r, g, b)

      // Output as 8-bit
      output[dstIdx] = Math.round(converted.r * 255)
      output[dstIdx + 1] = Math.round(converted.g * 255)
      output[dstIdx + 2] = Math.round(converted.b * 255)
      output[dstIdx + 3] = Math.round(a * 255)
    }

    return output
  }
}

/**
 * Detect HDR metadata from video properties
 */
export function detectHdrFormat(
  colorSpace?: string,
  transferCharacteristics?: string,
  colorPrimaries?: string,
  maxCll?: number,
  maxFall?: number
): HdrMetadata | null {
  let detectedColorSpace: ColorSpace = 'bt709'
  let detectedTransfer: TransferFunction = 'sdr'
  let detectedPrimaries: ColorPrimaries = 'bt709'

  // Detect color primaries
  if (colorPrimaries === '9' || colorPrimaries === 'bt2020') {
    detectedPrimaries = 'bt2020'
    detectedColorSpace = 'bt2020'
  }

  // Detect transfer function
  if (transferCharacteristics === '16' || transferCharacteristics === 'smpte2084') {
    detectedTransfer = 'pq'
  }
  else if (transferCharacteristics === '18' || transferCharacteristics === 'arib-std-b67') {
    detectedTransfer = 'hlg'
  }

  // Only return HDR metadata if we detected HDR
  if (detectedTransfer === 'sdr' && detectedColorSpace === 'bt709') {
    return null
  }

  return {
    colorSpace: detectedColorSpace,
    transferFunction: detectedTransfer,
    primaries: detectedPrimaries,
    maxCll,
    maxFall,
  }
}

/**
 * Generate FFmpeg filter string for HDR to SDR conversion
 */
export function getHdrToSdrFilter(
  metadata: HdrMetadata,
  options: ToneMappingOptions = {}
): string {
  const filters: string[] = []

  const algorithm = options.algorithm ?? 'bt2390'
  const desat = options.desat ?? 0.5

  // Map algorithm to FFmpeg zscale tonemap
  const tonemapMap: Record<ToneMappingAlgorithm, string> = {
    reinhard: 'reinhard',
    reinhard_extended: 'reinhard',
    hable: 'hable',
    aces: 'mobius', // FFmpeg doesn't have ACES, use mobius
    aces_fitted: 'mobius',
    bt2390: 'bt2390',
    mobius: 'mobius',
    linear: 'linear',
    clip: 'clip',
  }

  // Use zscale for proper HDR conversion
  filters.push(
    `zscale=t=linear:npl=${options.sourcePeakNits ?? 1000}`,
    `format=gbrpf32le`,
    `zscale=p=bt709`,
    `tonemap=${tonemapMap[algorithm]}:desat=${desat}:peak=${(options.targetPeakNits ?? 100) / (options.sourcePeakNits ?? 1000)}`,
    `zscale=t=bt709:m=bt709:r=tv`,
    `format=yuv420p`
  )

  return filters.join(',')
}

/**
 * Get conversion description for display
 */
export function getConversionDescription(metadata: HdrMetadata, options: ConversionOptions = {}): string {
  const parts: string[] = []

  parts.push(`Source: ${metadata.colorSpace.toUpperCase()} / ${metadata.transferFunction.toUpperCase()}`)

  if (metadata.maxCll) {
    parts.push(`MaxCLL: ${metadata.maxCll} nits`)
  }
  if (metadata.maxFall) {
    parts.push(`MaxFALL: ${metadata.maxFall} nits`)
  }

  parts.push(`Target: ${options.targetColorSpace?.toUpperCase() ?? 'BT709'} / ${options.targetTransfer?.toUpperCase() ?? 'SDR'}`)
  parts.push(`Tone mapping: ${options.toneMapping?.algorithm ?? 'bt2390'}`)

  return parts.join(', ')
}

export default {
  HdrToSdrConverter,
  pqToLinear,
  linearToPq,
  hlgToLinear,
  linearToHlg,
  gammaToLinear,
  linearToGamma,
  srgbToLinear,
  linearToSrgb,
  toneMappingReinhard,
  toneMappingReinhardExtended,
  toneMappingHable,
  applyHableToneMapping,
  toneMappingAces,
  toneMappingAcesFitted,
  toneMappingBt2390,
  toneMappingMobius,
  applyToneMapping,
  bt2020ToBt709,
  bt709ToXyz,
  xyzToBt709,
  bt2020ToXyz,
  xyzToBt2020,
  applyGamutMapping,
  detectHdrFormat,
  getHdrToSdrFilter,
  getConversionDescription,
}
