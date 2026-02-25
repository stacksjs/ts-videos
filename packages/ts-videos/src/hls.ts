/* eslint-disable style/max-statements-per-line */
/**
 * HLS (HTTP Live Streaming) manifest generation
 * Generates M3U8 playlists for HLS streaming
 */

/**
 * HLS segment info
 */
export interface HlsSegment {
  /** Segment URI (relative or absolute) */
  uri: string
  /** Duration in seconds */
  duration: number
  /** Segment title (optional) */
  title?: string
  /** Byte range (for byte-range requests) */
  byteRange?: { length: number; offset?: number }
  /** Discontinuity before this segment */
  discontinuity?: boolean
  /** Program date/time */
  programDateTime?: Date
  /** Encryption key info */
  key?: HlsKey
  /** Map (initialization segment) */
  map?: HlsMap
}

/**
 * HLS encryption key
 */
export interface HlsKey {
  /** Encryption method */
  method: 'NONE' | 'AES-128' | 'SAMPLE-AES' | 'SAMPLE-AES-CTR'
  /** Key URI */
  uri?: string
  /** Initialization vector */
  iv?: string
  /** Key format */
  keyFormat?: string
  /** Key format versions */
  keyFormatVersions?: string
}

/**
 * HLS initialization segment (EXT-X-MAP)
 */
export interface HlsMap {
  /** URI of initialization segment */
  uri: string
  /** Byte range */
  byteRange?: { length: number; offset?: number }
}

/**
 * HLS media playlist options
 */
export interface HlsMediaPlaylistOptions {
  /** HLS version (default: 7) */
  version?: number
  /** Target segment duration in seconds */
  targetDuration: number
  /** Media sequence number */
  mediaSequence?: number
  /** Discontinuity sequence number */
  discontinuitySequence?: number
  /** Playlist type */
  playlistType?: 'VOD' | 'EVENT'
  /** Allow cache */
  allowCache?: boolean
  /** Is live (no ENDLIST) */
  isLive?: boolean
  /** Independent segments */
  independentSegments?: boolean
}

/**
 * HLS variant stream
 */
export interface HlsVariantStream {
  /** Playlist URI */
  uri: string
  /** Bandwidth in bits per second */
  bandwidth: number
  /** Average bandwidth */
  averageBandwidth?: number
  /** Resolution */
  resolution?: { width: number; height: number }
  /** Frame rate */
  frameRate?: number
  /** Codecs string */
  codecs?: string
  /** Audio group ID */
  audio?: string
  /** Video group ID */
  video?: string
  /** Subtitles group ID */
  subtitles?: string
  /** Closed captions group ID */
  closedCaptions?: string | 'NONE'
  /** HDCP level */
  hdcpLevel?: 'TYPE-0' | 'TYPE-1' | 'NONE'
  /** Name */
  name?: string
}

/**
 * HLS rendition (alternate media)
 */
export interface HlsRendition {
  /** Media type */
  type: 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS'
  /** Group ID */
  groupId: string
  /** Name */
  name: string
  /** Language */
  language?: string
  /** Associated language */
  assocLanguage?: string
  /** Is default */
  default?: boolean
  /** Auto-select */
  autoselect?: boolean
  /** Forced (for subtitles) */
  forced?: boolean
  /** Instream ID (for closed captions) */
  instreamId?: string
  /** Characteristics */
  characteristics?: string
  /** Channels (for audio) */
  channels?: string
  /** URI (optional for muxed) */
  uri?: string
}

/**
 * HLS master playlist options
 */
export interface HlsMasterPlaylistOptions {
  /** HLS version */
  version?: number
  /** Independent segments */
  independentSegments?: boolean
}

/**
 * Generate HLS media playlist (M3U8)
 */
