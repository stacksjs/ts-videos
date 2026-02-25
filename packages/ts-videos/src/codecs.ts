/* eslint-disable style/max-statements-per-line */
/**
 * Codec configuration parsing for H.264, H.265, and AAC
 * Parses parameter sets and extracts codec metadata
 */

import { BitstreamReader, removeEmulationPreventionBytes } from './bitstream'

// ============================================================================
// H.264 (AVC) Parser
// ============================================================================

/** H.264 NAL unit types */
export const H264NalType = {
  UNSPECIFIED: 0,
  SLICE_NON_IDR: 1,
  SLICE_PARTITION_A: 2,
  SLICE_PARTITION_B: 3,
  SLICE_PARTITION_C: 4,
  SLICE_IDR: 5,
  SEI: 6,
  SPS: 7,
  PPS: 8,
  ACCESS_UNIT_DELIMITER: 9,
  END_OF_SEQUENCE: 10,
  END_OF_STREAM: 11,
  FILLER_DATA: 12,
  SPS_EXT: 13,
  PREFIX_NAL: 14,
  SUBSET_SPS: 15,
  DPS: 16,
  SLICE_AUX: 19,
  SLICE_EXT: 20,
  SLICE_EXT_DEPTH: 21,
} as const

/** H.264 profile IDC values */
export const H264Profile = {
  BASELINE: 66,
  MAIN: 77,
  EXTENDED: 88,
  HIGH: 100,
  HIGH_10: 110,
  HIGH_422: 122,
  HIGH_444_PREDICTIVE: 244,
  CAVLC_444: 44,
  SCALABLE_BASELINE: 83,
  SCALABLE_HIGH: 86,
  MULTIVIEW_HIGH: 118,
  STEREO_HIGH: 128,
  MULTIVIEW_DEPTH_HIGH: 138,
} as const

/** H.264 level IDC values */
export const H264Level = {
  L1: 10,
  L1B: 9,
  L1_1: 11,
  L1_2: 12,
  L1_3: 13,
  L2: 20,
  L2_1: 21,
  L2_2: 22,
  L3: 30,
  L3_1: 31,
  L3_2: 32,
  L4: 40,
  L4_1: 41,
  L4_2: 42,
  L5: 50,
  L5_1: 51,
  L5_2: 52,
  L6: 60,
  L6_1: 61,
  L6_2: 62,
} as const

/** Parsed H.264 SPS data */
export interface H264Sps {
  profileIdc: number
  constraintSet0Flag: boolean
  constraintSet1Flag: boolean
  constraintSet2Flag: boolean
  constraintSet3Flag: boolean
  constraintSet4Flag: boolean
  constraintSet5Flag: boolean
  levelIdc: number
  seqParameterSetId: number
  chromaFormatIdc: number
  separateColourPlaneFlag: boolean
  bitDepthLuma: number
  bitDepthChroma: number
  qpprimeYZeroTransformBypassFlag: boolean
  seqScalingMatrixPresentFlag: boolean
  log2MaxFrameNum: number
  picOrderCntType: number
  log2MaxPicOrderCntLsb?: number
  deltaPicOrderAlwaysZeroFlag?: boolean
  offsetForNonRefPic?: number
  offsetForTopToBottomField?: number
  numRefFramesInPicOrderCntCycle?: number
  maxNumRefFrames: number
  gapsInFrameNumValueAllowedFlag: boolean
  picWidthInMbs: number
  picHeightInMapUnits: number
  frameMbsOnlyFlag: boolean
  mbAdaptiveFrameFieldFlag?: boolean
  direct8x8InferenceFlag: boolean
  frameCroppingFlag: boolean
  frameCropLeftOffset?: number
  frameCropRightOffset?: number
  frameCropTopOffset?: number
  frameCropBottomOffset?: number
  vuiParametersPresentFlag: boolean
  vui?: H264Vui

  // Derived values
  width: number
  height: number
  sarWidth: number
  sarHeight: number
  fps?: number
}

/** H.264 VUI parameters */
export interface H264Vui {
  aspectRatioInfoPresentFlag: boolean
  aspectRatioIdc?: number
  sarWidth?: number
  sarHeight?: number
  overscanInfoPresentFlag: boolean
  overscanAppropriateFlag?: boolean
  videoSignalTypePresentFlag: boolean
  videoFormat?: number
  videoFullRangeFlag?: boolean
  colourDescriptionPresentFlag?: boolean
  colourPrimaries?: number
  transferCharacteristics?: number
  matrixCoefficients?: number
  chromaLocInfoPresentFlag: boolean
  chromaSampleLocTypeTopField?: number
  chromaSampleLocTypeBottomField?: number
  timingInfoPresentFlag: boolean
  numUnitsInTick?: number
  timeScale?: number
  fixedFrameRateFlag?: boolean
  nalHrdParametersPresentFlag: boolean
  vclHrdParametersPresentFlag: boolean
  lowDelayHrdFlag?: boolean
  picStructPresentFlag: boolean
  bitstreamRestrictionFlag: boolean
  motionVectorsOverPicBoundariesFlag?: boolean
  maxBytesPerPicDenom?: number
  maxBitsPerMbDenom?: number
  log2MaxMvLengthHorizontal?: number
  log2MaxMvLengthVertical?: number
  maxNumReorderFrames?: number
  maxDecFrameBuffering?: number
}

/** Parsed H.264 PPS data */
export interface H264Pps {
  picParameterSetId: number
  seqParameterSetId: number
  entropyCodingModeFlag: boolean
  bottomFieldPicOrderInFramePresentFlag: boolean
  numSliceGroupsMinus1: number
  numRefIdxL0DefaultActiveMinus1: number
  numRefIdxL1DefaultActiveMinus1: number
  weightedPredFlag: boolean
  weightedBipredIdc: number
  picInitQpMinus26: number
  picInitQsMinus26: number
  chromaQpIndexOffset: number
  deblockingFilterControlPresentFlag: boolean
  constrainedIntraPredFlag: boolean
  redundantPicCntPresentFlag: boolean
  transform8x8ModeFlag?: boolean
  picScalingMatrixPresentFlag?: boolean
  secondChromaQpIndexOffset?: number
}

/** Extended SAR aspect ratio values */
const EXTENDED_SAR = 255
const ASPECT_RATIO_IDC_TABLE: [number, number][] = [
  [0, 1], // Unspecified
  [1, 1],
  [12, 11],
  [10, 11],
  [16, 11],
  [40, 33],
  [24, 11],
  [20, 11],
  [32, 11],
  [80, 33],
  [18, 11],
  [15, 11],
  [64, 33],
  [160, 99],
  [4, 3],
  [3, 2],
  [2, 1],
]

/** Read unsigned Exp-Golomb coded value */
function readUe(reader: BitstreamReader): number {
  let leadingZeroBits = 0
  while (reader.readBits(1) === 0 && leadingZeroBits < 32) {
    leadingZeroBits++
  }
  if (leadingZeroBits === 0) return 0
  const suffix = reader.readBits(leadingZeroBits)
  return (1 << leadingZeroBits) - 1 + suffix
}

/** Read signed Exp-Golomb coded value */
function readSe(reader: BitstreamReader): number {
  const ue = readUe(reader)
  const sign = (ue & 1) ? 1 : -1
  return sign * Math.ceil(ue / 2)
}

