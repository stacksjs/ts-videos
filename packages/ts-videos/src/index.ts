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
export * from './color'

// Streaming utilities
export * from './streaming'

// Cover art extraction
export * from './cover-art'

// Re-export audio utilities from ts-audio
export {
  // Audio types
  type AudioCodec,
  type AudioTrack,
  type AudioMetadata,
  type AudioFrame,
  type SampleFormat,
  type ChannelLayout,
  // Audio utilities
  formatSampleRate,
  getChannelLayoutName,
  floatToInt16,
  int16ToFloat,
  interleaveChannels,
  deinterleaveChannels,
  calculateRMS,
  calculatePeak,
  dbToLinear,
  linearToDb,
  applyGain,
  mixBuffers,
  normalize,
  fadeIn,
  fadeOut,
  resampleLinear,
} from 'ts-audio'
