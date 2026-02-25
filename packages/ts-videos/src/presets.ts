/* eslint-disable style/max-statements-per-line */
/**
 * Encoding presets for common platforms and use cases
 * Pre-configured settings for YouTube, Twitter, Instagram, etc.
 */

// ============================================================================
// Types
// ============================================================================

/** Video codec options */
export interface VideoCodecOptions {
  /** Codec name */
  codec: 'h264' | 'h265' | 'vp9' | 'av1'
  /** Profile (e.g., 'main', 'high', 'baseline') */
  profile?: string
  /** Level (e.g., '4.0', '5.1') */
  level?: string
  /** Pixel format */
  pixelFormat?: string
  /** Additional codec-specific options */
  options?: Record<string, string | number | boolean>
}

/** Audio codec options */
export interface AudioCodecOptions {
  /** Codec name */
  codec: 'aac' | 'opus' | 'mp3' | 'flac'
  /** Profile (e.g., 'aac_low', 'aac_he') */
  profile?: string
  /** Additional codec-specific options */
  options?: Record<string, string | number | boolean>
}

/** Complete encoding preset */
export interface EncodingPreset {
  /** Preset name */
  name: string
  /** Description */
  description: string
  /** Target platform */
  platform?: string
  /** Container format */
  container: 'mp4' | 'webm' | 'mkv' | 'mov' | 'ts'

  /** Video settings */
  video: {
    /** Codec options */
    codec: VideoCodecOptions
    /** Target bitrate (bps) or 'auto' */
    bitrate?: number | 'auto'
    /** Maximum bitrate for VBR */
    maxBitrate?: number
    /** Buffer size */
    bufferSize?: number
    /** CRF/CQ value (quality-based encoding) */
    crf?: number
    /** Target width (null = auto scale) */
    width?: number | null
    /** Target height (null = auto scale) */
    height?: number | null
    /** Maximum width */
    maxWidth?: number
    /** Maximum height */
    maxHeight?: number
    /** Frame rate (null = keep original) */
    frameRate?: number | null
    /** Maximum frame rate */
    maxFrameRate?: number
    /** Keyframe interval in seconds */
    keyframeInterval?: number
    /** B-frame count */
    bFrames?: number
    /** Reference frames */
    refFrames?: number
    /** Encoding speed preset */
    speedPreset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo'
    /** Two-pass encoding */
    twoPass?: boolean
    /** HDR settings */
    hdr?: boolean
  }

  /** Audio settings */
  audio: {
    /** Codec options */
    codec: AudioCodecOptions
    /** Bitrate (bps) */
    bitrate?: number
    /** Sample rate */
    sampleRate?: number
    /** Channel count */
    channels?: number
    /** Loudness normalization target (LUFS) */
    loudnessTarget?: number
  }

  /** Metadata settings */
  metadata?: {
    /** Add faststart for streaming */
    faststart?: boolean
    /** Include original metadata */
    copyMetadata?: boolean
  }
}

/** Resolution preset */
export interface ResolutionPreset {
  name: string
  width: number
  height: number
  label: string
}

/** Bitrate recommendation */
export interface BitrateRecommendation {
  resolution: string
  frameRate: number
  standard: number
  high: number
  hdr?: number
}

// ============================================================================
// Standard Resolutions
// ============================================================================

/** Common video resolutions */
export const RESOLUTIONS: Record<string, ResolutionPreset> = {
  '4k': { name: '4k', width: 3840, height: 2160, label: '4K UHD' },
  '2k': { name: '2k', width: 2560, height: 1440, label: '2K QHD' },
  '1080p': { name: '1080p', width: 1920, height: 1080, label: 'Full HD' },
  '720p': { name: '720p', width: 1280, height: 720, label: 'HD' },
  '480p': { name: '480p', width: 854, height: 480, label: 'SD' },
  '360p': { name: '360p', width: 640, height: 360, label: 'Low' },
  '240p': { name: '240p', width: 426, height: 240, label: 'Very Low' },
}

/** Aspect ratios */
export const ASPECT_RATIOS: Record<string, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
  '1:1': 1,
  '9:16': 9 / 16, // Vertical video
  '4:5': 4 / 5, // Instagram portrait
}

// ============================================================================
// Platform Presets
// ============================================================================