/** Parse H.264 SPS NAL unit */
export function parseH264Sps(data: Uint8Array): H264Sps {
  // Remove emulation prevention bytes
  const rbsp = removeEmulationPreventionBytes(data)
  const reader = new BitstreamReader(rbsp)

  // Skip NAL header if present (forbidden_zero_bit + nal_ref_idc + nal_unit_type)
  if ((rbsp[0] & 0x1f) === H264NalType.SPS) {
    reader.readBits(8)
  }

  const profileIdc = reader.readBits(8)
  const constraintSet0Flag = reader.readBits(1) === 1
  const constraintSet1Flag = reader.readBits(1) === 1
  const constraintSet2Flag = reader.readBits(1) === 1
  const constraintSet3Flag = reader.readBits(1) === 1
  const constraintSet4Flag = reader.readBits(1) === 1
  const constraintSet5Flag = reader.readBits(1) === 1
  reader.readBits(2) // reserved_zero_2bits
  const levelIdc = reader.readBits(8)
  const seqParameterSetId = readUe(reader)

  let chromaFormatIdc = 1
  let separateColourPlaneFlag = false
  let bitDepthLuma = 8
  let bitDepthChroma = 8
  let qpprimeYZeroTransformBypassFlag = false
  let seqScalingMatrixPresentFlag = false

  const highProfiles = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]
  if (highProfiles.includes(profileIdc)) {
    chromaFormatIdc = readUe(reader)
    if (chromaFormatIdc === 3) {
      separateColourPlaneFlag = reader.readBits(1) === 1
    }
    bitDepthLuma = readUe(reader) + 8
    bitDepthChroma = readUe(reader) + 8
    qpprimeYZeroTransformBypassFlag = reader.readBits(1) === 1
    seqScalingMatrixPresentFlag = reader.readBits(1) === 1
    if (seqScalingMatrixPresentFlag) {
      const scalingListCount = chromaFormatIdc !== 3 ? 8 : 12
      for (let i = 0; i < scalingListCount; i++) {
        const seqScalingListPresentFlag = reader.readBits(1) === 1
        if (seqScalingListPresentFlag) {
          const sizeOfScalingList = i < 6 ? 16 : 64
          let lastScale = 8
          let nextScale = 8
          for (let j = 0; j < sizeOfScalingList; j++) {
            if (nextScale !== 0) {
              const deltaScale = readSe(reader)
              nextScale = (lastScale + deltaScale + 256) % 256
            }
            lastScale = nextScale === 0 ? lastScale : nextScale
          }
        }
      }
    }
  }

  const log2MaxFrameNum = readUe(reader) + 4
  const picOrderCntType = readUe(reader)

  let log2MaxPicOrderCntLsb: number | undefined
  let deltaPicOrderAlwaysZeroFlag: boolean | undefined
  let offsetForNonRefPic: number | undefined
  let offsetForTopToBottomField: number | undefined
  let numRefFramesInPicOrderCntCycle: number | undefined

  if (picOrderCntType === 0) {
    log2MaxPicOrderCntLsb = readUe(reader) + 4
  }
  else if (picOrderCntType === 1) {
    deltaPicOrderAlwaysZeroFlag = reader.readBits(1) === 1
    offsetForNonRefPic = readSe(reader)
    offsetForTopToBottomField = readSe(reader)
    numRefFramesInPicOrderCntCycle = readUe(reader)
    for (let i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
      readSe(reader) // offset_for_ref_frame[i]
    }
  }

  const maxNumRefFrames = readUe(reader)
  const gapsInFrameNumValueAllowedFlag = reader.readBits(1) === 1
  const picWidthInMbs = readUe(reader) + 1
  const picHeightInMapUnits = readUe(reader) + 1
  const frameMbsOnlyFlag = reader.readBits(1) === 1

  let mbAdaptiveFrameFieldFlag: boolean | undefined
  if (!frameMbsOnlyFlag) {
    mbAdaptiveFrameFieldFlag = reader.readBits(1) === 1
  }

  const direct8x8InferenceFlag = reader.readBits(1) === 1
  const frameCroppingFlag = reader.readBits(1) === 1

  let frameCropLeftOffset: number | undefined
  let frameCropRightOffset: number | undefined
  let frameCropTopOffset: number | undefined
  let frameCropBottomOffset: number | undefined

  if (frameCroppingFlag) {
    frameCropLeftOffset = readUe(reader)
    frameCropRightOffset = readUe(reader)
    frameCropTopOffset = readUe(reader)
    frameCropBottomOffset = readUe(reader)
  }

  const vuiParametersPresentFlag = reader.readBits(1) === 1
  let vui: H264Vui | undefined

  if (vuiParametersPresentFlag) {
    vui = parseH264Vui(reader)
  }

  // Calculate dimensions
  const chromaArrayType = separateColourPlaneFlag ? 0 : chromaFormatIdc
  const subWidthC = chromaArrayType === 1 || chromaArrayType === 2 ? 2 : 1
  const subHeightC = chromaArrayType === 1 ? 2 : 1
  const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC
  const cropUnitY = chromaArrayType === 0 ? (2 - (frameMbsOnlyFlag ? 1 : 0)) : subHeightC * (2 - (frameMbsOnlyFlag ? 1 : 0))

  const width = picWidthInMbs * 16 - cropUnitX * ((frameCropLeftOffset ?? 0) + (frameCropRightOffset ?? 0))
  const height = (2 - (frameMbsOnlyFlag ? 1 : 0)) * picHeightInMapUnits * 16 - cropUnitY * ((frameCropTopOffset ?? 0) + (frameCropBottomOffset ?? 0))

  // Get SAR
  let sarWidth = 1
  let sarHeight = 1
  if (vui?.aspectRatioInfoPresentFlag) {
    if (vui.aspectRatioIdc === EXTENDED_SAR) {
      sarWidth = vui.sarWidth ?? 1
      sarHeight = vui.sarHeight ?? 1
    }
    else if (vui.aspectRatioIdc !== undefined && vui.aspectRatioIdc < ASPECT_RATIO_IDC_TABLE.length) {
      [sarWidth, sarHeight] = ASPECT_RATIO_IDC_TABLE[vui.aspectRatioIdc]
    }
  }

  // Calculate FPS
  let fps: number | undefined
  if (vui?.timingInfoPresentFlag && vui.numUnitsInTick && vui.timeScale) {
    fps = vui.timeScale / (2 * vui.numUnitsInTick)
  }

  return {
    profileIdc,
    constraintSet0Flag,
    constraintSet1Flag,
    constraintSet2Flag,
    constraintSet3Flag,
    constraintSet4Flag,
    constraintSet5Flag,
    levelIdc,
    seqParameterSetId,
    chromaFormatIdc,
    separateColourPlaneFlag,
    bitDepthLuma,
    bitDepthChroma,
    qpprimeYZeroTransformBypassFlag,
    seqScalingMatrixPresentFlag,
    log2MaxFrameNum,
    picOrderCntType,
    log2MaxPicOrderCntLsb,
    deltaPicOrderAlwaysZeroFlag,
    offsetForNonRefPic,
    offsetForTopToBottomField,
    numRefFramesInPicOrderCntCycle,
    maxNumRefFrames,
    gapsInFrameNumValueAllowedFlag,
    picWidthInMbs,
    picHeightInMapUnits,
    frameMbsOnlyFlag,
    mbAdaptiveFrameFieldFlag,
    direct8x8InferenceFlag,
    frameCroppingFlag,
    frameCropLeftOffset,
    frameCropRightOffset,
    frameCropTopOffset,
    frameCropBottomOffset,
    vuiParametersPresentFlag,
    vui,
    width,
    height,
    sarWidth,
    sarHeight,
    fps,
  }
}

/** Parse H.264 VUI parameters */
function parseH264Vui(reader: BitstreamReader): H264Vui {
  const aspectRatioInfoPresentFlag = reader.readBits(1) === 1
  let aspectRatioIdc: number | undefined
  let sarWidth: number | undefined
  let sarHeight: number | undefined

  if (aspectRatioInfoPresentFlag) {
    aspectRatioIdc = reader.readBits(8)
    if (aspectRatioIdc === EXTENDED_SAR) {
      sarWidth = reader.readBits(16)
      sarHeight = reader.readBits(16)
    }
  }

  const overscanInfoPresentFlag = reader.readBits(1) === 1
  let overscanAppropriateFlag: boolean | undefined
  if (overscanInfoPresentFlag) {
    overscanAppropriateFlag = reader.readBits(1) === 1
  }

  const videoSignalTypePresentFlag = reader.readBits(1) === 1
  let videoFormat: number | undefined
  let videoFullRangeFlag: boolean | undefined
  let colourDescriptionPresentFlag: boolean | undefined
  let colourPrimaries: number | undefined
  let transferCharacteristics: number | undefined
  let matrixCoefficients: number | undefined

  if (videoSignalTypePresentFlag) {
    videoFormat = reader.readBits(3)
    videoFullRangeFlag = reader.readBits(1) === 1
    colourDescriptionPresentFlag = reader.readBits(1) === 1
    if (colourDescriptionPresentFlag) {
      colourPrimaries = reader.readBits(8)
      transferCharacteristics = reader.readBits(8)
      matrixCoefficients = reader.readBits(8)
    }
  }

  const chromaLocInfoPresentFlag = reader.readBits(1) === 1
  let chromaSampleLocTypeTopField: number | undefined
  let chromaSampleLocTypeBottomField: number | undefined

  if (chromaLocInfoPresentFlag) {
    chromaSampleLocTypeTopField = readUe(reader)
    chromaSampleLocTypeBottomField = readUe(reader)
  }

  const timingInfoPresentFlag = reader.readBits(1) === 1
  let numUnitsInTick: number | undefined
  let timeScale: number | undefined
  let fixedFrameRateFlag: boolean | undefined

  if (timingInfoPresentFlag) {
    numUnitsInTick = reader.readBits(32)
    timeScale = reader.readBits(32)
    fixedFrameRateFlag = reader.readBits(1) === 1
  }

  const nalHrdParametersPresentFlag = reader.readBits(1) === 1
  if (nalHrdParametersPresentFlag) {
    parseHrdParameters(reader)
  }

  const vclHrdParametersPresentFlag = reader.readBits(1) === 1
  if (vclHrdParametersPresentFlag) {
    parseHrdParameters(reader)
  }

  let lowDelayHrdFlag: boolean | undefined
  if (nalHrdParametersPresentFlag || vclHrdParametersPresentFlag) {
    lowDelayHrdFlag = reader.readBits(1) === 1
  }

  const picStructPresentFlag = reader.readBits(1) === 1
  const bitstreamRestrictionFlag = reader.readBits(1) === 1

  let motionVectorsOverPicBoundariesFlag: boolean | undefined
  let maxBytesPerPicDenom: number | undefined
  let maxBitsPerMbDenom: number | undefined
  let log2MaxMvLengthHorizontal: number | undefined
  let log2MaxMvLengthVertical: number | undefined
  let maxNumReorderFrames: number | undefined
  let maxDecFrameBuffering: number | undefined

  if (bitstreamRestrictionFlag) {
    motionVectorsOverPicBoundariesFlag = reader.readBits(1) === 1
    maxBytesPerPicDenom = readUe(reader)
    maxBitsPerMbDenom = readUe(reader)
    log2MaxMvLengthHorizontal = readUe(reader)
    log2MaxMvLengthVertical = readUe(reader)
    maxNumReorderFrames = readUe(reader)
    maxDecFrameBuffering = readUe(reader)
  }

  return {
    aspectRatioInfoPresentFlag,
    aspectRatioIdc,
    sarWidth,
    sarHeight,
    overscanInfoPresentFlag,
    overscanAppropriateFlag,
    videoSignalTypePresentFlag,
    videoFormat,
    videoFullRangeFlag,
    colourDescriptionPresentFlag,
    colourPrimaries,
    transferCharacteristics,
    matrixCoefficients,
    chromaLocInfoPresentFlag,
    chromaSampleLocTypeTopField,
    chromaSampleLocTypeBottomField,
    timingInfoPresentFlag,
    numUnitsInTick,
    timeScale,
    fixedFrameRateFlag,
    nalHrdParametersPresentFlag,
    vclHrdParametersPresentFlag,
    lowDelayHrdFlag,
    picStructPresentFlag,
    bitstreamRestrictionFlag,
    motionVectorsOverPicBoundariesFlag,
    maxBytesPerPicDenom,
    maxBitsPerMbDenom,
    log2MaxMvLengthHorizontal,
    log2MaxMvLengthVertical,
    maxNumReorderFrames,
    maxDecFrameBuffering,
  }
}