export function generateMediaPlaylist(
  segments: HlsSegment[],
  options: HlsMediaPlaylistOptions,
): string {
  const lines: string[] = ['#EXTM3U']

  // Version
  const version = options.version ?? 7
  lines.push(`#EXT-X-VERSION:${version}`)

  // Target duration
  lines.push(`#EXT-X-TARGETDURATION:${Math.ceil(options.targetDuration)}`)

  // Media sequence
  if (options.mediaSequence !== undefined) {
    lines.push(`#EXT-X-MEDIA-SEQUENCE:${options.mediaSequence}`)
  }

  // Discontinuity sequence
  if (options.discontinuitySequence !== undefined) {
    lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${options.discontinuitySequence}`)
  }

  // Playlist type
  if (options.playlistType) {
    lines.push(`#EXT-X-PLAYLIST-TYPE:${options.playlistType}`)
  }

  // Allow cache
  if (options.allowCache !== undefined) {
    lines.push(`#EXT-X-ALLOW-CACHE:${options.allowCache ? 'YES' : 'NO'}`)
  }

  // Independent segments
  if (options.independentSegments) {
    lines.push('#EXT-X-INDEPENDENT-SEGMENTS')
  }

  // Current key (for tracking changes)
  let currentKey: HlsKey | undefined
  let currentMap: HlsMap | undefined

  // Segments
  for (const segment of segments) {
    // Discontinuity
    if (segment.discontinuity) {
      lines.push('#EXT-X-DISCONTINUITY')
    }

    // Key change
    if (segment.key && !keysEqual(segment.key, currentKey)) {
      lines.push(formatKey(segment.key))
      currentKey = segment.key
    }

    // Map change
    if (segment.map && !mapsEqual(segment.map, currentMap)) {
      lines.push(formatMap(segment.map))
      currentMap = segment.map
    }

    // Program date/time
    if (segment.programDateTime) {
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segment.programDateTime.toISOString()}`)
    }

    // Byte range
    if (segment.byteRange) {
      const range = segment.byteRange.offset !== undefined
        ? `${segment.byteRange.length}@${segment.byteRange.offset}`
        : `${segment.byteRange.length}`
      lines.push(`#EXT-X-BYTERANGE:${range}`)
    }

    // EXTINF
    const title = segment.title ?? ''
    lines.push(`#EXTINF:${segment.duration.toFixed(6)},${title}`)

    // URI
    lines.push(segment.uri)
  }

  // End list (for VOD or finished EVENT)
  if (!options.isLive) {
    lines.push('#EXT-X-ENDLIST')
  }

  return lines.join('\n') + '\n'
}

/**
 * Generate HLS master playlist
 */
export function generateMasterPlaylist(
  variants: HlsVariantStream[],
  renditions: HlsRendition[] = [],
  options: HlsMasterPlaylistOptions = {},
): string {
  const lines: string[] = ['#EXTM3U']

  // Version
  const version = options.version ?? 7
  lines.push(`#EXT-X-VERSION:${version}`)

  // Independent segments
  if (options.independentSegments) {
    lines.push('#EXT-X-INDEPENDENT-SEGMENTS')
  }

  // Renditions (EXT-X-MEDIA)
  for (const rendition of renditions) {
    lines.push(formatRendition(rendition))
  }

  // Blank line before variants
  if (renditions.length > 0) {
    lines.push('')
  }

  // Variant streams
  for (const variant of variants) {
    lines.push(formatVariant(variant))
    lines.push(variant.uri)
  }

  return lines.join('\n') + '\n'
}

/**
 * Generate I-frame playlist
 */
export function generateIFramePlaylist(
  iFrames: Array<{
    uri: string
    duration: number
    byteRange: { length: number; offset: number }
  }>,
  options: { version?: number; targetDuration: number },
): string {
  const lines: string[] = ['#EXTM3U']

  lines.push(`#EXT-X-VERSION:${options.version ?? 7}`)
  lines.push(`#EXT-X-TARGETDURATION:${Math.ceil(options.targetDuration)}`)
  lines.push('#EXT-X-I-FRAMES-ONLY')

  for (const frame of iFrames) {
    lines.push(`#EXTINF:${frame.duration.toFixed(6)},`)
    lines.push(`#EXT-X-BYTERANGE:${frame.byteRange.length}@${frame.byteRange.offset}`)
    lines.push(frame.uri)
  }

  lines.push('#EXT-X-ENDLIST')

  return lines.join('\n') + '\n'
}

function formatKey(key: HlsKey): string {
  const attrs: string[] = [`METHOD=${key.method}`]

  if (key.uri) {
    attrs.push(`URI="${key.uri}"`)
  }
  if (key.iv) {
    attrs.push(`IV=${key.iv}`)
  }
  if (key.keyFormat) {
    attrs.push(`KEYFORMAT="${key.keyFormat}"`)
  }
  if (key.keyFormatVersions) {
    attrs.push(`KEYFORMATVERSIONS="${key.keyFormatVersions}"`)
  }

  return `#EXT-X-KEY:${attrs.join(',')}`
}

function formatMap(map: HlsMap): string {
  const attrs: string[] = [`URI="${map.uri}"`]

  if (map.byteRange) {
    const range = map.byteRange.offset !== undefined
      ? `${map.byteRange.length}@${map.byteRange.offset}`
      : `${map.byteRange.length}`
    attrs.push(`BYTERANGE="${range}"`)
  }

  return `#EXT-X-MAP:${attrs.join(',')}`
}

