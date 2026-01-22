/**
 * HDR and color space detection utilities
 * Similar to mediabunny's color analysis system
 */

/**
 * Color primaries (ITU-T H.273)
 */
export enum ColorPrimaries {
  Reserved = 0,
  BT709 = 1,        // sRGB, Rec. 709
  Unspecified = 2,
  BT470M = 4,       // NTSC
  BT470BG = 5,      // PAL/SECAM
  SMPTE170M = 6,    // NTSC
  SMPTE240M = 7,
  Film = 8,
  BT2020 = 9,       // HDR, UHD
  SMPTEST428 = 10,  // XYZ
  SMPTEST431 = 11,  // DCI P3
  SMPTEST432 = 12,  // Display P3
  EBU3213 = 22,     // EBU Tech 3213-E
}

/**
 * Transfer characteristics (ITU-T H.273)
 */
export enum TransferCharacteristics {
  Reserved = 0,
  BT709 = 1,
  Unspecified = 2,
  Gamma22 = 4,        // BT.470M
  Gamma28 = 5,        // BT.470BG
  SMPTE170M = 6,
  SMPTE240M = 7,
  Linear = 8,
  Log100 = 9,
  Log316 = 10,
  IEC61966_2_4 = 11,  // xvYCC
  BT1361E = 12,
  IEC61966_2_1 = 13,  // sRGB
  BT2020_10 = 14,     // 10-bit SDR
  BT2020_12 = 15,     // 12-bit SDR
  SMPTEST2084 = 16,   // PQ (HDR10, Dolby Vision)
  SMPTEST428 = 17,
  ARIB_STD_B67 = 18,  // HLG
}

/**
 * Matrix coefficients (ITU-T H.273)
 */
export enum MatrixCoefficients {
  Identity = 0,       // GBR
  BT709 = 1,
  Unspecified = 2,
  FCC = 4,
  BT470BG = 5,
  SMPTE170M = 6,
  SMPTE240M = 7,
  YCgCo = 8,
  BT2020_NCL = 9,     // Non-constant luminance
  BT2020_CL = 10,     // Constant luminance
  SMPTEST2085 = 11,   // Y'D'zD'x
  ChromaNCL = 12,
  ChromaCL = 13,
  ICTCP = 14,
}

/**
 * Color range
 */
export enum ColorRange {
  Unspecified = 0,
  Limited = 1,  // TV range (16-235 for 8-bit)
  Full = 2,     // PC range (0-255 for 8-bit)
}

/**
 * HDR format detection
 */
export enum HdrFormat {
  SDR = 'sdr',
  HDR10 = 'hdr10',
  HDR10Plus = 'hdr10+',
  DolbyVision = 'dolby-vision',
  HLG = 'hlg',
  Unknown = 'unknown',
}

/**
 * Color space information
 */
export interface ColorSpaceInfo {
  /** Color primaries */
  primaries: ColorPrimaries
  /** Transfer characteristics (gamma/EOTF) */
  transfer: TransferCharacteristics
  /** Matrix coefficients for YCbCr */
  matrix: MatrixCoefficients
  /** Color range */
  range: ColorRange
  /** Bit depth */
  bitDepth: number
  /** Chroma subsampling (e.g., "4:2:0", "4:4:4") */
  chromaSubsampling?: string
}

/**
 * HDR metadata
 */
export interface HdrMetadata {
  /** HDR format detected */
  format: HdrFormat
  /** Max content light level (nits) */
  maxCll?: number
  /** Max frame average light level (nits) */
  maxFall?: number
  /** Mastering display color volume */
  masteringDisplay?: MasteringDisplayMetadata
  /** HDR10+ dynamic metadata present */
  hasDynamicMetadata?: boolean
  /** Dolby Vision profile */
  dolbyVisionProfile?: number
  /** Dolby Vision level */
  dolbyVisionLevel?: number
}

/**
 * Mastering display color volume (SMPTE ST 2086)
 */