/** Parse HRD parameters (skip) */
function parseHrdParameters(reader: BitstreamReader): void {
  const cpbCntMinus1 = readUe(reader)
  reader.readBits(4) // bit_rate_scale
  reader.readBits(4) // cpb_size_scale
  for (let i = 0; i <= cpbCntMinus1; i++) {
    readUe(reader) // bit_rate_value_minus1[i]
    readUe(reader) // cpb_size_value_minus1[i]
    reader.readBits(1) // cbr_flag[i]
  }
  reader.readBits(5) // initial_cpb_removal_delay_length_minus1
  reader.readBits(5) // cpb_removal_delay_length_minus1
  reader.readBits(5) // dpb_output_delay_length_minus1
  reader.readBits(5) // time_offset_length
}

/** Parse H.264 PPS NAL unit */
export function parseH264Pps(data: Uint8Array): H264Pps {
  const rbsp = removeEmulationPreventionBytes(data)
  const reader = new BitstreamReader(rbsp)

  // Skip NAL header if present
  if ((rbsp[0] & 0x1f) === H264NalType.PPS) {
    reader.readBits(8)
  }

  const picParameterSetId = readUe(reader)
  const seqParameterSetId = readUe(reader)
  const entropyCodingModeFlag = reader.readBits(1) === 1
  const bottomFieldPicOrderInFramePresentFlag = reader.readBits(1) === 1
  const numSliceGroupsMinus1 = readUe(reader)

  if (numSliceGroupsMinus1 > 0) {
    const sliceGroupMapType = readUe(reader)
    if (sliceGroupMapType === 0) {
      for (let i = 0; i <= numSliceGroupsMinus1; i++) {
        readUe(reader) // run_length_minus1[i]
      }
    }
    else if (sliceGroupMapType === 2) {
      for (let i = 0; i < numSliceGroupsMinus1; i++) {
        readUe(reader) // top_left[i]
        readUe(reader) // bottom_right[i]
      }
    }
    else if (sliceGroupMapType === 3 || sliceGroupMapType === 4 || sliceGroupMapType === 5) {
      reader.readBits(1) // slice_group_change_direction_flag
      readUe(reader) // slice_group_change_rate_minus1
    }
    else if (sliceGroupMapType === 6) {
      const picSizeInMapUnits = readUe(reader) + 1
      const bits = Math.ceil(Math.log2(numSliceGroupsMinus1 + 1))
      for (let i = 0; i < picSizeInMapUnits; i++) {
        reader.readBits(bits) // slice_group_id[i]
      }
    }
  }

  const numRefIdxL0DefaultActiveMinus1 = readUe(reader)
  const numRefIdxL1DefaultActiveMinus1 = readUe(reader)
  const weightedPredFlag = reader.readBits(1) === 1
  const weightedBipredIdc = reader.readBits(2)
  const picInitQpMinus26 = readSe(reader)
  const picInitQsMinus26 = readSe(reader)
  const chromaQpIndexOffset = readSe(reader)
  const deblockingFilterControlPresentFlag = reader.readBits(1) === 1
  const constrainedIntraPredFlag = reader.readBits(1) === 1
  const redundantPicCntPresentFlag = reader.readBits(1) === 1

  // Check for more_rbsp_data
  let transform8x8ModeFlag: boolean | undefined
  let picScalingMatrixPresentFlag: boolean | undefined
  let secondChromaQpIndexOffset: number | undefined

  if (reader.bitsRemaining > 8) {
    transform8x8ModeFlag = reader.readBits(1) === 1
    picScalingMatrixPresentFlag = reader.readBits(1) === 1
    if (picScalingMatrixPresentFlag) {
      // Skip scaling lists
      const listCount = 6 + (transform8x8ModeFlag ? 2 : 0)
      for (let i = 0; i < listCount; i++) {
        const picScalingListPresentFlag = reader.readBits(1) === 1
        if (picScalingListPresentFlag) {
          const sizeOfScalingList = i < 6 ? 16 : 64
          let lastScale = 8
          let nextScale = 8
          for (let j = 0; j < sizeOfScalingList; j++) {
            if (nextScale !== 0) {
              const deltaScale = readSe(reader)
              nextScale = (lastScale + deltaScale + 256) % 256
            }
            lastScale = nextScale === 0 ? lastScale : nextScale
          }
        }
      }
    }
    secondChromaQpIndexOffset = readSe(reader)
  }

  return {
    picParameterSetId,
    seqParameterSetId,
    entropyCodingModeFlag,
    bottomFieldPicOrderInFramePresentFlag,
    numSliceGroupsMinus1,
    numRefIdxL0DefaultActiveMinus1,
    numRefIdxL1DefaultActiveMinus1,
    weightedPredFlag,
    weightedBipredIdc,
    picInitQpMinus26,
    picInitQsMinus26,
    chromaQpIndexOffset,
    deblockingFilterControlPresentFlag,
    constrainedIntraPredFlag,
    redundantPicCntPresentFlag,
    transform8x8ModeFlag,
    picScalingMatrixPresentFlag,
    secondChromaQpIndexOffset,
  }
}

/** Get H.264 profile name */
export function getH264ProfileName(profileIdc: number): string {
  const profiles: Record<number, string> = {
    66: 'Baseline',
    77: 'Main',
    88: 'Extended',
    100: 'High',
    110: 'High 10',
    122: 'High 4:2:2',
    244: 'High 4:4:4 Predictive',
    44: 'CAVLC 4:4:4',
    83: 'Scalable Baseline',
    86: 'Scalable High',
    118: 'Multiview High',
    128: 'Stereo High',
    138: 'Multiview Depth High',
  }
  return profiles[profileIdc] ?? `Unknown (${profileIdc})`
}

/** Get H.264 level name */
export function getH264LevelName(levelIdc: number): string {
  if (levelIdc === 9) return '1b'
  const major = Math.floor(levelIdc / 10)
  const minor = levelIdc % 10
  return minor === 0 ? `${major}` : `${major}.${minor}`
}

/** Generate avc1 codec string */
export function generateAvc1CodecString(sps: H264Sps): string {
  const profile = sps.profileIdc.toString(16).padStart(2, '0')
  const constraints =
    ((sps.constraintSet0Flag ? 0x80 : 0) |
      (sps.constraintSet1Flag ? 0x40 : 0) |
      (sps.constraintSet2Flag ? 0x20 : 0) |
      (sps.constraintSet3Flag ? 0x10 : 0) |
      (sps.constraintSet4Flag ? 0x08 : 0) |
      (sps.constraintSet5Flag ? 0x04 : 0))
      .toString(16)
      .padStart(2, '0')
  const level = sps.levelIdc.toString(16).padStart(2, '0')
  return `avc1.${profile}${constraints}${level}`
}

// ============================================================================
// H.265 (HEVC) Parser
// ============================================================================

/** H.265 NAL unit types */
export const H265NalType = {
  TRAIL_N: 0,
  TRAIL_R: 1,
  TSA_N: 2,
  TSA_R: 3,
  STSA_N: 4,
  STSA_R: 5,
  RADL_N: 6,
  RADL_R: 7,
  RASL_N: 8,
  RASL_R: 9,
  BLA_W_LP: 16,
  BLA_W_RADL: 17,
  BLA_N_LP: 18,
  IDR_W_RADL: 19,
  IDR_N_LP: 20,
  CRA_NUT: 21,
  VPS: 32,
  SPS: 33,
  PPS: 34,
  AUD: 35,
  EOS: 36,
  EOB: 37,
  FD: 38,
  PREFIX_SEI: 39,
  SUFFIX_SEI: 40,
} as const

/** H.265 profiles */
export const H265Profile = {
  MAIN: 1,
  MAIN_10: 2,
  MAIN_STILL_PICTURE: 3,
  REXT: 4,
  HIGH_THROUGHPUT: 5,
  MULTIVIEW_MAIN: 6,
  SCALABLE_MAIN: 7,
  MAIN_3D: 8,
  SCREEN_EXTENDED: 9,
  SCALABLE_REXT: 10,
  HIGH_THROUGHPUT_SCREEN_EXTENDED: 11,
} as const

/** H.265 tiers */
export const H265Tier = {
  MAIN: 0,
  HIGH: 1,
} as const

/** Parsed H.265 VPS data */
export interface H265Vps {
  vpsVideoParameterSetId: number
  vpsBaseLayerInternalFlag: boolean
  vpsBaseLayerAvailableFlag: boolean
  vpsMaxLayersMinus1: number
  vpsMaxSubLayersMinus1: number
  vpsTemporalIdNestingFlag: boolean
  profileTierLevel: H265ProfileTierLevel
}

