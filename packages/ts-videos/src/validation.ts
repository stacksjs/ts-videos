/**
 * Media validation utilities for checking file integrity and compliance
 * Validates container structure, codec parameters, and stream synchronization
 */

// ============================================================================
// Types
// ============================================================================

/** Validation severity levels */
export type ValidationSeverity = 'error' | 'warning' | 'info'

/** A single validation issue */
export interface ValidationIssue {
  /** Severity level */
  severity: ValidationSeverity
  /** Issue code for programmatic handling */
  code: string
  /** Human-readable message */
  message: string
  /** Location in file (byte offset, timestamp, etc.) */
  location?: string
  /** Suggested fix or action */
  suggestion?: string
  /** Related specification or standard */
  reference?: string
}

/** Validation result */
export interface ValidationResult {
  /** Whether the file is valid (no errors) */
  valid: boolean
  /** Whether the file is playable despite issues */
  playable: boolean
  /** List of issues found */
  issues: ValidationIssue[]
  /** Summary statistics */
  stats: {
    errors: number
    warnings: number
    infos: number
  }
  /** File information */
  fileInfo?: {
    format?: string
    size?: number
    duration?: number
    bitrate?: number
  }
  /** Stream information */
  streams?: Array<{
    type: 'video' | 'audio' | 'subtitle' | 'data'
    codec?: string
    issues: ValidationIssue[]
  }>
}

/** Validation options */
export interface ValidationOptions {
  /** Check container structure */
  checkContainer?: boolean
  /** Check codec parameters */
  checkCodecs?: boolean
  /** Check stream synchronization */
  checkSync?: boolean
  /** Check for common playback issues */
  checkPlayback?: boolean
  /** Check compliance with specific profiles */
  profiles?: ValidationProfile[]
  /** Maximum number of issues to report */
  maxIssues?: number
  /** Minimum severity to report */
  minSeverity?: ValidationSeverity
}

/** Pre-defined validation profiles */
export type ValidationProfile =
  | 'web'
  | 'broadcast'
  | 'streaming'
  | 'archive'
  | 'mobile'
  | 'accessibility'

// ============================================================================
// Issue Codes
// ============================================================================

/** Standard validation issue codes */
export const ValidationCodes = {
  // Container issues
  INVALID_HEADER: 'CONTAINER_INVALID_HEADER',
  TRUNCATED_FILE: 'CONTAINER_TRUNCATED',
  CORRUPT_BOX: 'CONTAINER_CORRUPT_BOX',
  MISSING_MOOV: 'CONTAINER_MISSING_MOOV',
  MOOV_AT_END: 'CONTAINER_MOOV_AT_END',
  INVALID_BOX_SIZE: 'CONTAINER_INVALID_BOX_SIZE',
  UNKNOWN_BOX_TYPE: 'CONTAINER_UNKNOWN_BOX',
  DUPLICATE_BOX: 'CONTAINER_DUPLICATE_BOX',

  // Video codec issues
  MISSING_SPS: 'VIDEO_MISSING_SPS',
  MISSING_PPS: 'VIDEO_MISSING_PPS',
  INVALID_SPS: 'VIDEO_INVALID_SPS',
  INVALID_PPS: 'VIDEO_INVALID_PPS',
  UNSUPPORTED_PROFILE: 'VIDEO_UNSUPPORTED_PROFILE',
  UNSUPPORTED_LEVEL: 'VIDEO_UNSUPPORTED_LEVEL',
  INVALID_FRAME_RATE: 'VIDEO_INVALID_FRAME_RATE',
  VARIABLE_FRAME_RATE: 'VIDEO_VARIABLE_FRAME_RATE',
  INVALID_RESOLUTION: 'VIDEO_INVALID_RESOLUTION',
  ODD_RESOLUTION: 'VIDEO_ODD_RESOLUTION',
  MISSING_KEYFRAME: 'VIDEO_MISSING_KEYFRAME',
  LONG_GOP: 'VIDEO_LONG_GOP',

  // Audio codec issues
  MISSING_CONFIG: 'AUDIO_MISSING_CONFIG',
  INVALID_CONFIG: 'AUDIO_INVALID_CONFIG',
  UNSUPPORTED_SAMPLE_RATE: 'AUDIO_UNSUPPORTED_SAMPLE_RATE',
  INVALID_CHANNEL_CONFIG: 'AUDIO_INVALID_CHANNEL_CONFIG',
  SAMPLE_RATE_MISMATCH: 'AUDIO_SAMPLE_RATE_MISMATCH',

  // Sync issues
  AV_SYNC_DRIFT: 'SYNC_AV_DRIFT',
  TIMESTAMP_DISCONTINUITY: 'SYNC_DISCONTINUITY',
  NEGATIVE_TIMESTAMP: 'SYNC_NEGATIVE_TIMESTAMP',
  TIMESTAMP_OVERFLOW: 'SYNC_TIMESTAMP_OVERFLOW',
  DTS_PTS_MISMATCH: 'SYNC_DTS_PTS_MISMATCH',

  // Streaming issues
  NO_FAST_START: 'STREAMING_NO_FAST_START',
  LARGE_MDAT: 'STREAMING_LARGE_MDAT',
  MISSING_SIDX: 'STREAMING_MISSING_SIDX',
  SEGMENT_TOO_LONG: 'STREAMING_SEGMENT_TOO_LONG',

  // Playback issues
  UNSUPPORTED_CODEC: 'PLAYBACK_UNSUPPORTED_CODEC',
  HIGH_BITRATE: 'PLAYBACK_HIGH_BITRATE',
  HIGH_RESOLUTION: 'PLAYBACK_HIGH_RESOLUTION',
  MISSING_INDEX: 'PLAYBACK_MISSING_INDEX',

  // Accessibility issues
  NO_CAPTIONS: 'ACCESSIBILITY_NO_CAPTIONS',
  NO_AUDIO_DESCRIPTION: 'ACCESSIBILITY_NO_AUDIO_DESC',
  MISSING_LANGUAGE: 'ACCESSIBILITY_MISSING_LANGUAGE',

  // Metadata issues
  MISSING_DURATION: 'METADATA_MISSING_DURATION',
  INVALID_DURATION: 'METADATA_INVALID_DURATION',
  MISSING_TIMESCALE: 'METADATA_MISSING_TIMESCALE',
} as const