function formatRendition(rendition: HlsRendition): string {
  const attrs: string[] = [
    `TYPE=${rendition.type}`,
    `GROUP-ID="${rendition.groupId}"`,
    `NAME="${rendition.name}"`,
  ]

  if (rendition.language) {
    attrs.push(`LANGUAGE="${rendition.language}"`)
  }
  if (rendition.assocLanguage) {
    attrs.push(`ASSOC-LANGUAGE="${rendition.assocLanguage}"`)
  }
  if (rendition.default) {
    attrs.push('DEFAULT=YES')
  }
  if (rendition.autoselect) {
    attrs.push('AUTOSELECT=YES')
  }
  if (rendition.forced) {
    attrs.push('FORCED=YES')
  }
  if (rendition.instreamId) {
    attrs.push(`INSTREAM-ID="${rendition.instreamId}"`)
  }
  if (rendition.characteristics) {
    attrs.push(`CHARACTERISTICS="${rendition.characteristics}"`)
  }
  if (rendition.channels) {
    attrs.push(`CHANNELS="${rendition.channels}"`)
  }
  if (rendition.uri) {
    attrs.push(`URI="${rendition.uri}"`)
  }

  return `#EXT-X-MEDIA:${attrs.join(',')}`
}

function formatVariant(variant: HlsVariantStream): string {
  const attrs: string[] = [`BANDWIDTH=${variant.bandwidth}`]

  if (variant.averageBandwidth) {
    attrs.push(`AVERAGE-BANDWIDTH=${variant.averageBandwidth}`)
  }
  if (variant.resolution) {
    attrs.push(`RESOLUTION=${variant.resolution.width}x${variant.resolution.height}`)
  }
  if (variant.frameRate) {
    attrs.push(`FRAME-RATE=${variant.frameRate.toFixed(3)}`)
  }
  if (variant.codecs) {
    attrs.push(`CODECS="${variant.codecs}"`)
  }
  if (variant.audio) {
    attrs.push(`AUDIO="${variant.audio}"`)
  }
  if (variant.video) {
    attrs.push(`VIDEO="${variant.video}"`)
  }
  if (variant.subtitles) {
    attrs.push(`SUBTITLES="${variant.subtitles}"`)
  }
  if (variant.closedCaptions) {
    attrs.push(variant.closedCaptions === 'NONE'
      ? 'CLOSED-CAPTIONS=NONE'
      : `CLOSED-CAPTIONS="${variant.closedCaptions}"`)
  }
  if (variant.hdcpLevel) {
    attrs.push(`HDCP-LEVEL=${variant.hdcpLevel}`)
  }
  if (variant.name) {
    attrs.push(`NAME="${variant.name}"`)
  }

  return `#EXT-X-STREAM-INF:${attrs.join(',')}`
}

function keysEqual(a: HlsKey, b?: HlsKey): boolean {
  if (!b) return false
  return a.method === b.method && a.uri === b.uri && a.iv === b.iv
}

function mapsEqual(a: HlsMap, b?: HlsMap): boolean {
  if (!b) return false
  return a.uri === b.uri &&
    a.byteRange?.length === b.byteRange?.length &&
    a.byteRange?.offset === b.byteRange?.offset
}

/**
 * Parse HLS media playlist
 */
export function parseMediaPlaylist(content: string): {
  segments: HlsSegment[]
  options: Partial<HlsMediaPlaylistOptions>
} {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l)
  const segments: HlsSegment[] = []
  const options: Partial<HlsMediaPlaylistOptions> = {}

  let currentSegment: Partial<HlsSegment> = {}
  let currentKey: HlsKey | undefined
  let currentMap: HlsMap | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('#EXT-X-VERSION:')) {
      options.version = parseInt(line.substring(15), 10)
    }
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      options.targetDuration = parseInt(line.substring(22), 10)
    }
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      options.mediaSequence = parseInt(line.substring(22), 10)
    }
    else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      options.playlistType = line.substring(21) as 'VOD' | 'EVENT'
    }
    else if (line === '#EXT-X-INDEPENDENT-SEGMENTS') {
      options.independentSegments = true
    }
    else if (line === '#EXT-X-DISCONTINUITY') {
      currentSegment.discontinuity = true
    }
    else if (line.startsWith('#EXT-X-KEY:')) {
      currentKey = parseKey(line.substring(11))
    }
    else if (line.startsWith('#EXT-X-MAP:')) {
      currentMap = parseMap(line.substring(11))
    }
    else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      currentSegment.programDateTime = new Date(line.substring(25))
    }
    else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      currentSegment.byteRange = parseByteRange(line.substring(17))
    }
    else if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+),?(.*)/)
      if (match) {
        currentSegment.duration = parseFloat(match[1])
        if (match[2]) currentSegment.title = match[2]
      }
    }
    else if (!line.startsWith('#')) {
      // URI line
      segments.push({
        uri: line,
        duration: currentSegment.duration ?? 0,
        title: currentSegment.title,
        byteRange: currentSegment.byteRange,
        discontinuity: currentSegment.discontinuity,
        programDateTime: currentSegment.programDateTime,
        key: currentKey,
        map: currentMap,
      })
      currentSegment = {}
    }
  }

  return { segments, options }
}