/** Parsed H.265 SPS data */
export interface H265Sps {
  spsVideoParameterSetId: number
  spsMaxSubLayersMinus1: number
  spsTemporalIdNestingFlag: boolean
  profileTierLevel: H265ProfileTierLevel
  spsSeqParameterSetId: number
  chromaFormatIdc: number
  separateColourPlaneFlag: boolean
  picWidthInLumaSamples: number
  picHeightInLumaSamples: number
  conformanceWindowFlag: boolean
  confWinLeftOffset?: number
  confWinRightOffset?: number
  confWinTopOffset?: number
  confWinBottomOffset?: number
  bitDepthLumaMinus8: number
  bitDepthChromaMinus8: number
  log2MaxPicOrderCntLsbMinus4: number
  spsSubLayerOrderingInfoPresentFlag: boolean
  spsMaxDecPicBufferingMinus1: number[]
  spsMaxNumReorderPics: number[]
  spsMaxLatencyIncreasePlus1: number[]
  log2MinLumaCodingBlockSizeMinus3: number
  log2DiffMaxMinLumaCodingBlockSize: number
  log2MinLumaTransformBlockSizeMinus2: number
  log2DiffMaxMinLumaTransformBlockSize: number
  maxTransformHierarchyDepthInter: number
  maxTransformHierarchyDepthIntra: number
  vuiParametersPresentFlag: boolean
  vui?: H265Vui

  // Derived values
  width: number
  height: number
  bitDepthLuma: number
  bitDepthChroma: number
  fps?: number
}

/** H.265 Profile/Tier/Level */
export interface H265ProfileTierLevel {
  generalProfileSpace: number
  generalTierFlag: boolean
  generalProfileIdc: number
  generalProfileCompatibilityFlags: number
  generalConstraintIndicatorFlags: bigint
  generalLevelIdc: number
}

/** H.265 VUI parameters */
export interface H265Vui {
  aspectRatioInfoPresentFlag: boolean
  aspectRatioIdc?: number
  sarWidth?: number
  sarHeight?: number
  overscanInfoPresentFlag: boolean
  overscanAppropriateFlag?: boolean
  videoSignalTypePresentFlag: boolean
  videoFormat?: number
  videoFullRangeFlag?: boolean
  colourDescriptionPresentFlag?: boolean
  colourPrimaries?: number
  transferCharacteristics?: number
  matrixCoeffs?: number
  chromaLocInfoPresentFlag: boolean
  chromaSampleLocTypeTopField?: number
  chromaSampleLocTypeBottomField?: number
  neutralChromaIndicationFlag: boolean
  fieldSeqFlag: boolean
  frameFieldInfoPresentFlag: boolean
  defaultDisplayWindowFlag: boolean
  defDispWinLeftOffset?: number
  defDispWinRightOffset?: number
  defDispWinTopOffset?: number
  defDispWinBottomOffset?: number
  vuiTimingInfoPresentFlag: boolean
  vuiNumUnitsInTick?: number
  vuiTimeScale?: number
  vuiPocProportionalToTimingFlag?: boolean
  vuiNumTicksPocDiffOneMinus1?: number
  vuiHrdParametersPresentFlag?: boolean
  bitstreamRestrictionFlag: boolean
}

/** Parsed H.265 PPS data */
export interface H265Pps {
  ppsPicParameterSetId: number
  ppsSeqParameterSetId: number
  dependentSliceSegmentsEnabledFlag: boolean
  outputFlagPresentFlag: boolean
  numExtraSliceHeaderBits: number
  signDataHidingEnabledFlag: boolean
  cabacInitPresentFlag: boolean
  numRefIdxL0DefaultActiveMinus1: number
  numRefIdxL1DefaultActiveMinus1: number
  initQpMinus26: number
  constrainedIntraPredFlag: boolean
  transformSkipEnabledFlag: boolean
  cuQpDeltaEnabledFlag: boolean
  diffCuQpDeltaDepth?: number
  ppsCbQpOffset: number
  ppsCrQpOffset: number
  ppsSliceChromaQpOffsetsPresentFlag: boolean
  weightedPredFlag: boolean
  weightedBipredFlag: boolean
  transquantBypassEnabledFlag: boolean
  tilesEnabledFlag: boolean
  entropyCodingSyncEnabledFlag: boolean
  loopFilterAcrossTilesEnabledFlag?: boolean
  ppsLoopFilterAcrossSlicesEnabledFlag: boolean
  deblockingFilterControlPresentFlag: boolean
  deblockingFilterOverrideEnabledFlag?: boolean
  ppsDeblockingFilterDisabledFlag?: boolean
  ppsBetaOffsetDiv2?: number
  ppsTcOffsetDiv2?: number
  ppsScalingListDataPresentFlag: boolean
  listsModificationPresentFlag: boolean
  log2ParallelMergeLevelMinus2: number
  sliceSegmentHeaderExtensionPresentFlag: boolean
}

/** Parse H.265 VPS NAL unit */
export function parseH265Vps(data: Uint8Array): H265Vps {
  const rbsp = removeEmulationPreventionBytes(data)
  const reader = new BitstreamReader(rbsp)

  // Skip NAL header (2 bytes for H.265)
  reader.readBits(16)

  const vpsVideoParameterSetId = reader.readBits(4)
  const vpsBaseLayerInternalFlag = reader.readBits(1) === 1
  const vpsBaseLayerAvailableFlag = reader.readBits(1) === 1
  const vpsMaxLayersMinus1 = reader.readBits(6)
  const vpsMaxSubLayersMinus1 = reader.readBits(3)
  const vpsTemporalIdNestingFlag = reader.readBits(1) === 1
  reader.readBits(16) // vps_reserved_0xffff_16bits

  const profileTierLevel = parseH265ProfileTierLevel(reader, true, vpsMaxSubLayersMinus1)

  return {
    vpsVideoParameterSetId,
    vpsBaseLayerInternalFlag,
    vpsBaseLayerAvailableFlag,
    vpsMaxLayersMinus1,
    vpsMaxSubLayersMinus1,
    vpsTemporalIdNestingFlag,
    profileTierLevel,
  }
}

/** Parse H.265 SPS NAL unit */
export function parseH265Sps(data: Uint8Array): H265Sps {
  const rbsp = removeEmulationPreventionBytes(data)
  const reader = new BitstreamReader(rbsp)

  // Skip NAL header (2 bytes for H.265)
  reader.readBits(16)

  const spsVideoParameterSetId = reader.readBits(4)
  const spsMaxSubLayersMinus1 = reader.readBits(3)
  const spsTemporalIdNestingFlag = reader.readBits(1) === 1

  const profileTierLevel = parseH265ProfileTierLevel(reader, true, spsMaxSubLayersMinus1)

  const spsSeqParameterSetId = readUe(reader)
  const chromaFormatIdc = readUe(reader)

  let separateColourPlaneFlag = false
  if (chromaFormatIdc === 3) {
    separateColourPlaneFlag = reader.readBits(1) === 1
  }

  const picWidthInLumaSamples = readUe(reader)
  const picHeightInLumaSamples = readUe(reader)
  const conformanceWindowFlag = reader.readBits(1) === 1

  let confWinLeftOffset: number | undefined
  let confWinRightOffset: number | undefined
  let confWinTopOffset: number | undefined
  let confWinBottomOffset: number | undefined

  if (conformanceWindowFlag) {
    confWinLeftOffset = readUe(reader)
    confWinRightOffset = readUe(reader)
    confWinTopOffset = readUe(reader)
    confWinBottomOffset = readUe(reader)
  }

  const bitDepthLumaMinus8 = readUe(reader)
  const bitDepthChromaMinus8 = readUe(reader)
  const log2MaxPicOrderCntLsbMinus4 = readUe(reader)
  const spsSubLayerOrderingInfoPresentFlag = reader.readBits(1) === 1

  const spsMaxDecPicBufferingMinus1: number[] = []
  const spsMaxNumReorderPics: number[] = []
  const spsMaxLatencyIncreasePlus1: number[] = []

  const startIdx = spsSubLayerOrderingInfoPresentFlag ? 0 : spsMaxSubLayersMinus1
  for (let i = startIdx; i <= spsMaxSubLayersMinus1; i++) {
    spsMaxDecPicBufferingMinus1[i] = readUe(reader)
    spsMaxNumReorderPics[i] = readUe(reader)
    spsMaxLatencyIncreasePlus1[i] = readUe(reader)
  }

  const log2MinLumaCodingBlockSizeMinus3 = readUe(reader)
  const log2DiffMaxMinLumaCodingBlockSize = readUe(reader)
  const log2MinLumaTransformBlockSizeMinus2 = readUe(reader)
  const log2DiffMaxMinLumaTransformBlockSize = readUe(reader)
  const maxTransformHierarchyDepthInter = readUe(reader)
  const maxTransformHierarchyDepthIntra = readUe(reader)

  const scalingListEnabledFlag = reader.readBits(1) === 1
  if (scalingListEnabledFlag) {
    const spsScalingListDataPresentFlag = reader.readBits(1) === 1
    if (spsScalingListDataPresentFlag) {
      parseScalingListData(reader)
    }
  }

  reader.readBits(1) // amp_enabled_flag
  reader.readBits(1) // sample_adaptive_offset_enabled_flag

  const pcmEnabledFlag = reader.readBits(1) === 1
  if (pcmEnabledFlag) {
    reader.readBits(4) // pcm_sample_bit_depth_luma_minus1
    reader.readBits(4) // pcm_sample_bit_depth_chroma_minus1
    readUe(reader) // log2_min_pcm_luma_coding_block_size_minus3
    readUe(reader) // log2_diff_max_min_pcm_luma_coding_block_size
    reader.readBits(1) // pcm_loop_filter_disabled_flag
  }

  const numShortTermRefPicSets = readUe(reader)
  for (let i = 0; i < numShortTermRefPicSets; i++) {
    parseShortTermRefPicSet(reader, i, numShortTermRefPicSets)
  }

  const longTermRefPicsPresentFlag = reader.readBits(1) === 1
  if (longTermRefPicsPresentFlag) {
    const numLongTermRefPicsSps = readUe(reader)
    for (let i = 0; i < numLongTermRefPicsSps; i++) {
      reader.readBits(log2MaxPicOrderCntLsbMinus4 + 4) // lt_ref_pic_poc_lsb_sps[i]
      reader.readBits(1) // used_by_curr_pic_lt_sps_flag[i]
    }
  }

  reader.readBits(1) // sps_temporal_mvp_enabled_flag
  reader.readBits(1) // strong_intra_smoothing_enabled_flag

  const vuiParametersPresentFlag = reader.readBits(1) === 1
  let vui: H265Vui | undefined

  if (vuiParametersPresentFlag) {
    vui = parseH265Vui(reader, spsMaxSubLayersMinus1)
  }

  // Calculate dimensions
  const subWidthC = chromaFormatIdc === 1 || chromaFormatIdc === 2 ? 2 : 1
  const subHeightC = chromaFormatIdc === 1 ? 2 : 1

  const width = picWidthInLumaSamples - subWidthC * ((confWinLeftOffset ?? 0) + (confWinRightOffset ?? 0))
  const height = picHeightInLumaSamples - subHeightC * ((confWinTopOffset ?? 0) + (confWinBottomOffset ?? 0))

  // Calculate FPS
  let fps: number | undefined
  if (vui?.vuiTimingInfoPresentFlag && vui.vuiNumUnitsInTick && vui.vuiTimeScale) {
    fps = vui.vuiTimeScale / vui.vuiNumUnitsInTick
  }

  return {
    spsVideoParameterSetId,
    spsMaxSubLayersMinus1,
    spsTemporalIdNestingFlag,
    profileTierLevel,
    spsSeqParameterSetId,
    chromaFormatIdc,
    separateColourPlaneFlag,
    picWidthInLumaSamples,
    picHeightInLumaSamples,
    conformanceWindowFlag,
    confWinLeftOffset,
    confWinRightOffset,
    confWinTopOffset,
    confWinBottomOffset,
    bitDepthLumaMinus8,
    bitDepthChromaMinus8,
    log2MaxPicOrderCntLsbMinus4,
    spsSubLayerOrderingInfoPresentFlag,
    spsMaxDecPicBufferingMinus1,
    spsMaxNumReorderPics,
    spsMaxLatencyIncreasePlus1,
    log2MinLumaCodingBlockSizeMinus3,
    log2DiffMaxMinLumaCodingBlockSize,
    log2MinLumaTransformBlockSizeMinus2,
    log2DiffMaxMinLumaTransformBlockSize,
    maxTransformHierarchyDepthInter,
    maxTransformHierarchyDepthIntra,
    vuiParametersPresentFlag,
    vui,
    width,
    height,
    bitDepthLuma: bitDepthLumaMinus8 + 8,
    bitDepthChroma: bitDepthChromaMinus8 + 8,
    fps,
  }
}