// ============================================================================
// Container Validation
// ============================================================================

/** Validate MP4/MOV container structure */
export function validateMp4Container(data: Uint8Array): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  let offset = 0
  let hasFtyp = false
  let hasMoov = false
  let hasMdat = false
  let moovOffset = 0
  let mdatOffset = 0
  let lastBoxEnd = 0

  // Check minimum size
  if (data.length < 8) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.TRUNCATED_FILE,
      message: 'File is too small to be a valid MP4',
      suggestion: 'Check if file was fully downloaded',
    })
    return issues
  }

  // Parse box structure
  while (offset < data.length - 8) {
    const size = readUint32BE(data, offset)
    const type = readString(data, offset + 4, 4)

    // Validate box size
    if (size === 0) {
      // Size 0 means box extends to end of file
      if (offset + 8 < data.length) {
        lastBoxEnd = data.length
      }
      break
    }

    if (size < 8) {
      issues.push({
        severity: 'error',
        code: ValidationCodes.INVALID_BOX_SIZE,
        message: `Invalid box size ${size} at offset ${offset}`,
        location: `offset ${offset}`,
        suggestion: 'File may be corrupted',
      })
      break
    }

    let actualSize = size
    if (size === 1 && offset + 16 <= data.length) {
      // Extended size (64-bit)
      const highSize = readUint32BE(data, offset + 8)
      const lowSize = readUint32BE(data, offset + 12)
      actualSize = highSize * 0x100000000 + lowSize
    }

    if (offset + actualSize > data.length) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.TRUNCATED_FILE,
        message: `Box '${type}' extends beyond file end`,
        location: `offset ${offset}`,
        suggestion: 'File may be truncated',
      })
    }

    // Track important boxes
    switch (type) {
      case 'ftyp':
        if (hasFtyp) {
          issues.push({
            severity: 'warning',
            code: ValidationCodes.DUPLICATE_BOX,
            message: 'Duplicate ftyp box',
            location: `offset ${offset}`,
          })
        }
        hasFtyp = true
        break
      case 'moov':
        if (hasMoov) {
          issues.push({
            severity: 'warning',
            code: ValidationCodes.DUPLICATE_BOX,
            message: 'Duplicate moov box',
            location: `offset ${offset}`,
          })
        }
        hasMoov = true
        moovOffset = offset
        break
      case 'mdat':
        hasMdat = true
        mdatOffset = offset
        break
    }

    lastBoxEnd = offset + actualSize
    offset += actualSize
  }

  // Check for required boxes
  if (!hasFtyp) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.INVALID_HEADER,
      message: 'Missing ftyp box',
      suggestion: 'File may not be recognized by some players',
    })
  }

  if (!hasMoov) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.MISSING_MOOV,
      message: 'Missing moov box (movie header)',
      suggestion: 'File is incomplete or corrupted',
    })
  }

  // Check moov position for streaming
  if (hasMoov && hasMdat && moovOffset > mdatOffset) {
    issues.push({
      severity: 'info',
      code: ValidationCodes.MOOV_AT_END,
      message: 'moov box is after mdat (not optimized for streaming)',
      suggestion: 'Use qt-faststart or similar tool to move moov to beginning',
      reference: 'https://trac.ffmpeg.org/wiki/How%20to%20use%20qt-faststart',
    })
  }

  // Check for file truncation
  if (lastBoxEnd < data.length - 8) {
    const trailingBytes = data.length - lastBoxEnd
    if (trailingBytes > 0) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.CORRUPT_BOX,
        message: `${trailingBytes} trailing bytes after last box`,
        location: `offset ${lastBoxEnd}`,
      })
    }
  }

  return issues
}