export interface MasteringDisplayMetadata {
  /** Primary red x,y (0-1) */
  redPrimary: [number, number]
  /** Primary green x,y (0-1) */
  greenPrimary: [number, number]
  /** Primary blue x,y (0-1) */
  bluePrimary: [number, number]
  /** White point x,y (0-1) */
  whitePoint: [number, number]
  /** Maximum luminance (nits) */
  maxLuminance: number
  /** Minimum luminance (nits) */
  minLuminance: number
}

/**
 * Detect HDR format from color space information
 */
export function detectHdrFormat(colorSpace: ColorSpaceInfo): HdrFormat {
  // HDR10/HDR10+ uses PQ transfer function
  if (colorSpace.transfer === TransferCharacteristics.SMPTEST2084) {
    if (colorSpace.primaries === ColorPrimaries.BT2020) {
      // Could be HDR10 or HDR10+ (need to check for dynamic metadata)
      return HdrFormat.HDR10
    }
  }

  // HLG uses ARIB STD-B67 transfer
  if (colorSpace.transfer === TransferCharacteristics.ARIB_STD_B67) {
    return HdrFormat.HLG
  }

  // Dolby Vision detection requires checking codec-specific data
  // This is a basic check based on color space
  if (colorSpace.transfer === TransferCharacteristics.SMPTEST2084 &&
      colorSpace.primaries === ColorPrimaries.BT2020 &&
      colorSpace.bitDepth >= 10) {
    // Could be Dolby Vision, but need more checks
  }

  // SDR checks
  if (colorSpace.primaries === ColorPrimaries.BT709 &&
      (colorSpace.transfer === TransferCharacteristics.BT709 ||
       colorSpace.transfer === TransferCharacteristics.IEC61966_2_1)) {
    return HdrFormat.SDR
  }

  // BT.2020 without HDR transfer is wide color gamut SDR
  if (colorSpace.primaries === ColorPrimaries.BT2020 &&
      colorSpace.transfer !== TransferCharacteristics.SMPTEST2084 &&
      colorSpace.transfer !== TransferCharacteristics.ARIB_STD_B67) {
    return HdrFormat.SDR
  }

  return HdrFormat.SDR
}

/**
 * Check if color space represents HDR content
 */
export function isHdr(colorSpace: ColorSpaceInfo): boolean {
  const format = detectHdrFormat(colorSpace)
  return format !== HdrFormat.SDR && format !== HdrFormat.Unknown
}

/**
 * Check if color space uses wide color gamut (BT.2020 or P3)
 */
export function isWideColorGamut(colorSpace: ColorSpaceInfo): boolean {
  return colorSpace.primaries === ColorPrimaries.BT2020 ||
         colorSpace.primaries === ColorPrimaries.SMPTEST431 ||
         colorSpace.primaries === ColorPrimaries.SMPTEST432
}

/**
 * Get human-readable color space name
 */
export function getColorSpaceName(colorSpace: ColorSpaceInfo): string {
  const primariesName = ColorPrimaries[colorSpace.primaries] || 'Unknown'
  const transferName = TransferCharacteristics[colorSpace.transfer] || 'Unknown'

  if (colorSpace.transfer === TransferCharacteristics.SMPTEST2084) {
    if (colorSpace.primaries === ColorPrimaries.BT2020) {
      return 'BT.2020 PQ (HDR10)'
    }
    return `${primariesName} PQ`
  }

  if (colorSpace.transfer === TransferCharacteristics.ARIB_STD_B67) {
    return `${primariesName} HLG`
  }

  if (colorSpace.primaries === ColorPrimaries.BT709) {
    if (colorSpace.transfer === TransferCharacteristics.IEC61966_2_1) {
      return 'sRGB'
    }
    return 'BT.709 (Rec. 709)'
  }

  if (colorSpace.primaries === ColorPrimaries.BT2020) {
    return 'BT.2020'
  }

  if (colorSpace.primaries === ColorPrimaries.SMPTEST432) {
    return 'Display P3'
  }

  if (colorSpace.primaries === ColorPrimaries.SMPTEST431) {
    return 'DCI P3'
  }

  return `${primariesName} / ${transferName}`
}