/** Parse H.265 PPS NAL unit */
export function parseH265Pps(data: Uint8Array): H265Pps {
  const rbsp = removeEmulationPreventionBytes(data)
  const reader = new BitstreamReader(rbsp)

  // Skip NAL header (2 bytes for H.265)
  reader.readBits(16)

  const ppsPicParameterSetId = readUe(reader)
  const ppsSeqParameterSetId = readUe(reader)
  const dependentSliceSegmentsEnabledFlag = reader.readBits(1) === 1
  const outputFlagPresentFlag = reader.readBits(1) === 1
  const numExtraSliceHeaderBits = reader.readBits(3)
  const signDataHidingEnabledFlag = reader.readBits(1) === 1
  const cabacInitPresentFlag = reader.readBits(1) === 1
  const numRefIdxL0DefaultActiveMinus1 = readUe(reader)
  const numRefIdxL1DefaultActiveMinus1 = readUe(reader)
  const initQpMinus26 = readSe(reader)
  const constrainedIntraPredFlag = reader.readBits(1) === 1
  const transformSkipEnabledFlag = reader.readBits(1) === 1
  const cuQpDeltaEnabledFlag = reader.readBits(1) === 1

  let diffCuQpDeltaDepth: number | undefined
  if (cuQpDeltaEnabledFlag) {
    diffCuQpDeltaDepth = readUe(reader)
  }

  const ppsCbQpOffset = readSe(reader)
  const ppsCrQpOffset = readSe(reader)
  const ppsSliceChromaQpOffsetsPresentFlag = reader.readBits(1) === 1
  const weightedPredFlag = reader.readBits(1) === 1
  const weightedBipredFlag = reader.readBits(1) === 1
  const transquantBypassEnabledFlag = reader.readBits(1) === 1
  const tilesEnabledFlag = reader.readBits(1) === 1
  const entropyCodingSyncEnabledFlag = reader.readBits(1) === 1

  let loopFilterAcrossTilesEnabledFlag: boolean | undefined
  if (tilesEnabledFlag) {
    const numTileColumnsMinus1 = readUe(reader)
    const numTileRowsMinus1 = readUe(reader)
    const uniformSpacingFlag = reader.readBits(1) === 1
    if (!uniformSpacingFlag) {
      for (let i = 0; i < numTileColumnsMinus1; i++) {
        readUe(reader) // column_width_minus1[i]
      }
      for (let i = 0; i < numTileRowsMinus1; i++) {
        readUe(reader) // row_height_minus1[i]
      }
    }
    loopFilterAcrossTilesEnabledFlag = reader.readBits(1) === 1
  }

  const ppsLoopFilterAcrossSlicesEnabledFlag = reader.readBits(1) === 1
  const deblockingFilterControlPresentFlag = reader.readBits(1) === 1

  let deblockingFilterOverrideEnabledFlag: boolean | undefined
  let ppsDeblockingFilterDisabledFlag: boolean | undefined
  let ppsBetaOffsetDiv2: number | undefined
  let ppsTcOffsetDiv2: number | undefined

  if (deblockingFilterControlPresentFlag) {
    deblockingFilterOverrideEnabledFlag = reader.readBits(1) === 1
    ppsDeblockingFilterDisabledFlag = reader.readBits(1) === 1
    if (!ppsDeblockingFilterDisabledFlag) {
      ppsBetaOffsetDiv2 = readSe(reader)
      ppsTcOffsetDiv2 = readSe(reader)
    }
  }

  const ppsScalingListDataPresentFlag = reader.readBits(1) === 1
  if (ppsScalingListDataPresentFlag) {
    parseScalingListData(reader)
  }

  const listsModificationPresentFlag = reader.readBits(1) === 1
  const log2ParallelMergeLevelMinus2 = readUe(reader)
  const sliceSegmentHeaderExtensionPresentFlag = reader.readBits(1) === 1

  return {
    ppsPicParameterSetId,
    ppsSeqParameterSetId,
    dependentSliceSegmentsEnabledFlag,
    outputFlagPresentFlag,
    numExtraSliceHeaderBits,
    signDataHidingEnabledFlag,
    cabacInitPresentFlag,
    numRefIdxL0DefaultActiveMinus1,
    numRefIdxL1DefaultActiveMinus1,
    initQpMinus26,
    constrainedIntraPredFlag,
    transformSkipEnabledFlag,
    cuQpDeltaEnabledFlag,
    diffCuQpDeltaDepth,
    ppsCbQpOffset,
    ppsCrQpOffset,
    ppsSliceChromaQpOffsetsPresentFlag,
    weightedPredFlag,
    weightedBipredFlag,
    transquantBypassEnabledFlag,
    tilesEnabledFlag,
    entropyCodingSyncEnabledFlag,
    loopFilterAcrossTilesEnabledFlag,
    ppsLoopFilterAcrossSlicesEnabledFlag,
    deblockingFilterControlPresentFlag,
    deblockingFilterOverrideEnabledFlag,
    ppsDeblockingFilterDisabledFlag,
    ppsBetaOffsetDiv2,
    ppsTcOffsetDiv2,
    ppsScalingListDataPresentFlag,
    listsModificationPresentFlag,
    log2ParallelMergeLevelMinus2,
    sliceSegmentHeaderExtensionPresentFlag,
  }
}

/** Parse H.265 Profile/Tier/Level */
function parseH265ProfileTierLevel(reader: BitstreamReader, profilePresentFlag: boolean, maxSubLayersMinus1: number): H265ProfileTierLevel {
  let generalProfileSpace = 0
  let generalTierFlag = false
  let generalProfileIdc = 0
  let generalProfileCompatibilityFlags = 0
  let generalConstraintIndicatorFlags = 0n

  if (profilePresentFlag) {
    generalProfileSpace = reader.readBits(2)
    generalTierFlag = reader.readBits(1) === 1
    generalProfileIdc = reader.readBits(5)
    generalProfileCompatibilityFlags = reader.readBits(32)

    // 48 bits of constraint flags
    const high = reader.readBits(16)
    const mid = reader.readBits(16)
    const low = reader.readBits(16)
    generalConstraintIndicatorFlags = (BigInt(high) << 32n) | (BigInt(mid) << 16n) | BigInt(low)
  }

  const generalLevelIdc = reader.readBits(8)

  // Skip sub-layer info
  const subLayerProfilePresentFlag: boolean[] = []
  const subLayerLevelPresentFlag: boolean[] = []

  for (let i = 0; i < maxSubLayersMinus1; i++) {
    subLayerProfilePresentFlag[i] = reader.readBits(1) === 1
    subLayerLevelPresentFlag[i] = reader.readBits(1) === 1
  }

  if (maxSubLayersMinus1 > 0) {
    for (let i = maxSubLayersMinus1; i < 8; i++) {
      reader.readBits(2) // reserved_zero_2bits
    }
  }

  for (let i = 0; i < maxSubLayersMinus1; i++) {
    if (subLayerProfilePresentFlag[i]) {
      reader.readBits(2) // sub_layer_profile_space
      reader.readBits(1) // sub_layer_tier_flag
      reader.readBits(5) // sub_layer_profile_idc
      reader.readBits(32) // sub_layer_profile_compatibility_flag
      reader.readBits(48) // constraint flags
    }
    if (subLayerLevelPresentFlag[i]) {
      reader.readBits(8) // sub_layer_level_idc
    }
  }

  return {
    generalProfileSpace,
    generalTierFlag,
    generalProfileIdc,
    generalProfileCompatibilityFlags,
    generalConstraintIndicatorFlags,
    generalLevelIdc,
  }
}