/** Validate Matroska/WebM container structure */
export function validateMatroskaContainer(data: Uint8Array): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check EBML header
  if (data.length < 4 || data[0] !== 0x1a || data[1] !== 0x45 || data[2] !== 0xdf || data[3] !== 0xa3) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.INVALID_HEADER,
      message: 'Invalid EBML header',
      suggestion: 'File is not a valid Matroska/WebM file',
    })
    return issues
  }

  // Look for required elements
  let hasSegment = false
  let hasTracks = false
  let hasCues = false
  let offset = 0

  while (offset < data.length) {
    const { id, size, headerSize } = readEbmlElement(data, offset)
    if (headerSize === 0) break

    // Check for key elements
    if (id === 0x18538067) hasSegment = true // Segment
    if (id === 0x1654ae6b) hasTracks = true // Tracks
    if (id === 0x1c53bb6b) hasCues = true // Cues

    offset += headerSize + size
    if (size === 0) break
  }

  if (!hasSegment) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.CORRUPT_BOX,
      message: 'Missing Segment element',
    })
  }

  if (!hasTracks) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.CORRUPT_BOX,
      message: 'Missing Tracks element',
    })
  }

  if (!hasCues) {
    issues.push({
      severity: 'info',
      code: ValidationCodes.MISSING_INDEX,
      message: 'Missing Cues element (seeking may be slow)',
      suggestion: 'Remux file to add seeking index',
    })
  }

  return issues
}

// ============================================================================
// Codec Validation
// ============================================================================

/** Validate H.264/AVC parameters */
export function validateH264Parameters(
  spsData?: Uint8Array,
  ppsData?: Uint8Array,
  profile?: ValidationProfile,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!spsData || spsData.length === 0) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.MISSING_SPS,
      message: 'Missing H.264 SPS (Sequence Parameter Set)',
      suggestion: 'Video stream may not be playable',
    })
    return issues
  }

  if (!ppsData || ppsData.length === 0) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.MISSING_PPS,
      message: 'Missing H.264 PPS (Picture Parameter Set)',
      suggestion: 'Video stream may not be playable',
    })
  }

  // Parse SPS to validate parameters
  try {
    const sps = parseBasicSps(spsData)

    // Check profile for web playback
    if (profile === 'web' || profile === 'streaming') {
      const webProfiles = [66, 77, 100] // Baseline, Main, High
      if (!webProfiles.includes(sps.profileIdc)) {
        issues.push({
          severity: 'warning',
          code: ValidationCodes.UNSUPPORTED_PROFILE,
          message: `H.264 profile ${sps.profileIdc} may not be supported in browsers`,
          suggestion: 'Use Baseline, Main, or High profile for web playback',
        })
      }

      // Check level
      if (sps.levelIdc > 51) {
        issues.push({
          severity: 'warning',
          code: ValidationCodes.UNSUPPORTED_LEVEL,
          message: `H.264 level ${sps.levelIdc / 10} may not be supported`,
          suggestion: 'Use level 5.1 or lower for wide compatibility',
        })
      }
    }

    // Check for odd dimensions
    if (sps.width % 2 !== 0 || sps.height % 2 !== 0) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.ODD_RESOLUTION,
        message: `Odd resolution ${sps.width}x${sps.height}`,
        suggestion: 'Some players may have issues with odd dimensions',
      })
    }

    // Check for very high resolution
    if (profile === 'mobile' && (sps.width > 1920 || sps.height > 1080)) {
      issues.push({
        severity: 'info',
        code: ValidationCodes.HIGH_RESOLUTION,
        message: `Resolution ${sps.width}x${sps.height} may be too high for mobile`,
        suggestion: 'Consider providing lower resolution variants',
      })
    }
  }
  catch (_error) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.INVALID_SPS,
      message: 'Could not parse H.264 SPS',
    })
  }

  return issues
}

