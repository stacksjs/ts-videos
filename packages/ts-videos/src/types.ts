/**
 * Core types for ts-videos media toolkit
 */

export type VideoCodec =
  | 'h264'
  | 'h265'
  | 'vp8'
  | 'vp9'
  | 'av1'
  | 'mpeg1'
  | 'mpeg2'
  | 'mpeg4'
  | 'theora'
  | 'mjpeg'
  | 'prores'
  | 'dnxhd'
  | 'unknown'

export type AudioCodec =
  | 'aac'
  | 'mp3'
  | 'opus'
  | 'vorbis'
  | 'flac'
  | 'alac'
  | 'ac3'
  | 'eac3'
  | 'dts'
  | 'pcm_s16le'
  | 'pcm_s16be'
  | 'pcm_s24le'
  | 'pcm_s24be'
  | 'pcm_s32le'
  | 'pcm_s32be'
  | 'pcm_f32le'
  | 'pcm_f32be'
  | 'pcm_f64le'
  | 'pcm_f64be'
  | 'pcm_mulaw'
  | 'pcm_alaw'
  | 'unknown'

export type SubtitleCodec =
  | 'webvtt'
  | 'srt'
  | 'ass'
  | 'ssa'
  | 'mov_text'
  | 'dvdsub'
  | 'pgs'
  | 'unknown'

export type ContainerFormat =
  | 'mp4'
  | 'mov'
  | 'webm'
  | 'mkv'
  | 'avi'
  | 'flv'
  | 'ts'
  | 'mp3'
  | 'wav'
  | 'flac'
  | 'ogg'
  | 'aac'

export interface BaseTrack {
  id: number
  index: number
  codec: string
  codecDescription?: Uint8Array
  language?: string
  title?: string
  isDefault?: boolean
  isForced?: boolean
  disposition?: TrackDisposition
}

export interface VideoTrack extends BaseTrack {
  type: 'video'
  codec: VideoCodec
  width: number
  height: number
  frameRate?: number
  bitrate?: number
  profile?: string
  level?: string
  colorSpace?: ColorSpace
  rotation?: 0 | 90 | 180 | 270
  pixelAspectRatio?: { width: number, height: number }
  displayWidth?: number
  displayHeight?: number
}

export interface AudioTrack extends BaseTrack {
  type: 'audio'
  codec: AudioCodec
  sampleRate: number
  channels: number
  bitrate?: number
  bitsPerSample?: number
  channelLayout?: string
}

export interface SubtitleTrack extends BaseTrack {
  type: 'subtitle'
  codec: SubtitleCodec
}

export type Track = VideoTrack | AudioTrack | SubtitleTrack

export interface VideoTrackConfig {
  codec: VideoCodec
  width: number
  height: number
  frameRate?: number
  bitrate?: number
  profile?: string
  level?: string
  codecDescription?: Uint8Array
  colorSpace?: ColorSpace
  rotation?: 0 | 90 | 180 | 270
}

export interface AudioTrackConfig {
  codec: AudioCodec
  sampleRate: number
  channels: number
  bitrate?: number
  bitsPerSample?: number
  codecDescription?: Uint8Array
}

export interface SubtitleTrackConfig {
  codec: SubtitleCodec
  language?: string
}

export interface EncodedPacket {
  data: Uint8Array
  timestamp: number
  duration?: number
  isKeyframe: boolean
  trackId?: number
  dts?: number
  pts?: number
  compositionTimeOffset?: number
}

export interface VideoSample {
  data: VideoFrame | Uint8Array
  timestamp: number
  duration?: number
  isKeyframe?: boolean
}

export interface AudioSample {
  data: AudioData | Float32Array | Int16Array
  timestamp: number
  duration?: number
  sampleRate?: number
  channels?: number
}

export interface SubtitleCue {
  startTime: number
  endTime: number
  text: string
  id?: string
  settings?: string
}

export interface Metadata {
  title?: string
  artist?: string
  album?: string
  year?: number
  genre?: string
  comment?: string
  track?: number
  totalTracks?: number
  disc?: number
  totalDiscs?: number
  composer?: string
  albumArtist?: string
  copyright?: string
  encodedBy?: string
  encoder?: string
  creationTime?: Date
  duration?: number
  [key: string]: unknown
}

export interface TrackDisposition {
  default?: boolean
  dub?: boolean
  original?: boolean
  comment?: boolean
  lyrics?: boolean
  karaoke?: boolean
  forced?: boolean
  hearingImpaired?: boolean
  visualImpaired?: boolean
  cleanEffects?: boolean
  attachedPic?: boolean
  captions?: boolean
  descriptions?: boolean
  metadata?: boolean
}

export interface ColorSpace {
  primaries?: ColorPrimaries
  transfer?: TransferCharacteristics
  matrix?: MatrixCoefficients
  range?: 'full' | 'limited'
}

export type ColorPrimaries =
  | 'bt709'
  | 'bt470m'
  | 'bt470bg'
  | 'smpte170m'
  | 'smpte240m'
  | 'film'
  | 'bt2020'
  | 'smpte428'
  | 'smpte431'
  | 'smpte432'
  | 'ebu3213'

export type TransferCharacteristics =
  | 'bt709'
  | 'bt470m'
  | 'bt470bg'
  | 'smpte170m'
  | 'smpte240m'
  | 'linear'
  | 'log100'
  | 'log316'
  | 'iec61966-2-4'
  | 'bt1361e'
  | 'iec61966-2-1'
  | 'bt2020-10'
  | 'bt2020-12'
  | 'smpte2084'
  | 'smpte428'
  | 'arib-std-b67'

export type MatrixCoefficients =
  | 'rgb'
  | 'bt709'
  | 'fcc'
  | 'bt470bg'
  | 'smpte170m'
  | 'smpte240m'
  | 'ycocg'
  | 'bt2020nc'
  | 'bt2020c'
  | 'smpte2085'
  | 'chroma-derived-nc'
  | 'chroma-derived-c'
  | 'ictcp'

export interface Quality {
  bitrate: number
  name?: string
}

export const QUALITY_VERY_LOW: Quality = { bitrate: 100_000, name: 'very-low' }
export const QUALITY_LOW: Quality = { bitrate: 500_000, name: 'low' }
export const QUALITY_MEDIUM: Quality = { bitrate: 2_000_000, name: 'medium' }
export const QUALITY_HIGH: Quality = { bitrate: 6_000_000, name: 'high' }
export const QUALITY_VERY_HIGH: Quality = { bitrate: 12_000_000, name: 'very-high' }
export const QUALITY_LOSSLESS: Quality = { bitrate: 0, name: 'lossless' }

export interface ConversionOptions {
  videoCodec?: VideoCodec
  audioCodec?: AudioCodec
  videoBitrate?: number
  audioBitrate?: number
  width?: number
  height?: number
  frameRate?: number
  sampleRate?: number
  channels?: number
  quality?: Quality
  fastStart?: boolean
  fragmentedMp4?: boolean
  preserveMetadata?: boolean
  startTime?: number
  endTime?: number
  videoTrackIndex?: number
  audioTrackIndex?: number
}

export interface VideosConfig {
  verbose: boolean
}

export type VideosOptions = Partial<VideosConfig>

declare global {
  interface VideoFrame {
    close(): void
  }

  interface AudioData {
    close(): void
  }
}