/** Parse H.265 VUI parameters */
function parseH265Vui(reader: BitstreamReader, _maxSubLayersMinus1: number): H265Vui {
  const aspectRatioInfoPresentFlag = reader.readBits(1) === 1
  let aspectRatioIdc: number | undefined
  let sarWidth: number | undefined
  let sarHeight: number | undefined

  if (aspectRatioInfoPresentFlag) {
    aspectRatioIdc = reader.readBits(8)
    if (aspectRatioIdc === EXTENDED_SAR) {
      sarWidth = reader.readBits(16)
      sarHeight = reader.readBits(16)
    }
  }

  const overscanInfoPresentFlag = reader.readBits(1) === 1
  let overscanAppropriateFlag: boolean | undefined
  if (overscanInfoPresentFlag) {
    overscanAppropriateFlag = reader.readBits(1) === 1
  }

  const videoSignalTypePresentFlag = reader.readBits(1) === 1
  let videoFormat: number | undefined
  let videoFullRangeFlag: boolean | undefined
  let colourDescriptionPresentFlag: boolean | undefined
  let colourPrimaries: number | undefined
  let transferCharacteristics: number | undefined
  let matrixCoeffs: number | undefined

  if (videoSignalTypePresentFlag) {
    videoFormat = reader.readBits(3)
    videoFullRangeFlag = reader.readBits(1) === 1
    colourDescriptionPresentFlag = reader.readBits(1) === 1
    if (colourDescriptionPresentFlag) {
      colourPrimaries = reader.readBits(8)
      transferCharacteristics = reader.readBits(8)
      matrixCoeffs = reader.readBits(8)
    }
  }

  const chromaLocInfoPresentFlag = reader.readBits(1) === 1
  let chromaSampleLocTypeTopField: number | undefined
  let chromaSampleLocTypeBottomField: number | undefined

  if (chromaLocInfoPresentFlag) {
    chromaSampleLocTypeTopField = readUe(reader)
    chromaSampleLocTypeBottomField = readUe(reader)
  }

  const neutralChromaIndicationFlag = reader.readBits(1) === 1
  const fieldSeqFlag = reader.readBits(1) === 1
  const frameFieldInfoPresentFlag = reader.readBits(1) === 1

  const defaultDisplayWindowFlag = reader.readBits(1) === 1
  let defDispWinLeftOffset: number | undefined
  let defDispWinRightOffset: number | undefined
  let defDispWinTopOffset: number | undefined
  let defDispWinBottomOffset: number | undefined

  if (defaultDisplayWindowFlag) {
    defDispWinLeftOffset = readUe(reader)
    defDispWinRightOffset = readUe(reader)
    defDispWinTopOffset = readUe(reader)
    defDispWinBottomOffset = readUe(reader)
  }

  const vuiTimingInfoPresentFlag = reader.readBits(1) === 1
  let vuiNumUnitsInTick: number | undefined
  let vuiTimeScale: number | undefined
  let vuiPocProportionalToTimingFlag: boolean | undefined
  let vuiNumTicksPocDiffOneMinus1: number | undefined
  let vuiHrdParametersPresentFlag: boolean | undefined

  if (vuiTimingInfoPresentFlag) {
    vuiNumUnitsInTick = reader.readBits(32)
    vuiTimeScale = reader.readBits(32)
    vuiPocProportionalToTimingFlag = reader.readBits(1) === 1
    if (vuiPocProportionalToTimingFlag) {
      vuiNumTicksPocDiffOneMinus1 = readUe(reader)
    }
    vuiHrdParametersPresentFlag = reader.readBits(1) === 1
    if (vuiHrdParametersPresentFlag) {
      // Skip HRD parameters parsing - complex
    }
  }

  const bitstreamRestrictionFlag = reader.readBits(1) === 1
  if (bitstreamRestrictionFlag) {
    reader.readBits(1) // tiles_fixed_structure_flag
    reader.readBits(1) // motion_vectors_over_pic_boundaries_flag
    reader.readBits(1) // restricted_ref_pic_lists_flag
    readUe(reader) // min_spatial_segmentation_idc
    readUe(reader) // max_bytes_per_pic_denom
    readUe(reader) // max_bits_per_min_cu_denom
    readUe(reader) // log2_max_mv_length_horizontal
    readUe(reader) // log2_max_mv_length_vertical
  }

  return {
    aspectRatioInfoPresentFlag,
    aspectRatioIdc,
    sarWidth,
    sarHeight,
    overscanInfoPresentFlag,
    overscanAppropriateFlag,
    videoSignalTypePresentFlag,
    videoFormat,
    videoFullRangeFlag,
    colourDescriptionPresentFlag,
    colourPrimaries,
    transferCharacteristics,
    matrixCoeffs,
    chromaLocInfoPresentFlag,
    chromaSampleLocTypeTopField,
    chromaSampleLocTypeBottomField,
    neutralChromaIndicationFlag,
    fieldSeqFlag,
    frameFieldInfoPresentFlag,
    defaultDisplayWindowFlag,
    defDispWinLeftOffset,
    defDispWinRightOffset,
    defDispWinTopOffset,
    defDispWinBottomOffset,
    vuiTimingInfoPresentFlag,
    vuiNumUnitsInTick,
    vuiTimeScale,
    vuiPocProportionalToTimingFlag,
    vuiNumTicksPocDiffOneMinus1,
    vuiHrdParametersPresentFlag,
    bitstreamRestrictionFlag,
  }
}

/** Parse scaling list data (skip) */
function parseScalingListData(reader: BitstreamReader): void {
  for (let sizeId = 0; sizeId < 4; sizeId++) {
    const numMatrices = sizeId === 3 ? 2 : 6
    for (let matrixId = 0; matrixId < numMatrices; matrixId++) {
      const scalingListPredModeFlag = reader.readBits(1) === 1
      if (!scalingListPredModeFlag) {
        readUe(reader) // scaling_list_pred_matrix_id_delta
      }
      else {
        const coefNum = Math.min(64, 1 << (4 + (sizeId << 1)))
        if (sizeId > 1) {
          readSe(reader) // scaling_list_dc_coef_minus8
        }
        for (let i = 0; i < coefNum; i++) {
          readSe(reader) // scaling_list_delta_coef
        }
      }
    }
  }
}

/** Parse short-term reference picture set (skip) */
function parseShortTermRefPicSet(reader: BitstreamReader, stRpsIdx: number, numShortTermRefPicSets: number): void {
  let interRefPicSetPredictionFlag = false
  if (stRpsIdx !== 0) {
    interRefPicSetPredictionFlag = reader.readBits(1) === 1
  }

  if (interRefPicSetPredictionFlag) {
    if (stRpsIdx === numShortTermRefPicSets) {
      readUe(reader) // delta_idx_minus1
    }
    reader.readBits(1) // delta_rps_sign
    readUe(reader) // abs_delta_rps_minus1
    // Skip the rest - requires previous RPS state
  }
  else {
    const numNegativePics = readUe(reader)
    const numPositivePics = readUe(reader)
    for (let i = 0; i < numNegativePics; i++) {
      readUe(reader) // delta_poc_s0_minus1[i]
      reader.readBits(1) // used_by_curr_pic_s0_flag[i]
    }
    for (let i = 0; i < numPositivePics; i++) {
      readUe(reader) // delta_poc_s1_minus1[i]
      reader.readBits(1) // used_by_curr_pic_s1_flag[i]
    }
  }
}

/** Get H.265 profile name */
export function getH265ProfileName(profileIdc: number): string {
  const profiles: Record<number, string> = {
    1: 'Main',
    2: 'Main 10',
    3: 'Main Still Picture',
    4: 'Range Extensions',
    5: 'High Throughput',
    6: 'Multiview Main',
    7: 'Scalable Main',
    8: 'Main 3D',
    9: 'Screen Extended',
    10: 'Scalable Range Extensions',
    11: 'High Throughput Screen Extended',
  }
  return profiles[profileIdc] ?? `Unknown (${profileIdc})`
}

/** Get H.265 tier name */
export function getH265TierName(tierFlag: boolean): string {
  return tierFlag ? 'High' : 'Main'
}

/** Get H.265 level name */
export function getH265LevelName(levelIdc: number): string {
  const major = Math.floor(levelIdc / 30)
  const minor = (levelIdc % 30) / 3
  return minor === 0 ? `${major}` : `${major}.${minor}`
}

/** Generate hvc1/hev1 codec string */
export function generateHevcCodecString(sps: H265Sps): string {
  const ptl = sps.profileTierLevel
  const profile = ptl.generalProfileIdc
  const tier = ptl.generalTierFlag ? 'H' : 'L'
  const level = ptl.generalLevelIdc

  // Build constraint string
  const constraintBytes: number[] = []
  let constraints = ptl.generalConstraintIndicatorFlags
  for (let i = 0; i < 6; i++) {
    constraintBytes.push(Number(constraints & 0xffn))
    constraints >>= 8n
  }
  constraintBytes.reverse()

  // Remove trailing zeros
  while (constraintBytes.length > 0 && constraintBytes[constraintBytes.length - 1] === 0) {
    constraintBytes.pop()
  }

  const constraintStr = constraintBytes.map((b) => b.toString(16).toUpperCase()).join('.')
  return `hvc1.${profile}.${ptl.generalProfileCompatibilityFlags.toString(16)}.${tier}${level}${constraintStr ? '.' + constraintStr : ''}`
}