/** Validate AAC audio configuration */
export function validateAacConfig(config: Uint8Array, profile?: ValidationProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!config || config.length < 2) {
    issues.push({
      severity: 'error',
      code: ValidationCodes.MISSING_CONFIG,
      message: 'Missing AAC audio configuration',
    })
    return issues
  }

  try {
    // Parse basic AAC config
    const objectType = (config[0] >> 3) & 0x1f
    const freqIndex = ((config[0] & 0x07) << 1) | ((config[1] >> 7) & 0x01)
    const channelConfig = (config[1] >> 3) & 0x0f

    // Check object type for web
    if (profile === 'web' || profile === 'streaming') {
      if (objectType !== 2 && objectType !== 5) {
        // AAC-LC or HE-AAC
        issues.push({
          severity: 'warning',
          code: ValidationCodes.INVALID_CONFIG,
          message: `AAC object type ${objectType} may not be widely supported`,
          suggestion: 'Use AAC-LC (type 2) for best compatibility',
        })
      }
    }

    // Check sample rate
    const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
    if (freqIndex >= sampleRates.length) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.UNSUPPORTED_SAMPLE_RATE,
        message: `Unknown sample rate index ${freqIndex}`,
      })
    }
    else {
      const sampleRate = sampleRates[freqIndex]
      if (profile === 'web' && sampleRate !== 44100 && sampleRate !== 48000) {
        issues.push({
          severity: 'info',
          code: ValidationCodes.UNSUPPORTED_SAMPLE_RATE,
          message: `Sample rate ${sampleRate} Hz may not be optimal for web`,
          suggestion: 'Use 44100 or 48000 Hz for best compatibility',
        })
      }
    }

    // Check channel config
    if (channelConfig === 0) {
      issues.push({
        severity: 'info',
        code: ValidationCodes.INVALID_CHANNEL_CONFIG,
        message: 'Custom channel configuration (may require additional parsing)',
      })
    }
    else if (channelConfig > 7) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.INVALID_CHANNEL_CONFIG,
        message: `Channel configuration ${channelConfig} may not be widely supported`,
      })
    }
  }
  catch (_error) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.INVALID_CONFIG,
      message: 'Could not parse AAC configuration',
    })
  }

  return issues
}

// ============================================================================
// Timing Validation
// ============================================================================

/** Timing sample for sync validation */
export interface TimingSample {
  trackType: 'video' | 'audio'
  dts: number
  pts: number
  duration: number
}