/** YouTube recommended settings */
export const YOUTUBE_PRESETS: Record<string, EncodingPreset> = {
  '4k': {
    name: 'YouTube 4K',
    description: 'Optimized for YouTube 4K upload',
    platform: 'YouTube',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '5.1' },
      width: 3840,
      height: 2160,
      bitrate: 35000000,
      maxBitrate: 53000000,
      keyframeInterval: 2,
      bFrames: 2,
      speedPreset: 'slow',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 384000,
      sampleRate: 48000,
      channels: 2,
    },
    metadata: { faststart: true },
  },

  '1080p': {
    name: 'YouTube 1080p',
    description: 'Optimized for YouTube Full HD upload',
    platform: 'YouTube',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '4.2' },
      width: 1920,
      height: 1080,
      bitrate: 8000000,
      maxBitrate: 12000000,
      keyframeInterval: 2,
      bFrames: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 256000,
      sampleRate: 48000,
      channels: 2,
    },
    metadata: { faststart: true },
  },

  '720p': {
    name: 'YouTube 720p',
    description: 'Optimized for YouTube HD upload',
    platform: 'YouTube',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'main', level: '4.0' },
      width: 1280,
      height: 720,
      bitrate: 5000000,
      maxBitrate: 7500000,
      keyframeInterval: 2,
      bFrames: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 192000,
      sampleRate: 48000,
      channels: 2,
    },
    metadata: { faststart: true },
  },
}

/** Twitter/X video presets */
export const TWITTER_PRESETS: Record<string, EncodingPreset> = {
  standard: {
    name: 'Twitter Standard',
    description: 'Standard Twitter video (max 2:20)',
    platform: 'Twitter',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '4.2' },
      maxWidth: 1920,
      maxHeight: 1200,
      bitrate: 5000000,
      maxBitrate: 8000000,
      maxFrameRate: 60,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 128000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },
}

/** Instagram video presets */
export const INSTAGRAM_PRESETS: Record<string, EncodingPreset> = {
  feed: {
    name: 'Instagram Feed',
    description: 'Instagram feed video (max 60s)',
    platform: 'Instagram',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'main', level: '4.0' },
      maxWidth: 1080,
      maxHeight: 1350,
      bitrate: 3500000,
      maxFrameRate: 30,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 128000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },

  story: {
    name: 'Instagram Story',
    description: 'Instagram story video (max 15s)',
    platform: 'Instagram',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'main', level: '4.0' },
      width: 1080,
      height: 1920,
      bitrate: 3500000,
      frameRate: 30,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 128000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },

  reels: {
    name: 'Instagram Reels',
    description: 'Instagram Reels video (max 90s)',
    platform: 'Instagram',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '4.0' },
      width: 1080,
      height: 1920,
      bitrate: 5000000,
      frameRate: 30,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 192000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },
}

/** TikTok video presets */
export const TIKTOK_PRESETS: Record<string, EncodingPreset> = {
  standard: {
    name: 'TikTok Standard',
    description: 'TikTok video (max 10 min)',
    platform: 'TikTok',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '4.2' },
      width: 1080,
      height: 1920,
      bitrate: 6000000,
      frameRate: 30,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 192000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },
}

/** Discord video presets */
export const DISCORD_PRESETS: Record<string, EncodingPreset> = {
  standard: {
    name: 'Discord Standard',
    description: 'Discord video (8MB limit for free users)',
    platform: 'Discord',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'main', level: '4.0' },
      maxWidth: 1920,
      maxHeight: 1080,
      crf: 28,
      maxFrameRate: 30,
      keyframeInterval: 2,
      speedPreset: 'fast',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 96000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },

  nitro: {
    name: 'Discord Nitro',
    description: 'Discord video for Nitro users (50MB limit)',
    platform: 'Discord',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '4.2' },
      maxWidth: 1920,
      maxHeight: 1080,
      crf: 23,
      maxFrameRate: 60,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 192000,
      sampleRate: 48000,
      channels: 2,
    },
    metadata: { faststart: true },
  },
}

// ============================================================================
// Use Case Presets
// ============================================================================

/** Web optimized presets */
export const WEB_PRESETS: Record<string, EncodingPreset> = {
  progressive: {
    name: 'Web Progressive',
    description: 'Progressive download optimized',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'main', level: '4.0' },
      maxWidth: 1920,
      maxHeight: 1080,
      crf: 23,
      keyframeInterval: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 128000,
      sampleRate: 44100,
      channels: 2,
    },
    metadata: { faststart: true },
  },

  streaming: {
    name: 'Web Streaming',
    description: 'HLS/DASH streaming optimized',
    container: 'mp4',
    video: {
      codec: { codec: 'h264', profile: 'main', level: '4.0' },
      maxWidth: 1920,
      maxHeight: 1080,
      bitrate: 5000000,
      keyframeInterval: 2,
      bFrames: 2,
      speedPreset: 'medium',
    },
    audio: {
      codec: { codec: 'aac', profile: 'aac_low' },
      bitrate: 128000,
      sampleRate: 48000,
      channels: 2,
    },
    metadata: { faststart: true },
  },
}