// ============================================================================
// AAC Parser
// ============================================================================

/** AAC audio object types */
export const AacObjectType = {
  NULL: 0,
  AAC_MAIN: 1,
  AAC_LC: 2,
  AAC_SSR: 3,
  AAC_LTP: 4,
  SBR: 5,
  AAC_SCALABLE: 6,
  TWINVQ: 7,
  CELP: 8,
  HVXC: 9,
  TTSI: 12,
  MAIN_SYNTHETIC: 13,
  WAVETABLE_SYNTHESIS: 14,
  GENERAL_MIDI: 15,
  ALGORITHMIC_SYNTHESIS_AUDIO_FX: 16,
  ER_AAC_LC: 17,
  ER_AAC_LTP: 19,
  ER_AAC_SCALABLE: 20,
  ER_TWINVQ: 21,
  ER_BSAC: 22,
  ER_AAC_LD: 23,
  ER_CELP: 24,
  ER_HVXC: 25,
  ER_HILN: 26,
  ER_PARAMETRIC: 27,
  SSC: 28,
  PS: 29,
  MPEG_SURROUND: 30,
  LAYER_1: 32,
  LAYER_2: 33,
  LAYER_3: 34,
  DST: 35,
  ALS: 36,
  SLS: 37,
  SLS_NON_CORE: 38,
  ER_AAC_ELD: 39,
  SMR_SIMPLE: 40,
  SMR_MAIN: 41,
  USAC_NO_SBR: 42,
  SAOC: 43,
  LD_MPEG_SURROUND: 44,
  USAC: 45,
} as const

/** AAC sampling frequencies */
export const AAC_SAMPLE_RATES: number[] = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
]

/** AAC channel configurations */
export const AAC_CHANNEL_CONFIGS: number[] = [
  0, // defined in AOT specific config
  1, // 1 channel: front-center
  2, // 2 channels: front-left, front-right
  3, // 3 channels: front-center, front-left, front-right
  4, // 4 channels: front-center, front-left, front-right, back-center
  5, // 5 channels: front-center, front-left, front-right, back-left, back-right
  6, // 6 channels: front-center, front-left, front-right, back-left, back-right, LFE
  8, // 8 channels: front-center, front-left, front-right, side-left, side-right, back-left, back-right, LFE
]

/** Parsed AAC Audio Specific Config */
export interface AacAudioSpecificConfig {
  audioObjectType: number
  samplingFrequencyIndex: number
  samplingFrequency: number
  channelConfiguration: number
  channels: number
  frameLengthFlag?: boolean
  dependsOnCoreCoder?: boolean
  extensionFlag?: boolean

  // SBR/PS extension
  sbrPresentFlag?: boolean
  psPresentFlag?: boolean
  extensionAudioObjectType?: number
  extensionSamplingFrequencyIndex?: number
  extensionSamplingFrequency?: number
  extensionChannelConfiguration?: number
}

/** Parsed ADTS header */
export interface AdtsHeader {
  syncWord: number
  id: number // 0 = MPEG-4, 1 = MPEG-2
  layer: number
  protectionAbsent: boolean
  profile: number // audioObjectType - 1
  samplingFrequencyIndex: number
  privateBit: boolean
  channelConfiguration: number
  originalCopy: boolean
  home: boolean
  copyrightIdentificationBit: boolean
  copyrightIdentificationStart: boolean
  frameLength: number
  adtsBufferFullness: number
  numberOfRawDataBlocksInFrame: number
  crcCheck?: number

  // Derived values
  samplingFrequency: number
  channels: number
  audioObjectType: number
}

/** Parse AAC Audio Specific Config */
export function parseAacAudioSpecificConfig(data: Uint8Array): AacAudioSpecificConfig {
  const reader = new BitstreamReader(data)

  let audioObjectType = reader.readBits(5)
  if (audioObjectType === 31) {
    audioObjectType = 32 + reader.readBits(6)
  }

  let samplingFrequencyIndex = reader.readBits(4)
  let samplingFrequency: number

  if (samplingFrequencyIndex === 15) {
    samplingFrequency = reader.readBits(24)
  }
  else {
    samplingFrequency = AAC_SAMPLE_RATES[samplingFrequencyIndex] ?? 0
  }

  const channelConfiguration = reader.readBits(4)
  const channels = AAC_CHANNEL_CONFIGS[channelConfiguration] ?? channelConfiguration

  let sbrPresentFlag: boolean | undefined
  let psPresentFlag: boolean | undefined
  let extensionAudioObjectType: number | undefined
  let extensionSamplingFrequencyIndex: number | undefined
  let extensionSamplingFrequency: number | undefined
  let extensionChannelConfiguration: number | undefined

  // Check for SBR (Spectral Band Replication) or PS (Parametric Stereo)
  if (audioObjectType === AacObjectType.SBR || audioObjectType === AacObjectType.PS) {
    extensionAudioObjectType = audioObjectType
    sbrPresentFlag = true
    if (audioObjectType === AacObjectType.PS) {
      psPresentFlag = true
    }
    extensionSamplingFrequencyIndex = reader.readBits(4)
    if (extensionSamplingFrequencyIndex === 15) {
      extensionSamplingFrequency = reader.readBits(24)
    }
    else {
      extensionSamplingFrequency = AAC_SAMPLE_RATES[extensionSamplingFrequencyIndex] ?? 0
    }
    audioObjectType = reader.readBits(5)
    if (audioObjectType === 31) {
      audioObjectType = 32 + reader.readBits(6)
    }
    if (audioObjectType === AacObjectType.ER_BSAC) {
      extensionChannelConfiguration = reader.readBits(4)
    }
  }

  // Parse GASpecificConfig for common object types
  let frameLengthFlag: boolean | undefined
  let dependsOnCoreCoder: boolean | undefined
  let extensionFlag: boolean | undefined

  if (
    audioObjectType === AacObjectType.AAC_MAIN ||
    audioObjectType === AacObjectType.AAC_LC ||
    audioObjectType === AacObjectType.AAC_SSR ||
    audioObjectType === AacObjectType.AAC_LTP ||
    audioObjectType === AacObjectType.AAC_SCALABLE ||
    audioObjectType === AacObjectType.TWINVQ ||
    audioObjectType === AacObjectType.ER_AAC_LC ||
    audioObjectType === AacObjectType.ER_AAC_LTP ||
    audioObjectType === AacObjectType.ER_AAC_SCALABLE ||
    audioObjectType === AacObjectType.ER_TWINVQ ||
    audioObjectType === AacObjectType.ER_BSAC ||
    audioObjectType === AacObjectType.ER_AAC_LD
  ) {
    frameLengthFlag = reader.readBits(1) === 1
    dependsOnCoreCoder = reader.readBits(1) === 1
    if (dependsOnCoreCoder) {
      reader.readBits(14) // coreCoderDelay
    }
    extensionFlag = reader.readBits(1) === 1
  }

  // Check for implicit SBR/PS signaling
  if (reader.bitsRemaining >= 11) {
    const syncExtensionType = reader.readBits(11)
    if (syncExtensionType === 0x2b7) {
      extensionAudioObjectType = reader.readBits(5)
      if (extensionAudioObjectType === 31) {
        extensionAudioObjectType = 32 + reader.readBits(6)
      }
      if (extensionAudioObjectType === AacObjectType.SBR) {
        sbrPresentFlag = reader.readBits(1) === 1
        if (sbrPresentFlag) {
          extensionSamplingFrequencyIndex = reader.readBits(4)
          if (extensionSamplingFrequencyIndex === 15) {
            extensionSamplingFrequency = reader.readBits(24)
          }
          else {
            extensionSamplingFrequency = AAC_SAMPLE_RATES[extensionSamplingFrequencyIndex] ?? 0
          }
          if (reader.bitsRemaining >= 12) {
            const syncExtensionType2 = reader.readBits(11)
            if (syncExtensionType2 === 0x548) {
              psPresentFlag = reader.readBits(1) === 1
            }
          }
        }
      }
      else if (extensionAudioObjectType === AacObjectType.PS) {
        sbrPresentFlag = reader.readBits(1) === 1
        if (sbrPresentFlag) {
          extensionSamplingFrequencyIndex = reader.readBits(4)
          if (extensionSamplingFrequencyIndex === 15) {
            extensionSamplingFrequency = reader.readBits(24)
          }
          else {
            extensionSamplingFrequency = AAC_SAMPLE_RATES[extensionSamplingFrequencyIndex] ?? 0
          }
        }
        psPresentFlag = reader.readBits(1) === 1
      }
    }
  }

  return {
    audioObjectType,
    samplingFrequencyIndex,
    samplingFrequency,
    channelConfiguration,
    channels,
    frameLengthFlag,
    dependsOnCoreCoder,
    extensionFlag,
    sbrPresentFlag,
    psPresentFlag,
    extensionAudioObjectType,
    extensionSamplingFrequencyIndex,
    extensionSamplingFrequency,
    extensionChannelConfiguration,
  }
}