/** Validate stream timing and synchronization */
export function validateTiming(samples: TimingSample[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (samples.length === 0) return issues

  // Separate by track type
  const videoSamples = samples.filter((s) => s.trackType === 'video')
  const audioSamples = samples.filter((s) => s.trackType === 'audio')

  // Check for negative timestamps
  for (const sample of samples) {
    if (sample.pts < 0) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.NEGATIVE_TIMESTAMP,
        message: `Negative PTS detected: ${sample.pts}`,
        suggestion: 'Timestamps should start at 0',
      })
      break
    }
    if (sample.dts < 0) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.NEGATIVE_TIMESTAMP,
        message: `Negative DTS detected: ${sample.dts}`,
      })
      break
    }
  }

  // Check for DTS > PTS
  for (const sample of samples) {
    if (sample.dts > sample.pts) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.DTS_PTS_MISMATCH,
        message: `DTS (${sample.dts}) > PTS (${sample.pts})`,
        suggestion: 'DTS should be <= PTS for proper decoding',
      })
      break
    }
  }

  // Check A/V sync
  if (videoSamples.length > 0 && audioSamples.length > 0) {
    const videoStart = Math.min(...videoSamples.map((s) => s.pts))
    const audioStart = Math.min(...audioSamples.map((s) => s.pts))
    const syncDiff = Math.abs(videoStart - audioStart)

    if (syncDiff > 100) {
      // More than 100ms difference
      issues.push({
        severity: syncDiff > 500 ? 'warning' : 'info',
        code: ValidationCodes.AV_SYNC_DRIFT,
        message: `A/V start time difference: ${syncDiff.toFixed(0)}ms`,
        suggestion: syncDiff > 500 ? 'Consider resyncing audio and video' : undefined,
      })
    }
  }

  // Check for timestamp discontinuities
  const sortedVideo = [...videoSamples].sort((a, b) => a.dts - b.dts)
  for (let i = 1; i < sortedVideo.length; i++) {
    const prev = sortedVideo[i - 1]
    const curr = sortedVideo[i]
    const gap = curr.dts - prev.dts - prev.duration

    if (gap > 1000) {
      // More than 1 second gap
      issues.push({
        severity: 'warning',
        code: ValidationCodes.TIMESTAMP_DISCONTINUITY,
        message: `Video timestamp gap of ${gap.toFixed(0)}ms`,
        location: `at DTS ${curr.dts}`,
      })
      break
    }
  }

  return issues
}

// ============================================================================
// Profile-Based Validation
// ============================================================================

/** Validate against web playback profile */
export function validateForWeb(info: {
  videoCodec?: string
  audioCodec?: string
  width?: number
  height?: number
  bitrate?: number
  duration?: number
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check video codec
  const webVideoCodecs = ['h264', 'avc1', 'vp8', 'vp9', 'av01', 'hevc', 'hvc1']
  if (info.videoCodec && !webVideoCodecs.some((c) => info.videoCodec!.toLowerCase().includes(c))) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.UNSUPPORTED_CODEC,
      message: `Video codec '${info.videoCodec}' may not be supported in browsers`,
      suggestion: 'Use H.264, VP8, VP9, or AV1 for web playback',
    })
  }

  // Check audio codec
  const webAudioCodecs = ['aac', 'mp4a', 'vorbis', 'opus', 'mp3', 'flac']
  if (info.audioCodec && !webAudioCodecs.some((c) => info.audioCodec!.toLowerCase().includes(c))) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.UNSUPPORTED_CODEC,
      message: `Audio codec '${info.audioCodec}' may not be supported in browsers`,
      suggestion: 'Use AAC, Opus, Vorbis, or MP3 for web playback',
    })
  }

  // Check resolution
  if (info.width && info.height) {
    if (info.width > 4096 || info.height > 2160) {
      issues.push({
        severity: 'info',
        code: ValidationCodes.HIGH_RESOLUTION,
        message: `Resolution ${info.width}x${info.height} exceeds 4K`,
        suggestion: 'Some browsers may not support resolutions above 4K',
      })
    }
  }

  // Check bitrate
  if (info.bitrate && info.bitrate > 50000000) {
    // 50 Mbps
    issues.push({
      severity: 'warning',
      code: ValidationCodes.HIGH_BITRATE,
      message: `Bitrate ${(info.bitrate / 1000000).toFixed(1)} Mbps is very high`,
      suggestion: 'Consider lower bitrate for web streaming',
    })
  }

  return issues
}