/** Archive presets */
export const ARCHIVE_PRESETS: Record<string, EncodingPreset> = {
  lossless: {
    name: 'Archive Lossless',
    description: 'Lossless archival quality',
    container: 'mkv',
    video: {
      codec: { codec: 'h264', profile: 'high', level: '5.1' },
      crf: 0,
      speedPreset: 'veryslow',
    },
    audio: {
      codec: { codec: 'flac' },
      sampleRate: 48000,
    },
  },

  highQuality: {
    name: 'Archive High Quality',
    description: 'High quality archival',
    container: 'mkv',
    video: {
      codec: { codec: 'h265', profile: 'main' },
      crf: 18,
      speedPreset: 'slow',
    },
    audio: {
      codec: { codec: 'flac' },
      sampleRate: 48000,
    },
  },
}

// ============================================================================
// Preset Selection
// ============================================================================

/** All available presets */
export const ALL_PRESETS: Record<string, EncodingPreset> = {
  ...Object.fromEntries(Object.entries(YOUTUBE_PRESETS).map(([k, v]) => [`youtube_${k}`, v])),
  ...Object.fromEntries(Object.entries(TWITTER_PRESETS).map(([k, v]) => [`twitter_${k}`, v])),
  ...Object.fromEntries(Object.entries(INSTAGRAM_PRESETS).map(([k, v]) => [`instagram_${k}`, v])),
  ...Object.fromEntries(Object.entries(TIKTOK_PRESETS).map(([k, v]) => [`tiktok_${k}`, v])),
  ...Object.fromEntries(Object.entries(DISCORD_PRESETS).map(([k, v]) => [`discord_${k}`, v])),
  ...Object.fromEntries(Object.entries(WEB_PRESETS).map(([k, v]) => [`web_${k}`, v])),
  ...Object.fromEntries(Object.entries(ARCHIVE_PRESETS).map(([k, v]) => [`archive_${k}`, v])),
}

/** Get preset by name */
export function getPreset(name: string): EncodingPreset | undefined {
  return ALL_PRESETS[name]
}

/** List all preset names */
export function listPresets(): string[] {
  return Object.keys(ALL_PRESETS)
}

/** List presets by platform */
export function listPresetsByPlatform(platform: string): EncodingPreset[] {
  return Object.values(ALL_PRESETS).filter((p) => p.platform?.toLowerCase() === platform.toLowerCase())
}

/** Get recommended preset for file size target */
export function getPresetForFileSize(
  durationSeconds: number,
  targetSizeMB: number,
  _preferQuality: boolean = false,
): EncodingPreset {
  const targetBitrate = (targetSizeMB * 8 * 1024 * 1024) / durationSeconds

  // Estimate audio bitrate
  const audioBitrate = 128000

  // Video bitrate
  const videoBitrate = targetBitrate - audioBitrate

  // Find appropriate preset
  if (videoBitrate < 1000000) {
    return {
      ...WEB_PRESETS.progressive,
      name: 'Auto - Low Bitrate',
      video: {
        ...WEB_PRESETS.progressive.video,
        bitrate: videoBitrate,
        maxWidth: 854,
        maxHeight: 480,
      },
    }
  }
  else if (videoBitrate < 3000000) {
    return {
      ...WEB_PRESETS.progressive,
      name: 'Auto - Medium Bitrate',
      video: {
        ...WEB_PRESETS.progressive.video,
        bitrate: videoBitrate,
        maxWidth: 1280,
        maxHeight: 720,
      },
    }
  }
  else {
    return {
      ...WEB_PRESETS.progressive,
      name: 'Auto - High Bitrate',
      video: {
        ...WEB_PRESETS.progressive.video,
        bitrate: videoBitrate,
        maxWidth: 1920,
        maxHeight: 1080,
      },
    }
  }
}

// ============================================================================
// Bitrate Recommendations
// ============================================================================

