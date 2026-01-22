/**
 * Concatenation and splitting utilities for media files
 * Join multiple files or split files at specific points
 */

// ============================================================================
// Types
// ============================================================================

/** Segment information for splitting */
export interface SplitSegment {
  /** Segment index */
  index: number
  /** Start time in milliseconds */
  startTime: number
  /** End time in milliseconds */
  endTime: number
  /** Duration in milliseconds */
  duration: number
  /** Output filename (if specified) */
  filename?: string
}

/** Options for splitting media */
export interface SplitOptions {
  /** Split by duration (milliseconds per segment) */
  duration?: number
  /** Split by count (number of segments) */
  count?: number
  /** Split at specific timestamps (milliseconds) */
  timestamps?: number[]
  /** Split at scene changes */
  sceneChanges?: boolean
  /** Split at chapter markers */
  chapters?: boolean
  /** Output filename pattern (e.g., 'output_%03d.mp4') */
  outputPattern?: string
  /** Minimum segment duration (milliseconds) */
  minDuration?: number
  /** Split on keyframes only */
  keyframeAlign?: boolean
}

/** Options for concatenating media */
export interface ConcatOptions {
  /** Transition type between clips */
  transition?: 'none' | 'crossfade' | 'fade'
  /** Transition duration (milliseconds) */
  transitionDuration?: number
  /** Normalize audio levels */
  normalizeAudio?: boolean
  /** Target loudness (LUFS) for normalization */
  targetLoudness?: number
  /** Resize mode for different dimensions */
  resizeMode?: 'fit' | 'fill' | 'stretch' | 'none'
  /** Target dimensions (when resize is enabled) */
  targetWidth?: number
  targetHeight?: number
  /** Output format */
  format?: string
}

/** Input file information for concatenation */
export interface ConcatInput {
  /** File path or data */
  source: string | Uint8Array
  /** Trim start time (milliseconds) */
  trimStart?: number
  /** Trim end time (milliseconds) */
  trimEnd?: number
  /** Gain adjustment (dB) */
  gainDb?: number
  /** Video filter to apply */
  videoFilter?: string
  /** Audio filter to apply */
  audioFilter?: string
}

/** Concatenation plan */
export interface ConcatPlan {
  /** Input segments */
  segments: Array<{
    source: ConcatInput
    startTime: number
    endTime: number
    duration: number
    transition?: {
      type: 'crossfade' | 'fade'
      duration: number
    }
  }>
  /** Total output duration */
  totalDuration: number
  /** Transitions count */
  transitionCount: number
}

// ============================================================================
// Splitting Functions
// ============================================================================

/** Calculate split points based on options */
export function calculateSplitPoints(
  duration: number,
  options: SplitOptions,
): SplitSegment[] {
  const segments: SplitSegment[] = []
  const minDuration = options.minDuration ?? 1000

  if (options.timestamps && options.timestamps.length > 0) {
    // Split at specific timestamps
    const points = [0, ...options.timestamps, duration].sort((a, b) => a - b)

    for (let i = 0; i < points.length - 1; i++) {
      const startTime = points[i]
      const endTime = points[i + 1]
      const segDuration = endTime - startTime

      if (segDuration >= minDuration) {
        segments.push({
          index: segments.length,
          startTime,
          endTime,
          duration: segDuration,
        })
      } else if (segments.length > 0) {
        // Merge with previous segment
        segments[segments.length - 1].endTime = endTime
        segments[segments.length - 1].duration = endTime - segments[segments.length - 1].startTime
      }
    }
  } else if (options.count && options.count > 0) {
    // Split into N equal segments
    const segmentDuration = duration / options.count

    for (let i = 0; i < options.count; i++) {
      segments.push({
        index: i,
        startTime: i * segmentDuration,
        endTime: Math.min((i + 1) * segmentDuration, duration),
        duration: Math.min(segmentDuration, duration - i * segmentDuration),
      })
    }
  } else if (options.duration && options.duration > 0) {
    // Split by duration
    let currentTime = 0

    while (currentTime < duration) {
      const segDuration = Math.min(options.duration, duration - currentTime)

      if (segDuration >= minDuration) {
        segments.push({
          index: segments.length,
          startTime: currentTime,
          endTime: currentTime + segDuration,
          duration: segDuration,
        })
      } else if (segments.length > 0) {
        // Extend previous segment
        segments[segments.length - 1].endTime = duration
        segments[segments.length - 1].duration =
          duration - segments[segments.length - 1].startTime
      }

      currentTime += options.duration
    }
  } else {
    // No split, return single segment
    segments.push({
      index: 0,
      startTime: 0,
      endTime: duration,
      duration: duration,
    })
  }

  // Apply output pattern
  if (options.outputPattern) {
    for (const segment of segments) {
      segment.filename = formatSegmentFilename(options.outputPattern, segment.index)
    }
  }

  return segments
}