/** Validate against streaming profile */
export function validateForStreaming(info: {
  hasFastStart?: boolean
  segmentDuration?: number
  hasKeyframeIndex?: boolean
  gopSize?: number
  duration?: number
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check fast start
  if (info.hasFastStart === false) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.NO_FAST_START,
      message: 'File is not optimized for progressive streaming',
      suggestion: 'Move moov atom to beginning of file',
    })
  }

  // Check segment duration
  if (info.segmentDuration && info.segmentDuration > 10000) {
    issues.push({
      severity: 'info',
      code: ValidationCodes.SEGMENT_TOO_LONG,
      message: `Segment duration ${(info.segmentDuration / 1000).toFixed(1)}s is longer than recommended`,
      suggestion: 'Use 2-10 second segments for adaptive streaming',
    })
  }

  // Check GOP size
  if (info.gopSize && info.gopSize > 250) {
    issues.push({
      severity: 'warning',
      code: ValidationCodes.LONG_GOP,
      message: `GOP size of ${info.gopSize} frames is very long`,
      suggestion: 'Use 2-4 second GOPs for streaming',
    })
  }

  // Check keyframe index
  if (info.hasKeyframeIndex === false && info.duration && info.duration > 60000) {
    issues.push({
      severity: 'info',
      code: ValidationCodes.MISSING_INDEX,
      message: 'No keyframe index found',
      suggestion: 'Add index for faster seeking',
    })
  }

  return issues
}

/** Validate against accessibility profile */
export function validateForAccessibility(info: {
  hasCaptions?: boolean
  hasAudioDescription?: boolean
  trackLanguages?: string[]
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (info.hasCaptions === false) {
    issues.push({
      severity: 'info',
      code: ValidationCodes.NO_CAPTIONS,
      message: 'No caption/subtitle track found',
      suggestion: 'Add captions for accessibility',
      reference: 'WCAG 1.2.2',
    })
  }

  if (info.hasAudioDescription === false) {
    issues.push({
      severity: 'info',
      code: ValidationCodes.NO_AUDIO_DESCRIPTION,
      message: 'No audio description track found',
      suggestion: 'Consider adding audio description for visually impaired users',
      reference: 'WCAG 1.2.5',
    })
  }

  if (info.trackLanguages) {
    const missingLang = info.trackLanguages.filter((l) => !l || l === 'und')
    if (missingLang.length > 0) {
      issues.push({
        severity: 'warning',
        code: ValidationCodes.MISSING_LANGUAGE,
        message: `${missingLang.length} track(s) missing language tag`,
        suggestion: 'Set language for all tracks',
        reference: 'WCAG 1.1.1',
      })
    }
  }

  return issues
}

// ============================================================================
// High-Level Validation
// ============================================================================

/** Validate media file with all checks */
export function validateMedia(
  data: Uint8Array,
  options: ValidationOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  const _streamIssues: Map<number, ValidationIssue[]> = new Map()

  const opts: Required<ValidationOptions> = {
    checkContainer: options.checkContainer ?? true,
    checkCodecs: options.checkCodecs ?? true,
    checkSync: options.checkSync ?? true,
    checkPlayback: options.checkPlayback ?? true,
    profiles: options.profiles ?? [],
    maxIssues: options.maxIssues ?? 100,
    minSeverity: options.minSeverity ?? 'info',
  }

  // Detect format
  let format: string | undefined

  // MP4/MOV
  if (data.length >= 8 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    format = 'mp4'
    if (opts.checkContainer) {
      issues.push(...validateMp4Container(data))
    }
  }

  // Matroska/WebM
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    format = 'matroska'
    if (opts.checkContainer) {
      issues.push(...validateMatroskaContainer(data))
    }
  }

  // Apply profile checks
  for (const profile of opts.profiles) {
    if (profile === 'web') {
      issues.push(...validateForWeb({}))
    }
    else if (profile === 'streaming') {
      issues.push(...validateForStreaming({}))
    }
    else if (profile === 'accessibility') {
      issues.push(...validateForAccessibility({}))
    }
  }

  // Filter by severity
  const severityOrder: Record<ValidationSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  }
  const minLevel = severityOrder[opts.minSeverity]
  const filteredIssues = issues.filter((i) => severityOrder[i.severity] <= minLevel)

  // Limit number of issues
  const limitedIssues = filteredIssues.slice(0, opts.maxIssues)

  // Calculate stats
  const stats = {
    errors: limitedIssues.filter((i) => i.severity === 'error').length,
    warnings: limitedIssues.filter((i) => i.severity === 'warning').length,
    infos: limitedIssues.filter((i) => i.severity === 'info').length,
  }

  return {
    valid: stats.errors === 0,
    playable: stats.errors === 0 || limitedIssues.every((i) => i.severity !== 'error' || !isFatalError(i.code)),
    issues: limitedIssues,
    stats,
    fileInfo: {
      format,
      size: data.length,
    },
  }
}