/** Parse ADTS header */
export function parseAdtsHeader(data: Uint8Array): AdtsHeader | null {
  if (data.length < 7) return null

  const syncWord = (data[0] << 4) | (data[1] >> 4)
  if (syncWord !== 0xfff) return null

  const id = (data[1] >> 3) & 0x01
  const layer = (data[1] >> 1) & 0x03
  const protectionAbsent = (data[1] & 0x01) === 1
  const profile = (data[2] >> 6) & 0x03
  const samplingFrequencyIndex = (data[2] >> 2) & 0x0f
  const privateBit = ((data[2] >> 1) & 0x01) === 1
  const channelConfiguration = ((data[2] & 0x01) << 2) | ((data[3] >> 6) & 0x03)
  const originalCopy = ((data[3] >> 5) & 0x01) === 1
  const home = ((data[3] >> 4) & 0x01) === 1
  const copyrightIdentificationBit = ((data[3] >> 3) & 0x01) === 1
  const copyrightIdentificationStart = ((data[3] >> 2) & 0x01) === 1
  const frameLength = ((data[3] & 0x03) << 11) | (data[4] << 3) | ((data[5] >> 5) & 0x07)
  const adtsBufferFullness = ((data[5] & 0x1f) << 6) | ((data[6] >> 2) & 0x3f)
  const numberOfRawDataBlocksInFrame = data[6] & 0x03

  let crcCheck: number | undefined
  if (!protectionAbsent && data.length >= 9) {
    crcCheck = (data[7] << 8) | data[8]
  }

  const samplingFrequency = AAC_SAMPLE_RATES[samplingFrequencyIndex] ?? 0
  const channels = AAC_CHANNEL_CONFIGS[channelConfiguration] ?? channelConfiguration
  const audioObjectType = profile + 1

  return {
    syncWord,
    id,
    layer,
    protectionAbsent,
    profile,
    samplingFrequencyIndex,
    privateBit,
    channelConfiguration,
    originalCopy,
    home,
    copyrightIdentificationBit,
    copyrightIdentificationStart,
    frameLength,
    adtsBufferFullness,
    numberOfRawDataBlocksInFrame,
    crcCheck,
    samplingFrequency,
    channels,
    audioObjectType,
  }
}

/** Get AAC object type name */
export function getAacObjectTypeName(objectType: number): string {
  const types: Record<number, string> = {
    1: 'AAC Main',
    2: 'AAC LC',
    3: 'AAC SSR',
    4: 'AAC LTP',
    5: 'SBR',
    6: 'AAC Scalable',
    17: 'ER AAC LC',
    19: 'ER AAC LTP',
    20: 'ER AAC Scalable',
    22: 'ER BSAC',
    23: 'ER AAC LD',
    29: 'PS',
    39: 'ER AAC ELD',
    42: 'USAC',
  }
  return types[objectType] ?? `Unknown (${objectType})`
}

/** Generate mp4a codec string */
export function generateMp4aCodecString(config: AacAudioSpecificConfig): string {
  // mp4a.40.{audioObjectType}
  return `mp4a.40.${config.audioObjectType}`
}

/** Create AAC Audio Specific Config bytes */
export function createAacAudioSpecificConfig(
  audioObjectType: number,
  samplingFrequencyIndex: number,
  channelConfiguration: number,
): Uint8Array {
  // Most configs fit in 2 bytes
  if (audioObjectType < 31 && samplingFrequencyIndex < 15) {
    const byte1 = (audioObjectType << 3) | (samplingFrequencyIndex >> 1)
    const byte2 = ((samplingFrequencyIndex & 0x01) << 7) | (channelConfiguration << 3)
    return new Uint8Array([byte1, byte2])
  }

  // Extended format
  const bytes: number[] = []

  if (audioObjectType >= 31) {
    bytes.push(0xf8 | (((audioObjectType - 32) >> 3) & 0x07))
    bytes.push((((audioObjectType - 32) & 0x07) << 5) | (samplingFrequencyIndex >= 15 ? 0x1e : samplingFrequencyIndex << 1) | (channelConfiguration >> 3))
  }
  else {
    bytes.push((audioObjectType << 3) | (samplingFrequencyIndex >= 15 ? 0x07 : samplingFrequencyIndex >> 1))
    if (samplingFrequencyIndex >= 15) {
      // Need to add 24-bit sampling frequency - handled separately
      bytes.push((channelConfiguration << 3))
    }
    else {
      bytes.push(((samplingFrequencyIndex & 0x01) << 7) | (channelConfiguration << 3))
    }
  }

  return new Uint8Array(bytes)
}

// ============================================================================
// NAL Unit Utilities
// ============================================================================

/** Split Annex B NAL units */
export function splitAnnexBNalUnits(data: Uint8Array): Uint8Array[] {
  const nalUnits: Uint8Array[] = []
  let start = 0
  let i = 0

  // Find start codes (0x000001 or 0x00000001)
  while (i < data.length - 2) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) {
        // Found 3-byte start code
        if (i > start) {
          // Remove trailing zeros from previous NAL
          let end = i
          while (end > start && data[end - 1] === 0) end--
          if (end > start) {
            nalUnits.push(data.slice(start, end))
          }
        }
        start = i + 3
        i += 3
      }
      else if (i < data.length - 3 && data[i + 2] === 0 && data[i + 3] === 1) {
        // Found 4-byte start code
        if (i > start) {
          let end = i
          while (end > start && data[end - 1] === 0) end--
          if (end > start) {
            nalUnits.push(data.slice(start, end))
          }
        }
        start = i + 4
        i += 4
      }
      else {
        i++
      }
    }
    else {
      i++
    }
  }

  // Add last NAL unit
  if (start < data.length) {
    nalUnits.push(data.slice(start))
  }

  return nalUnits
}

/** Convert Annex B to AVCC/HVCC format (length-prefixed) */
export function annexBToAvcc(data: Uint8Array, lengthSize: number = 4): Uint8Array {
  const nalUnits = splitAnnexBNalUnits(data)
  let totalSize = 0

  for (const nal of nalUnits) {
    totalSize += lengthSize + nal.length
  }

  const result = new Uint8Array(totalSize)
  let offset = 0

  for (const nal of nalUnits) {
    // Write length prefix
    const len = nal.length
    if (lengthSize === 4) {
      result[offset++] = (len >> 24) & 0xff
      result[offset++] = (len >> 16) & 0xff
      result[offset++] = (len >> 8) & 0xff
      result[offset++] = len & 0xff
    }
    else if (lengthSize === 2) {
      result[offset++] = (len >> 8) & 0xff
      result[offset++] = len & 0xff
    }
    else if (lengthSize === 1) {
      result[offset++] = len & 0xff
    }
    result.set(nal, offset)
    offset += nal.length
  }

  return result
}

/** Convert AVCC/HVCC format to Annex B */
export function avccToAnnexB(data: Uint8Array, lengthSize: number = 4): Uint8Array {
  const nalUnits: Uint8Array[] = []
  let offset = 0

  while (offset < data.length - lengthSize) {
    let len = 0
    if (lengthSize === 4) {
      len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    }
    else if (lengthSize === 2) {
      len = (data[offset] << 8) | data[offset + 1]
    }
    else if (lengthSize === 1) {
      len = data[offset]
    }
    offset += lengthSize

    if (len > 0 && offset + len <= data.length) {
      nalUnits.push(data.slice(offset, offset + len))
      offset += len
    }
    else {
      break
    }
  }

  // Calculate total size with start codes
  let totalSize = 0
  for (const nal of nalUnits) {
    totalSize += 4 + nal.length // 4-byte start code
  }

  const result = new Uint8Array(totalSize)
  let resultOffset = 0

  for (const nal of nalUnits) {
    // Write 4-byte start code
    result[resultOffset++] = 0
    result[resultOffset++] = 0
    result[resultOffset++] = 0
    result[resultOffset++] = 1
    result.set(nal, resultOffset)
    resultOffset += nal.length
  }

  return result
}

/** Get H.264 NAL type from NAL header byte */
export function getH264NalType(nalHeader: number): number {
  return nalHeader & 0x1f
}

/** Get H.265 NAL type from first two NAL header bytes */
export function getH265NalType(nalHeader0: number, _nalHeader1: number): number {
  return (nalHeader0 >> 1) & 0x3f
}

/** Check if NAL unit is a keyframe (IDR for H.264, IDR/CRA/BLA for H.265) */
export function isKeyframeNal(nalType: number, isHevc: boolean): boolean {
  if (isHevc) {
    return (
      nalType === H265NalType.IDR_W_RADL ||
      nalType === H265NalType.IDR_N_LP ||
      nalType === H265NalType.CRA_NUT ||
      nalType === H265NalType.BLA_W_LP ||
      nalType === H265NalType.BLA_W_RADL ||
      nalType === H265NalType.BLA_N_LP
    )
  }
  else {
    return nalType === H264NalType.SLICE_IDR
  }
}

/** Extract SPS/PPS from H.264 Annex B stream */
export function extractH264ParameterSets(data: Uint8Array): { sps: Uint8Array[]; pps: Uint8Array[] } {
  const nalUnits = splitAnnexBNalUnits(data)
  const sps: Uint8Array[] = []
  const pps: Uint8Array[] = []

  for (const nal of nalUnits) {
    if (nal.length > 0) {
      const nalType = getH264NalType(nal[0])
      if (nalType === H264NalType.SPS) {
        sps.push(nal)
      }
      else if (nalType === H264NalType.PPS) {
        pps.push(nal)
      }
    }
  }

  return { sps, pps }
}

/** Extract VPS/SPS/PPS from H.265 Annex B stream */
export function extractH265ParameterSets(data: Uint8Array): { vps: Uint8Array[]; sps: Uint8Array[]; pps: Uint8Array[] } {
  const nalUnits = splitAnnexBNalUnits(data)
  const vps: Uint8Array[] = []
  const sps: Uint8Array[] = []
  const pps: Uint8Array[] = []

  for (const nal of nalUnits) {
    if (nal.length >= 2) {
      const nalType = getH265NalType(nal[0], nal[1])
      if (nalType === H265NalType.VPS) {
        vps.push(nal)
      }
      else if (nalType === H265NalType.SPS) {
        sps.push(nal)
      }
      else if (nalType === H265NalType.PPS) {
        pps.push(nal)
      }
    }
  }

  return { vps, sps, pps }
}