/**
 * Parse color space from H.264/H.265 VUI parameters
 */
export function parseVuiColorSpace(vui: {
  colorPrimaries?: number
  transferCharacteristics?: number
  matrixCoefficients?: number
  videoFullRangeFlag?: boolean
  bitDepth?: number
}): ColorSpaceInfo {
  return {
    primaries: vui.colorPrimaries ?? ColorPrimaries.Unspecified,
    transfer: vui.transferCharacteristics ?? TransferCharacteristics.Unspecified,
    matrix: vui.matrixCoefficients ?? MatrixCoefficients.Unspecified,
    range: vui.videoFullRangeFlag ? ColorRange.Full : ColorRange.Limited,
    bitDepth: vui.bitDepth ?? 8,
  }
}

/**
 * Parse HDR10 SEI metadata from H.265 stream
 */
export function parseHdr10Sei(seiPayload: Uint8Array): Partial<HdrMetadata> {
  const result: Partial<HdrMetadata> = {}

  // Parse mastering display colour volume SEI (payload type 137)
  // Format: 10 x uint16 values
  if (seiPayload.length >= 24) {
    const view = new DataView(seiPayload.buffer, seiPayload.byteOffset, seiPayload.byteLength)

    // Display primaries (x,y for G, B, R)
    const gx = view.getUint16(0, false) / 50000
    const gy = view.getUint16(2, false) / 50000
    const bx = view.getUint16(4, false) / 50000
    const by = view.getUint16(6, false) / 50000
    const rx = view.getUint16(8, false) / 50000
    const ry = view.getUint16(10, false) / 50000

    // White point
    const wpx = view.getUint16(12, false) / 50000
    const wpy = view.getUint16(14, false) / 50000

    // Luminance (in units of 0.0001 cd/m²)
    const maxL = view.getUint32(16, false) / 10000
    const minL = view.getUint32(20, false) / 10000

    result.masteringDisplay = {
      greenPrimary: [gx, gy],
      bluePrimary: [bx, by],
      redPrimary: [rx, ry],
      whitePoint: [wpx, wpy],
      maxLuminance: maxL,
      minLuminance: minL,
    }
  }

  return result
}

/**
 * Parse content light level SEI (H.265)
 */
export function parseContentLightLevelSei(seiPayload: Uint8Array): Partial<HdrMetadata> {
  if (seiPayload.length >= 4) {
    const view = new DataView(seiPayload.buffer, seiPayload.byteOffset, seiPayload.byteLength)

    return {
      maxCll: view.getUint16(0, false),
      maxFall: view.getUint16(2, false),
    }
  }
  return {}
}

/**
 * Detect Dolby Vision configuration from codec data
 */
export function parseDolbyVisionConfig(configData: Uint8Array): Partial<HdrMetadata> | null {
  // Dolby Vision configuration box (dvcC or dvvC)
  if (configData.length < 4) return null

  const view = new DataView(configData.buffer, configData.byteOffset, configData.byteLength)

  const dvVersionMajor = view.getUint8(0)
  const dvVersionMinor = view.getUint8(1)

  if (dvVersionMajor !== 1) return null // Unknown version

  const profile = (view.getUint8(2) >> 1) & 0x7F
  const level = ((view.getUint8(2) & 0x01) << 5) | ((view.getUint8(3) >> 3) & 0x1F)

  return {
    format: HdrFormat.DolbyVision,
    dolbyVisionProfile: profile,
    dolbyVisionLevel: level,
  }
}

/**
 * Standard color primaries for common formats
 */