/** YouTube recommended bitrates (bps) */
export const YOUTUBE_BITRATES: BitrateRecommendation[] = [
  { resolution: '2160p', frameRate: 30, standard: 35000000, high: 45000000, hdr: 44000000 },
  { resolution: '2160p', frameRate: 60, standard: 53000000, high: 68000000, hdr: 66000000 },
  { resolution: '1440p', frameRate: 30, standard: 16000000, high: 24000000 },
  { resolution: '1440p', frameRate: 60, standard: 24000000, high: 30000000 },
  { resolution: '1080p', frameRate: 30, standard: 8000000, high: 12000000 },
  { resolution: '1080p', frameRate: 60, standard: 12000000, high: 15000000 },
  { resolution: '720p', frameRate: 30, standard: 5000000, high: 7500000 },
  { resolution: '720p', frameRate: 60, standard: 7500000, high: 10000000 },
  { resolution: '480p', frameRate: 30, standard: 2500000, high: 4000000 },
  { resolution: '360p', frameRate: 30, standard: 1000000, high: 1500000 },
]

/** Get recommended bitrate */
export function getRecommendedBitrate(
  width: number,
  height: number,
  frameRate: number,
  quality: 'standard' | 'high' = 'standard',
): number {
  // Find matching or nearest resolution
  let bestMatch = YOUTUBE_BITRATES[0]
  let bestDiff = Infinity

  const pixels = width * height

  for (const rec of YOUTUBE_BITRATES) {
    const recPixels = RESOLUTIONS[rec.resolution]
      ? RESOLUTIONS[rec.resolution].width * RESOLUTIONS[rec.resolution].height
      : 0

    const pixelDiff = Math.abs(pixels - recPixels)
    const fpsDiff = Math.abs(frameRate - rec.frameRate)

    if (pixelDiff + fpsDiff * 10000 < bestDiff) {
      bestDiff = pixelDiff + fpsDiff * 10000
      bestMatch = rec
    }
  }

  return quality === 'high' ? bestMatch.high : bestMatch.standard
}

// ============================================================================
// Preset Customization
// ============================================================================

/** Create custom preset from base */
export function customizePreset(
  base: EncodingPreset,
  overrides: Partial<EncodingPreset>,
): EncodingPreset {
  return {
    ...base,
    ...overrides,
    name: overrides.name ?? `${base.name} (Custom)`,
    video: { ...base.video, ...overrides.video },
    audio: { ...base.audio, ...overrides.audio },
    metadata: { ...base.metadata, ...overrides.metadata },
  }
}

/** Scale preset to target resolution */
export function scalePreset(
  preset: EncodingPreset,
  targetWidth: number,
  targetHeight: number,
): EncodingPreset {
  const originalPixels = (preset.video.width ?? 1920) * (preset.video.height ?? 1080)
  const targetPixels = targetWidth * targetHeight
  const scaleFactor = targetPixels / originalPixels

  const scaledBitrate = typeof preset.video.bitrate === 'number'
    ? Math.round(preset.video.bitrate * Math.sqrt(scaleFactor))
    : preset.video.bitrate

  return {
    ...preset,
    name: `${preset.name} (${targetWidth}x${targetHeight})`,
    video: {
      ...preset.video,
      width: targetWidth,
      height: targetHeight,
      bitrate: scaledBitrate,
      maxBitrate: preset.video.maxBitrate
        ? Math.round(preset.video.maxBitrate * Math.sqrt(scaleFactor))
        : undefined,
    },
  }
}

/** Validate preset settings */
export function validatePreset(preset: EncodingPreset): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  // Check video settings
  if (preset.video.width && preset.video.width % 2 !== 0) {
    issues.push('Video width must be divisible by 2')
  }
  if (preset.video.height && preset.video.height % 2 !== 0) {
    issues.push('Video height must be divisible by 2')
  }
  if (preset.video.crf !== undefined && (preset.video.crf < 0 || preset.video.crf > 51)) {
    issues.push('CRF must be between 0 and 51')
  }
  if (preset.video.keyframeInterval && preset.video.keyframeInterval < 0.5) {
    issues.push('Keyframe interval should be at least 0.5 seconds')
  }

  // Check audio settings
  if (preset.audio.bitrate && preset.audio.bitrate < 32000) {
    issues.push('Audio bitrate should be at least 32kbps')
  }
  if (preset.audio.sampleRate && ![44100, 48000, 96000].includes(preset.audio.sampleRate)) {
    issues.push('Recommended sample rates are 44100, 48000, or 96000 Hz')
  }

  return { valid: issues.length === 0, issues }
}