/** Format segment filename from pattern */
export function formatSegmentFilename(pattern: string, index: number): string {
  // Replace %d, %02d, %03d, etc. with index
  return pattern.replace(/%0?(\d*)d/g, (_, width) => {
    const w = parseInt(width) || 1
    return index.toString().padStart(w, '0')
  })
}

/** Calculate split points aligned to keyframes */
export function alignToKeyframes(
  segments: SplitSegment[],
  keyframeTimes: number[],
): SplitSegment[] {
  if (keyframeTimes.length === 0) return segments

  const alignedSegments: SplitSegment[] = []

  for (const segment of segments) {
    // Find nearest keyframe to start
    let alignedStart = segment.startTime
    let minStartDist = Infinity

    for (const kf of keyframeTimes) {
      const dist = Math.abs(kf - segment.startTime)
      if (dist < minStartDist && kf <= segment.endTime) {
        minStartDist = dist
        alignedStart = kf
      }
    }

    // Find nearest keyframe to end (prefer ending after original end)
    let alignedEnd = segment.endTime

    for (const kf of keyframeTimes) {
      if (kf >= segment.endTime && kf < segment.endTime + 5000) {
        alignedEnd = kf
        break
      }
    }

    alignedSegments.push({
      ...segment,
      startTime: alignedStart,
      endTime: alignedEnd,
      duration: alignedEnd - alignedStart,
    })
  }

  return alignedSegments
}

/** Merge adjacent segments that are too short */
export function mergeShortSegments(
  segments: SplitSegment[],
  minDuration: number,
): SplitSegment[] {
  if (segments.length <= 1) return segments

  const merged: SplitSegment[] = [{ ...segments[0] }]

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i]
    const previous = merged[merged.length - 1]

    if (current.duration < minDuration || previous.duration < minDuration) {
      // Merge with previous
      previous.endTime = current.endTime
      previous.duration = previous.endTime - previous.startTime
    } else {
      merged.push({ ...current, index: merged.length })
    }
  }

  return merged
}

// ============================================================================
// Concatenation Functions
// ============================================================================

/** Create a concatenation plan */
export function createConcatPlan(
  inputs: ConcatInput[],
  durations: number[],
  options: ConcatOptions = {},
): ConcatPlan {
  if (inputs.length !== durations.length) {
    throw new Error('Inputs and durations arrays must have same length')
  }

  const transitionType = options.transition ?? 'none'
  const transitionDuration = options.transitionDuration ?? 1000

  const segments: ConcatPlan['segments'] = []
  let currentTime = 0

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    const sourceDuration = durations[i]

    // Calculate effective duration
    const trimStart = input.trimStart ?? 0
    const trimEnd = input.trimEnd ?? sourceDuration
    const segmentDuration = trimEnd - trimStart

    // Add transition from previous segment
    let transition: ConcatPlan['segments'][0]['transition'] | undefined

    if (i > 0 && transitionType !== 'none') {
      transition = {
        type: transitionType as 'crossfade' | 'fade',
        duration: transitionDuration,
      }
      // Transitions overlap, so adjust timing
      currentTime -= transitionDuration
    }

    segments.push({
      source: input,
      startTime: currentTime,
      endTime: currentTime + segmentDuration,
      duration: segmentDuration,
      transition,
    })

    currentTime += segmentDuration
  }

  // Calculate total duration accounting for transitions
  const transitionCount = transitionType !== 'none' ? inputs.length - 1 : 0
  const totalDuration = currentTime

  return {
    segments,
    totalDuration,
    transitionCount,
  }
}