export const STANDARD_PRIMARIES: Record<string, MasteringDisplayMetadata['redPrimary'][]> = {
  'bt709': [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]],   // R, G, B
  'bt2020': [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
  'dci-p3': [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
  'display-p3': [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
}

/**
 * Create default HDR10 metadata
 */
export function createDefaultHdr10Metadata(): HdrMetadata {
  return {
    format: HdrFormat.HDR10,
    maxCll: 1000,
    maxFall: 400,
    masteringDisplay: {
      redPrimary: [0.708, 0.292],
      greenPrimary: [0.17, 0.797],
      bluePrimary: [0.131, 0.046],
      whitePoint: [0.3127, 0.329],
      maxLuminance: 1000,
      minLuminance: 0.001,
    },
  }
}

/**
 * Create WebCodecs VideoColorSpaceInit from color space info
 */
export function toVideoColorSpaceInit(colorSpace: ColorSpaceInfo): VideoColorSpaceInit {
  const primariesMap: Record<number, VideoColorPrimaries> = {
    [ColorPrimaries.BT709]: 'bt709',
    [ColorPrimaries.BT470BG]: 'bt470bg',
    [ColorPrimaries.SMPTE170M]: 'smpte170m',
    [ColorPrimaries.BT2020]: 'bt2020',
  }

  const transferMap: Record<number, VideoTransferCharacteristics> = {
    [TransferCharacteristics.BT709]: 'bt709',
    [TransferCharacteristics.SMPTE170M]: 'smpte170m',
    [TransferCharacteristics.IEC61966_2_1]: 'iec61966-2-1',
    [TransferCharacteristics.Linear]: 'linear',
    [TransferCharacteristics.SMPTEST2084]: 'pq',
    [TransferCharacteristics.ARIB_STD_B67]: 'hlg',
  }

  const matrixMap: Record<number, VideoMatrixCoefficients> = {
    [MatrixCoefficients.Identity]: 'rgb',
    [MatrixCoefficients.BT709]: 'bt709',
    [MatrixCoefficients.BT470BG]: 'bt470bg',
    [MatrixCoefficients.SMPTE170M]: 'smpte170m',
    [MatrixCoefficients.BT2020_NCL]: 'bt2020-ncl',
  }

  return {
    primaries: primariesMap[colorSpace.primaries],
    transfer: transferMap[colorSpace.transfer],
    matrix: matrixMap[colorSpace.matrix],
    fullRange: colorSpace.range === ColorRange.Full,
  }
}

/**
 * Create color space info from WebCodecs VideoColorSpace
 */
export function fromVideoColorSpace(videoColorSpace: VideoColorSpace): ColorSpaceInfo {
  const primariesMap: Record<string, ColorPrimaries> = {
    'bt709': ColorPrimaries.BT709,
    'bt470bg': ColorPrimaries.BT470BG,
    'smpte170m': ColorPrimaries.SMPTE170M,
    'bt2020': ColorPrimaries.BT2020,
  }

  const transferMap: Record<string, TransferCharacteristics> = {
    'bt709': TransferCharacteristics.BT709,
    'smpte170m': TransferCharacteristics.SMPTE170M,
    'iec61966-2-1': TransferCharacteristics.IEC61966_2_1,
    'linear': TransferCharacteristics.Linear,
    'pq': TransferCharacteristics.SMPTEST2084,
    'hlg': TransferCharacteristics.ARIB_STD_B67,
  }

  const matrixMap: Record<string, MatrixCoefficients> = {
    'rgb': MatrixCoefficients.Identity,
    'bt709': MatrixCoefficients.BT709,
    'bt470bg': MatrixCoefficients.BT470BG,
    'smpte170m': MatrixCoefficients.SMPTE170M,
    'bt2020-ncl': MatrixCoefficients.BT2020_NCL,
  }

  return {
    primaries: primariesMap[videoColorSpace.primaries ?? ''] ?? ColorPrimaries.Unspecified,
    transfer: transferMap[videoColorSpace.transfer ?? ''] ?? TransferCharacteristics.Unspecified,
    matrix: matrixMap[videoColorSpace.matrix ?? ''] ?? MatrixCoefficients.Unspecified,
    range: videoColorSpace.fullRange ? ColorRange.Full : ColorRange.Limited,
    bitDepth: 8, // WebCodecs doesn't expose bit depth directly
  }
}
