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