/** Check if an error code is fatal (prevents playback) */
function isFatalError(code: string): boolean {
  const fatalCodes = [
    ValidationCodes.INVALID_HEADER,
    ValidationCodes.MISSING_MOOV,
    ValidationCodes.MISSING_SPS,
    ValidationCodes.MISSING_PPS,
    ValidationCodes.MISSING_CONFIG,
  ]
  return fatalCodes.includes(code as typeof ValidationCodes[keyof typeof ValidationCodes])
}

/** Quick check if file is valid */
export function isValidMedia(data: Uint8Array): boolean {
  const result = validateMedia(data, {
    checkContainer: true,
    checkCodecs: false,
    checkSync: false,
    checkPlayback: false,
    minSeverity: 'error',
  })
  return result.valid
}

/** Get validation summary as string */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = []

  lines.push(`Validation: ${result.valid ? 'PASSED' : 'FAILED'}`)
  lines.push(`Playable: ${result.playable ? 'Yes' : 'No'}`)
  lines.push(`Issues: ${result.stats.errors} errors, ${result.stats.warnings} warnings, ${result.stats.infos} info`)

  if (result.fileInfo) {
    if (result.fileInfo.format) lines.push(`Format: ${result.fileInfo.format}`)
    if (result.fileInfo.size) lines.push(`Size: ${formatBytes(result.fileInfo.size)}`)
  }

  if (result.issues.length > 0) {
    lines.push('')
    lines.push('Issues:')
    for (const issue of result.issues) {
      const prefix = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '!' : '•'
      lines.push(`  ${prefix} [${issue.code}] ${issue.message}`)
      if (issue.suggestion) {
        lines.push(`    → ${issue.suggestion}`)
      }
    }
  }

  return lines.join('\n')
}

// ============================================================================
// Utility Functions
// ============================================================================

function readUint32BE(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

function readString(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.slice(offset, offset + length))
}

function readEbmlElement(data: Uint8Array, offset: number): { id: number; size: number; headerSize: number } {
  if (offset >= data.length) return { id: 0, size: 0, headerSize: 0 }

  let id = 0
  let idLen = 0
  const firstByte = data[offset]

  if (firstByte >= 0x80) {
    id = firstByte
    idLen = 1
  }
  else if (firstByte >= 0x40) {
    id = (firstByte << 8) | data[offset + 1]
    idLen = 2
  }
  else if (firstByte >= 0x20) {
    id = (firstByte << 16) | (data[offset + 1] << 8) | data[offset + 2]
    idLen = 3
  }
  else if (firstByte >= 0x10) {
    id = (firstByte << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    idLen = 4
  }
  else {
    return { id: 0, size: 0, headerSize: 0 }
  }

  let size = 0
  let sizeLen = 0
  const sizeOffset = offset + idLen
  const sizeByte = data[sizeOffset]

  if (sizeByte >= 0x80) {
    size = sizeByte & 0x7f
    sizeLen = 1
  }
  else if (sizeByte >= 0x40) {
    size = ((sizeByte & 0x3f) << 8) | data[sizeOffset + 1]
    sizeLen = 2
  }
  else if (sizeByte >= 0x20) {
    size = ((sizeByte & 0x1f) << 16) | (data[sizeOffset + 1] << 8) | data[sizeOffset + 2]
    sizeLen = 3
  }
  else if (sizeByte >= 0x10) {
    size = ((sizeByte & 0x0f) << 24) | (data[sizeOffset + 1] << 16) | (data[sizeOffset + 2] << 8) | data[sizeOffset + 3]
    sizeLen = 4
  }
  else {
    sizeLen = 1
  }

  return { id, size, headerSize: idLen + sizeLen }
}

function parseBasicSps(data: Uint8Array): { profileIdc: number; levelIdc: number; width: number; height: number } {
  // Skip NAL header if present
  let offset = 0
  if ((data[0] & 0x1f) === 7) {
    offset = 1
  }

  const profileIdc = data[offset]
  const levelIdc = data[offset + 2]

  // Very basic width/height extraction (simplified)
  // Real implementation would need full Exp-Golomb parsing
  const width = 1920
  const height = 1080

  return { profileIdc, levelIdc, width, height }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}