/** Generate concat list for file-based concatenation */
export function generateConcatList(
  filePaths: string[],
  format: 'ffmpeg' | 'simple' = 'ffmpeg',
): string {
  if (format === 'ffmpeg') {
    // FFmpeg concat demuxer format
    const lines = filePaths.map((path) => {
      const escaped = path.replace(/'/g, "'\\''")
      return `file '${escaped}'`
    })
    return lines.join('\n')
  } else {
    // Simple list
    return filePaths.join('\n')
  }
}

/** Calculate output dimensions for concatenation */
export function calculateOutputDimensions(
  inputDimensions: Array<{ width: number; height: number }>,
  mode: ConcatOptions['resizeMode'] = 'fit',
  targetWidth?: number,
  targetHeight?: number,
): { width: number; height: number } {
  if (inputDimensions.length === 0) {
    return { width: 1920, height: 1080 }
  }

  if (targetWidth && targetHeight) {
    return { width: targetWidth, height: targetHeight }
  }

  if (mode === 'none') {
    // Use first input dimensions
    return inputDimensions[0]
  }

  // Find max dimensions
  let maxWidth = 0
  let maxHeight = 0

  for (const dim of inputDimensions) {
    if (dim.width > maxWidth) maxWidth = dim.width
    if (dim.height > maxHeight) maxHeight = dim.height
  }

  return { width: maxWidth, height: maxHeight }
}

// ============================================================================
// Trim Functions
// ============================================================================

/** Calculate trim points with fade in/out */
export function calculateTrimWithFade(
  startTime: number,
  endTime: number,
  fadeIn: number = 0,
  fadeOut: number = 0,
): {
  startTime: number
  endTime: number
  fadeIn: { start: number; end: number } | null
  fadeOut: { start: number; end: number } | null
} {
  const duration = endTime - startTime

  if (fadeIn + fadeOut > duration) {
    // Adjust fades to fit
    const ratio = duration / (fadeIn + fadeOut)
    fadeIn = Math.floor(fadeIn * ratio)
    fadeOut = Math.floor(fadeOut * ratio)
  }

  return {
    startTime,
    endTime,
    fadeIn: fadeIn > 0 ? { start: startTime, end: startTime + fadeIn } : null,
    fadeOut: fadeOut > 0 ? { start: endTime - fadeOut, end: endTime } : null,
  }
}

/** Extract subclip information */
export function extractSubclip(
  sourceDuration: number,
  start: number | string,
  end: number | string,
): { startMs: number; endMs: number; durationMs: number } {
  const startMs = typeof start === 'string' ? parseTimestamp(start) : start
  const endMs = typeof end === 'string' ? parseTimestamp(end) : end

  const clampedStart = Math.max(0, Math.min(startMs, sourceDuration))
  const clampedEnd = Math.max(clampedStart, Math.min(endMs, sourceDuration))

  return {
    startMs: clampedStart,
    endMs: clampedEnd,
    durationMs: clampedEnd - clampedStart,
  }
}

/** Parse timestamp string to milliseconds */
export function parseTimestamp(timestamp: string): number {
  // Support formats: HH:MM:SS.mmm, MM:SS.mmm, SS.mmm, SS
  const parts = timestamp.split(':').map((p) => parseFloat(p))

  if (parts.length === 3) {
    return parts[0] * 3600000 + parts[1] * 60000 + parts[2] * 1000
  } else if (parts.length === 2) {
    return parts[0] * 60000 + parts[1] * 1000
  } else if (parts.length === 1) {
    return parts[0] * 1000
  }

  return 0
}

/** Format milliseconds to timestamp string */
export function formatTimestamp(ms: number, includeMillis: boolean = true): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor(ms % 1000)

  const parts = [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ]

  if (includeMillis) {
    return `${parts.join(':')}${'.'}${millis.toString().padStart(3, '0')}`
  }

  return parts.join(':')
}

