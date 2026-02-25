// Configuration
export { config } from './config'

// Types
export * from './types'

// Utilities
export * from './utils'

// Binary I/O
export { Reader, FileSlice } from './reader'
export type { Source } from './reader'
export { Writer } from './writer'
export type { Target } from './writer'
export { BitstreamReader, BitstreamWriter, removeEmulationPreventionBytes, addEmulationPreventionBytes } from './bitstream'

// Source implementations
export { BufferSource, BlobSource, FileSource, UrlSource, StreamSource, createSource } from './source'

// Target implementations
export { BufferTarget, FileTarget, StreamTarget, NullTarget, CallbackTarget, createTarget } from './target'

// Base classes for codec implementations
export { Demuxer, InputFormat } from './demuxer'
export { Muxer, OutputFormat } from './muxer'
export type { OutputVideoTrack, OutputAudioTrack, OutputSubtitleTrack, OutputTrack } from './muxer'

// High-level API
export { Input } from './input'
export { Output } from './output'
export { Conversion } from './conversion'

// Format registry
export { FormatRegistry, registerFormat, detectFormat, ALL_FORMATS } from './formats'

// Media sources for encoding input
export * from './sources'

// Media sinks for decoded sample access
export * from './sinks'

// Thumbnail and frame extraction
export * from './thumbnails'

// Waveform generation
export * from './waveform'

// Audio analysis
export * from './audio-analysis'

// HDR and color space detection
export {
  ColorPrimaries, TransferCharacteristics, MatrixCoefficients, ColorRange,
  HdrFormat, type ColorSpaceInfo, type HdrMetadata as ColorHdrMetadata, type MasteringDisplayMetadata as ColorMasteringDisplayMetadata,
  detectHdrFormat as detectHdrFormatFromColorSpace, isHdr, isWideColorGamut, getColorSpaceName,
  parseVuiColorSpace, parseHdr10Sei, parseContentLightLevelSei,
  parseDolbyVisionConfig, STANDARD_PRIMARIES, createDefaultHdr10Metadata,
  toVideoColorSpaceInit, fromVideoColorSpace,
} from './color'

// Streaming utilities
export * from './streaming'

// Cover art extraction
export * from './cover-art'

// HLS manifest generation
export * from './hls'

// DASH manifest generation
export * from './dash'

// Video filters
export * from './filters'

// Audio effects
export * from './audio-effects'

// Codec configuration parsing
export * from './codecs'

// Chapter support
export * from './chapters'

// Image sequence support - exclude names that conflict with thumbnails/cover-art
export {
  type ImageFormat, type ImageSequenceReaderOptions, type ImageSequenceWriterOptions,
  type SequenceFrame, type ImageSequenceInfo, type PatternMatch,
  SEQUENCE_PATTERNS,
  detectImageFormat as detectImageSequenceFormat,
  getFormatExtension, parsePattern, generateFilename,
  extractFrameNumber, detectPattern,
  findSequenceFrames, findMissingFrames,
  ImageSequenceReader, ImageSequenceWriter,
  type SpriteSheetOptions as ImageSpriteSheetOptions,
  type SpriteSheetInfo,
  calculateSpriteSheetLayout, getSpritePosition,
  generateSpriteSheetCss,
  type InterpolationMethod, type FrameRateConversionOptions,
  calculateFrameMapping, calculateSimpleFrameMapping,
  createSequenceFromTimestamps, validateSequence,
  estimateSequenceSize, formatBytes,
  getRecommendedSettings,
} from './image-sequence'

// Metadata reading/writing - exclude names that conflict with cover-art
export {
  type MediaMetadata,
  COVER_ART_TYPE_IDS, getCoverArtTypeFromId,
  parseMp4Metadata, createMp4MetadataAtoms,
  parseId3v2, createId3v2Tag,
  parseVorbisComments, createVorbisComments,
  parseFlacPicture as parseFlacPictureMetadata,
  createFlacPicture,
  parseMatroskaTags,
  detectMetadataFormat, parseMetadata,
  mergeMetadata, formatMetadataSummary,
  type CoverArt as MetadataCoverArt,
  type CoverArtType as MetadataCoverArtType,
} from './metadata'

// Media validation
export * from './validation'

// Subtitle support (SRT, VTT, ASS, TTML) - exclude names that conflict with types
export {
  type SubtitleCue as SubtitleFileCue,
  type SubtitleTrack as SubtitleFileTrack,
  type SubtitleFormat, type SubtitleStyle, type SubtitlePosition,
  type AssStyle,
  parseSrt, generateSrt,
  parseVtt, generateVtt,
  parseAss, generateAss,
  parseTtml, generateTtml,
  parseSubtitles, generateSubtitles,
  detectSubtitleFormat,
  convertSubtitles,
  shiftSubtitles, scaleSubtitles,
  mergeSubtitles, filterSubtitlesByTime,
  splitLongCues, stripFormatting,
  findCueAtTime, getSubtitleStats,
} from './subtitles'

// Loudness normalization (EBU R128)
export * from './loudness'

// Scene detection
export * from './scene-detection'

// Video quality metrics (PSNR, SSIM, etc.)
export * from './quality-metrics'

// Encoding presets for social media platforms
export * from './presets'

// Concatenation and splitting utilities - exclude formatTimestamp that conflicts with scene-detection
export {
  type SplitSegment, type SplitOptions, type ConcatOptions,
  type ConcatInput, type ConcatPlan,
  type BatchSplitPlan,
  calculateSplitPoints, formatSegmentFilename,
  alignToKeyframes, mergeShortSegments,
  createConcatPlan, generateConcatList,
  calculateOutputDimensions, calculateTrimWithFade,
  extractSubclip, parseTimestamp,
  formatTimestamp as formatConcatTimestamp,
  createBatchSplitPlans, estimateSplitSizes,
  validateSegmentCoverage, calculateConcatDuration,
  segmentsToChapters, calculateSeekPosition,
} from './concat-split'

// GIF generation (using ts-gif)
export * from './gif'

// Interlace detection
export * from './interlace'

// HDR to SDR conversion - exclude names that conflict with color.ts and types.ts
export {
  type HdrMetadata as HdrSdrMetadata,
  type MasteringDisplayMetadata as HdrSdrMasteringDisplayMetadata,
  type ColorSpace as HdrColorSpace,
  type TransferFunction, type ColorPrimaries as HdrColorPrimaries,
  type ToneMappingAlgorithm, type ToneMappingOptions,
  type GamutMappingMethod, type ConversionOptions as HdrConversionOptions,
  type ConversionResult,
  pqToLinear, linearToPq, hlgToLinear, linearToHlg,
  gammaToLinear, linearToGamma, srgbToLinear, linearToSrgb,
  toneMappingReinhard, toneMappingReinhardExtended,
  toneMappingHable, applyHableToneMapping,
  toneMappingAces, toneMappingAcesFitted,
  toneMappingBt2390, toneMappingMobius,
  applyToneMapping,
  bt2020ToBt709, bt709ToXyz, xyzToBt709, bt2020ToXyz, xyzToBt2020,
  applyGamutMapping,
  HdrToSdrConverter,
  detectHdrFormat as detectHdrSdrFormat,
  getHdrToSdrFilter, getConversionDescription,
} from './hdr-sdr'

// Batch processing
export * from './batch'