function parseKey(attrs: string): HlsKey {
  const key: HlsKey = { method: 'NONE' }
  const pairs = parseAttributes(attrs)

  for (const [name, value] of pairs) {
    switch (name) {
      case 'METHOD':
        key.method = value as HlsKey['method']
        break
      case 'URI':
        key.uri = value
        break
      case 'IV':
        key.iv = value
        break
      case 'KEYFORMAT':
        key.keyFormat = value
        break
      case 'KEYFORMATVERSIONS':
        key.keyFormatVersions = value
        break
    }
  }

  return key
}

function parseMap(attrs: string): HlsMap {
  const map: HlsMap = { uri: '' }
  const pairs = parseAttributes(attrs)

  for (const [name, value] of pairs) {
    switch (name) {
      case 'URI':
        map.uri = value
        break
      case 'BYTERANGE':
        map.byteRange = parseByteRange(value)
        break
    }
  }

  return map
}

function parseByteRange(value: string): { length: number; offset?: number } {
  const parts = value.split('@')
  return {
    length: parseInt(parts[0], 10),
    offset: parts[1] ? parseInt(parts[1], 10) : undefined,
  }
}

function parseAttributes(attrs: string): Array<[string, string]> {
  const result: Array<[string, string]> = []
  const regex = /([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g
  let match

  while ((match = regex.exec(attrs)) !== null) {
    result.push([match[1], match[2] ?? match[3]])
  }

  return result
}

/**
 * HLS playlist builder for easier creation
 */
export class HlsPlaylistBuilder {
  private segments: HlsSegment[] = []
  private variants: HlsVariantStream[] = []
  private renditions: HlsRendition[] = []
  private targetDuration = 6
  private version = 7

  /**
   * Set target duration
   */
  setTargetDuration(duration: number): this {
    this.targetDuration = duration
    return this
  }

  /**
   * Set HLS version
   */
  setVersion(version: number): this {
    this.version = version
    return this
  }

  /**
   * Add a segment
   */
  addSegment(segment: HlsSegment): this {
    this.segments.push(segment)
    return this
  }

  /**
   * Add multiple segments
   */
  addSegments(segments: HlsSegment[]): this {
    this.segments.push(...segments)
    return this
  }

  /**
   * Add a variant stream
   */
  addVariant(variant: HlsVariantStream): this {
    this.variants.push(variant)
    return this
  }

  /**
   * Add a rendition
   */
  addRendition(rendition: HlsRendition): this {
    this.renditions.push(rendition)
    return this
  }

  /**
   * Build media playlist
   */
  buildMediaPlaylist(options: Partial<HlsMediaPlaylistOptions> = {}): string {
    return generateMediaPlaylist(this.segments, {
      targetDuration: this.targetDuration,
      version: this.version,
      ...options,
    })
  }

  /**
   * Build master playlist
   */
  buildMasterPlaylist(options: Partial<HlsMasterPlaylistOptions> = {}): string {
    return generateMasterPlaylist(this.variants, this.renditions, {
      version: this.version,
      ...options,
    })
  }
}

/**
 * Generate codec string for HLS
 */
export function generateCodecString(options: {
  videoCodec?: 'h264' | 'h265' | 'vp9' | 'av1'
  videoProfile?: string
  videoLevel?: string
  audioCodec?: 'aac' | 'ac3' | 'ec3' | 'opus' | 'flac'
  audioProfile?: string
}): string {
  const codecs: string[] = []

  // Video codec
  if (options.videoCodec) {
    switch (options.videoCodec) {
      case 'h264':
        // avc1.PPCCLL (profile, constraint, level)
        codecs.push(`avc1.${options.videoProfile ?? '64001f'}`)
        break
      case 'h265':
        // hvc1 or hev1
        codecs.push(`hvc1.${options.videoProfile ?? '1.6.L93.B0'}`)
        break
      case 'vp9':
        codecs.push(`vp09.${options.videoProfile ?? '00.10.08'}`)
        break
      case 'av1':
        codecs.push(`av01.${options.videoProfile ?? '0.01M.08'}`)
        break
    }
  }

  // Audio codec
  if (options.audioCodec) {
    switch (options.audioCodec) {
      case 'aac':
        // mp4a.40.X (2=LC, 5=HE-AAC, 29=HE-AACv2)
        codecs.push(`mp4a.40.${options.audioProfile ?? '2'}`)
        break
      case 'ac3':
        codecs.push('ac-3')
        break
      case 'ec3':
        codecs.push('ec-3')
        break
      case 'opus':
        codecs.push('opus')
        break
      case 'flac':
        codecs.push('flac')
        break
    }
  }

  return codecs.join(',')
}