// ============================================================================
// Batch Operations
// ============================================================================

/** Split plan for batch operations */
export interface BatchSplitPlan {
  sourceFile: string
  segments: SplitSegment[]
  outputPattern: string
}

/** Create batch split plans for multiple files */
export function createBatchSplitPlans(
  files: Array<{ path: string; duration: number }>,
  options: SplitOptions,
): BatchSplitPlan[] {
  const plans: BatchSplitPlan[] = []

  for (const file of files) {
    const segments = calculateSplitPoints(file.duration, options)

    // Generate output pattern based on source filename
    const baseName = file.path.replace(/\.[^.]+$/, '')
    const ext = file.path.match(/\.[^.]+$/)?.[0] ?? '.mp4'
    const outputPattern = `${baseName}_%03d${ext}`

    // Apply pattern to segments
    for (const segment of segments) {
      segment.filename = formatSegmentFilename(outputPattern, segment.index)
    }

    plans.push({
      sourceFile: file.path,
      segments,
      outputPattern,
    })
  }

  return plans
}

/** Estimate output file sizes for split segments */
export function estimateSplitSizes(
  sourceSizeBytes: number,
  sourceDurationMs: number,
  segments: SplitSegment[],
): Array<{ segment: SplitSegment; estimatedSize: number }> {
  const bytesPerMs = sourceSizeBytes / sourceDurationMs

  return segments.map((segment) => ({
    segment,
    estimatedSize: Math.round(segment.duration * bytesPerMs),
  }))
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Check if segments cover entire duration without gaps */
export function validateSegmentCoverage(
  segments: SplitSegment[],
  totalDuration: number,
  tolerance: number = 100,
): { complete: boolean; gaps: Array<{ start: number; end: number }> } {
  const gaps: Array<{ start: number; end: number }> = []

  // Sort segments by start time
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime)

  // Check for gap at beginning
  if (sorted.length > 0 && sorted[0].startTime > tolerance) {
    gaps.push({ start: 0, end: sorted[0].startTime })
  }

  // Check for gaps between segments
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startTime - sorted[i - 1].endTime
    if (gap > tolerance) {
      gaps.push({
        start: sorted[i - 1].endTime,
        end: sorted[i].startTime,
      })
    }
  }

  // Check for gap at end
  if (sorted.length > 0) {
    const lastEnd = sorted[sorted.length - 1].endTime
    if (totalDuration - lastEnd > tolerance) {
      gaps.push({ start: lastEnd, end: totalDuration })
    }
  }

  return {
    complete: gaps.length === 0,
    gaps,
  }
}

/** Calculate total duration from concat plan */
export function calculateConcatDuration(plan: ConcatPlan): {
  totalDuration: number
  effectiveDurations: number[]
} {
  const effectiveDurations = plan.segments.map((s) => s.duration)

  return {
    totalDuration: plan.totalDuration,
    effectiveDurations,
  }
}

/** Generate chapter markers from split segments */
export function segmentsToChapters(
  segments: SplitSegment[],
  titles?: string[],
): Array<{ startTime: number; title: string }> {
  return segments.map((segment, i) => ({
    startTime: segment.startTime,
    title: titles?.[i] ?? `Chapter ${i + 1}`,
  }))
}

/** Calculate seek position for random access */
export function calculateSeekPosition(
  timestamp: number,
  keyframeTimes: number[],
  seekBackward: boolean = true,
): number {
  if (keyframeTimes.length === 0) return timestamp

  let nearestKeyframe = keyframeTimes[0]

  for (const kf of keyframeTimes) {
    if (seekBackward) {
      if (kf <= timestamp && kf > nearestKeyframe) {
        nearestKeyframe = kf
      }
    } else {
      if (kf >= timestamp) {
        nearestKeyframe = kf
        break
      }
    }
  }

  return nearestKeyframe
}
