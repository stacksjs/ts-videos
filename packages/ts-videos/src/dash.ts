/**
 * DASH (Dynamic Adaptive Streaming over HTTP) manifest generation
 * Generates MPD (Media Presentation Description) files
 */

/**
 * DASH profile
 */
export type DashProfile =
  | 'urn:mpeg:dash:profile:isoff-live:2011'
  | 'urn:mpeg:dash:profile:isoff-on-demand:2011'
  | 'urn:mpeg:dash:profile:isoff-main:2011'
  | 'urn:mpeg:dash:profile:full:2011'

/**
 * DASH segment info
 */
export interface DashSegment {
  /** Start time in timescale units */
  startTime: number
  /** Duration in timescale units */
  duration: number
  /** Repeat count (0 = no repeat) */
  repeatCount?: number
}

/**
 * DASH segment template
 */
export interface DashSegmentTemplate {
  /** Timescale */
  timescale: number
  /** Media URL template */
  media: string
  /** Initialization URL template */
  initialization?: string
  /** Start number */
  startNumber?: number
  /** Duration (for simple template) */
  duration?: number
  /** Presentation time offset */
  presentationTimeOffset?: number
  /** Segment timeline */
  segmentTimeline?: DashSegment[]
}

/**
 * DASH segment list
 */
export interface DashSegmentList {
  /** Timescale */
  timescale: number
  /** Duration */
  duration: number
  /** Initialization */
  initialization?: { sourceURL: string; range?: string }
  /** Segment URLs */
  segmentURLs: Array<{ media: string; mediaRange?: string }>
}

/**
 * DASH segment base (for single segment)
 */
export interface DashSegmentBase {
  /** Timescale */
  timescale?: number
  /** Presentation time offset */
  presentationTimeOffset?: number
  /** Index range */
  indexRange?: string
  /** Initialization range */
  initialization?: { range: string }
}

/**
 * DASH representation
 */
export interface DashRepresentation {
  /** Representation ID */
  id: string
  /** Bandwidth in bps */
  bandwidth: number
  /** Codecs string */
  codecs?: string
  /** MIME type */
  mimeType?: string
  /** Width (video) */
  width?: number
  /** Height (video) */
  height?: number
  /** Frame rate */
  frameRate?: string
  /** Sample rate (audio) */
  audioSamplingRate?: number
  /** Audio channels */
  audioChannels?: number
  /** Segment template */
  segmentTemplate?: DashSegmentTemplate
  /** Segment list */
  segmentList?: DashSegmentList
  /** Segment base */
  segmentBase?: DashSegmentBase
  /** Base URL */
  baseURL?: string
}

/**
 * DASH adaptation set
 */
export interface DashAdaptationSet {
  /** ID */
  id?: number
  /** Content type */
  contentType?: 'video' | 'audio' | 'text'
  /** MIME type */
  mimeType?: string
  /** Codecs */
  codecs?: string
  /** Language */
  lang?: string
  /** Segment alignment */
  segmentAlignment?: boolean
  /** Bitstream switching */
  bitstreamSwitching?: boolean
  /** Subsegment alignment */
  subsegmentAlignment?: boolean
  /** Subsegment starts with SAP */
  subsegmentStartsWithSAP?: number
  /** Width (video) */
  width?: number
  /** Height (video) */
  height?: number
  /** Frame rate */
  frameRate?: string
  /** PAR (pixel aspect ratio) */
  par?: string
  /** Max width */
  maxWidth?: number
  /** Max height */
  maxHeight?: number
  /** Max frame rate */
  maxFrameRate?: string
  /** Audio channels */
  audioChannels?: number
  /** Segment template (shared) */
  segmentTemplate?: DashSegmentTemplate
  /** Representations */
  representations: DashRepresentation[]
  /** Content protection */
  contentProtection?: DashContentProtection[]
  /** Role */
  role?: { schemeIdUri: string; value: string }
  /** Accessibility */
  accessibility?: { schemeIdUri: string; value: string }
}

/**
 * DASH content protection (DRM)
 */
export interface DashContentProtection {
  /** Scheme ID URI */
  schemeIdUri: string
  /** Value */
  value?: string
  /** Default KID */
  defaultKID?: string
  /** PSSH data (base64) */
  pssh?: string
  /** Custom elements */
  customElements?: string
}

/**
 * DASH period
 */
export interface DashPeriod {
  /** Period ID */
  id?: string
  /** Start time (ISO 8601 duration) */
  start?: string
  /** Duration (ISO 8601 duration) */
  duration?: string
  /** Base URL */
  baseURL?: string
  /** Adaptation sets */
  adaptationSets: DashAdaptationSet[]
}

/**
 * DASH MPD options
 */
export interface DashMpdOptions {
  /** Profile */
  profiles?: DashProfile | DashProfile[]
  /** Type */
  type?: 'static' | 'dynamic'
  /** Media presentation duration (ISO 8601) */
  mediaPresentationDuration?: string
  /** Minimum buffer time (ISO 8601) */
  minBufferTime?: string
  /** Minimum update period (for live) */
  minimumUpdatePeriod?: string
  /** Availability start time */
  availabilityStartTime?: Date
  /** Publish time */
  publishTime?: Date
  /** Time shift buffer depth (for live) */
  timeShiftBufferDepth?: string
  /** Suggested presentation delay */
  suggestedPresentationDelay?: string
  /** Max segment duration */
  maxSegmentDuration?: string
  /** Base URL */
  baseURL?: string
}

/**
 * Generate DASH MPD
 */
export function generateMpd(
  periods: DashPeriod[],
  options: DashMpdOptions = {},
): string {
  const profiles = Array.isArray(options.profiles)
    ? options.profiles.join(',')
    : options.profiles ?? 'urn:mpeg:dash:profile:isoff-live:2011'

  const attrs: string[] = [
    'xmlns="urn:mpeg:dash:schema:mpd:2011"',
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    'xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd"',
    `profiles="${profiles}"`,
    `type="${options.type ?? 'static'}"`,
  ]

  if (options.mediaPresentationDuration) {
    attrs.push(`mediaPresentationDuration="${options.mediaPresentationDuration}"`)
  }
  if (options.minBufferTime) {
    attrs.push(`minBufferTime="${options.minBufferTime}"`)
  }
  if (options.minimumUpdatePeriod) {
    attrs.push(`minimumUpdatePeriod="${options.minimumUpdatePeriod}"`)
  }
  if (options.availabilityStartTime) {
    attrs.push(`availabilityStartTime="${options.availabilityStartTime.toISOString()}"`)
  }
  if (options.publishTime) {
    attrs.push(`publishTime="${options.publishTime.toISOString()}"`)
  }
  if (options.timeShiftBufferDepth) {
    attrs.push(`timeShiftBufferDepth="${options.timeShiftBufferDepth}"`)
  }
  if (options.suggestedPresentationDelay) {
    attrs.push(`suggestedPresentationDelay="${options.suggestedPresentationDelay}"`)
  }
  if (options.maxSegmentDuration) {
    attrs.push(`maxSegmentDuration="${options.maxSegmentDuration}"`)
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += `<MPD ${attrs.join(' ')}>\n`

  if (options.baseURL) {
    xml += `  <BaseURL>${escapeXml(options.baseURL)}</BaseURL>\n`
  }

  for (const period of periods) {
    xml += generatePeriod(period, 1)
  }

  xml += '</MPD>\n'

  return xml
}

function generatePeriod(period: DashPeriod, indent: number): string {
  const spaces = '  '.repeat(indent)
  const attrs: string[] = []

  if (period.id) attrs.push(`id="${period.id}"`)
  if (period.start) attrs.push(`start="${period.start}"`)
  if (period.duration) attrs.push(`duration="${period.duration}"`)

  let xml = `${spaces}<Period${attrs.length ? ' ' + attrs.join(' ') : ''}>\n`

  if (period.baseURL) {
    xml += `${spaces}  <BaseURL>${escapeXml(period.baseURL)}</BaseURL>\n`
  }

  for (const adaptationSet of period.adaptationSets) {
    xml += generateAdaptationSet(adaptationSet, indent + 1)
  }

  xml += `${spaces}</Period>\n`

  return xml
}

function generateAdaptationSet(as: DashAdaptationSet, indent: number): string {
  const spaces = '  '.repeat(indent)
  const attrs: string[] = []

  if (as.id !== undefined) attrs.push(`id="${as.id}"`)
  if (as.contentType) attrs.push(`contentType="${as.contentType}"`)
  if (as.mimeType) attrs.push(`mimeType="${as.mimeType}"`)
  if (as.codecs) attrs.push(`codecs="${as.codecs}"`)
  if (as.lang) attrs.push(`lang="${as.lang}"`)
  if (as.segmentAlignment) attrs.push('segmentAlignment="true"')
  if (as.bitstreamSwitching) attrs.push('bitstreamSwitching="true"')
  if (as.subsegmentAlignment) attrs.push('subsegmentAlignment="true"')
  if (as.subsegmentStartsWithSAP !== undefined) {
    attrs.push(`subsegmentStartsWithSAP="${as.subsegmentStartsWithSAP}"`)
  }
  if (as.width) attrs.push(`width="${as.width}"`)
  if (as.height) attrs.push(`height="${as.height}"`)
  if (as.frameRate) attrs.push(`frameRate="${as.frameRate}"`)
  if (as.par) attrs.push(`par="${as.par}"`)
  if (as.maxWidth) attrs.push(`maxWidth="${as.maxWidth}"`)
  if (as.maxHeight) attrs.push(`maxHeight="${as.maxHeight}"`)

  let xml = `${spaces}<AdaptationSet${attrs.length ? ' ' + attrs.join(' ') : ''}>\n`

  // Content protection
  if (as.contentProtection) {
    for (const cp of as.contentProtection) {
      xml += generateContentProtection(cp, indent + 1)
    }
  }

  // Role
  if (as.role) {
    xml += `${spaces}  <Role schemeIdUri="${as.role.schemeIdUri}" value="${as.role.value}"/>\n`
  }

  // Accessibility
  if (as.accessibility) {
    xml += `${spaces}  <Accessibility schemeIdUri="${as.accessibility.schemeIdUri}" value="${as.accessibility.value}"/>\n`
  }

  // Segment template (shared)
  if (as.segmentTemplate) {
    xml += generateSegmentTemplate(as.segmentTemplate, indent + 1)
  }

  // Representations
  for (const rep of as.representations) {
    xml += generateRepresentation(rep, indent + 1)
  }

  xml += `${spaces}</AdaptationSet>\n`

  return xml
}

function generateContentProtection(cp: DashContentProtection, indent: number): string {
  const spaces = '  '.repeat(indent)
  const attrs: string[] = [`schemeIdUri="${cp.schemeIdUri}"`]

  if (cp.value) attrs.push(`value="${cp.value}"`)
  if (cp.defaultKID) {
    attrs.push(`cenc:default_KID="${cp.defaultKID}"`)
  }

  if (cp.pssh || cp.customElements) {
    let xml = `${spaces}<ContentProtection ${attrs.join(' ')}>\n`
    if (cp.pssh) {
      xml += `${spaces}  <cenc:pssh>${cp.pssh}</cenc:pssh>\n`
    }
    if (cp.customElements) {
      xml += cp.customElements
    }
    xml += `${spaces}</ContentProtection>\n`
    return xml
  }

  return `${spaces}<ContentProtection ${attrs.join(' ')}/>\n`
}

function generateSegmentTemplate(st: DashSegmentTemplate, indent: number): string {
  const spaces = '  '.repeat(indent)
  const attrs: string[] = [`timescale="${st.timescale}"`]

  attrs.push(`media="${st.media}"`)
  if (st.initialization) attrs.push(`initialization="${st.initialization}"`)
  if (st.startNumber !== undefined) attrs.push(`startNumber="${st.startNumber}"`)
  if (st.duration) attrs.push(`duration="${st.duration}"`)
  if (st.presentationTimeOffset) {
    attrs.push(`presentationTimeOffset="${st.presentationTimeOffset}"`)
  }

  if (st.segmentTimeline && st.segmentTimeline.length > 0) {
    let xml = `${spaces}<SegmentTemplate ${attrs.join(' ')}>\n`
    xml += `${spaces}  <SegmentTimeline>\n`

    for (const seg of st.segmentTimeline) {
      const segAttrs: string[] = []
      if (seg.startTime !== undefined) segAttrs.push(`t="${seg.startTime}"`)
      segAttrs.push(`d="${seg.duration}"`)
      if (seg.repeatCount) segAttrs.push(`r="${seg.repeatCount}"`)
      xml += `${spaces}    <S ${segAttrs.join(' ')}/>\n`
    }

    xml += `${spaces}  </SegmentTimeline>\n`
    xml += `${spaces}</SegmentTemplate>\n`
    return xml
  }

  return `${spaces}<SegmentTemplate ${attrs.join(' ')}/>\n`
}

function generateRepresentation(rep: DashRepresentation, indent: number): string {
  const spaces = '  '.repeat(indent)
  const attrs: string[] = [`id="${rep.id}"`, `bandwidth="${rep.bandwidth}"`]

  if (rep.codecs) attrs.push(`codecs="${rep.codecs}"`)
  if (rep.mimeType) attrs.push(`mimeType="${rep.mimeType}"`)
  if (rep.width) attrs.push(`width="${rep.width}"`)
  if (rep.height) attrs.push(`height="${rep.height}"`)
  if (rep.frameRate) attrs.push(`frameRate="${rep.frameRate}"`)
  if (rep.audioSamplingRate) attrs.push(`audioSamplingRate="${rep.audioSamplingRate}"`)

  const hasChildren = rep.baseURL || rep.segmentTemplate || rep.segmentList || rep.segmentBase ||
    rep.audioChannels

  if (!hasChildren) {
    return `${spaces}<Representation ${attrs.join(' ')}/>\n`
  }

  let xml = `${spaces}<Representation ${attrs.join(' ')}>\n`

  if (rep.audioChannels) {
    xml += `${spaces}  <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${rep.audioChannels}"/>\n`
  }

  if (rep.baseURL) {
    xml += `${spaces}  <BaseURL>${escapeXml(rep.baseURL)}</BaseURL>\n`
  }

  if (rep.segmentTemplate) {
    xml += generateSegmentTemplate(rep.segmentTemplate, indent + 1)
  }

  if (rep.segmentList) {
    xml += generateSegmentList(rep.segmentList, indent + 1)
  }

  if (rep.segmentBase) {
    xml += generateSegmentBase(rep.segmentBase, indent + 1)
  }

  xml += `${spaces}</Representation>\n`

  return xml
}

function generateSegmentList(sl: DashSegmentList, indent: number): string {
  const spaces = '  '.repeat(indent)

  let xml = `${spaces}<SegmentList timescale="${sl.timescale}" duration="${sl.duration}">\n`

  if (sl.initialization) {
    const attrs = [`sourceURL="${sl.initialization.sourceURL}"`]
    if (sl.initialization.range) attrs.push(`range="${sl.initialization.range}"`)
    xml += `${spaces}  <Initialization ${attrs.join(' ')}/>\n`
  }

  for (const seg of sl.segmentURLs) {
    const attrs = [`media="${seg.media}"`]
    if (seg.mediaRange) attrs.push(`mediaRange="${seg.mediaRange}"`)
    xml += `${spaces}  <SegmentURL ${attrs.join(' ')}/>\n`
  }

  xml += `${spaces}</SegmentList>\n`

  return xml
}

function generateSegmentBase(sb: DashSegmentBase, indent: number): string {
  const spaces = '  '.repeat(indent)
  const attrs: string[] = []

  if (sb.timescale) attrs.push(`timescale="${sb.timescale}"`)
  if (sb.presentationTimeOffset) attrs.push(`presentationTimeOffset="${sb.presentationTimeOffset}"`)
  if (sb.indexRange) attrs.push(`indexRange="${sb.indexRange}"`)

  if (sb.initialization) {
    let xml = `${spaces}<SegmentBase ${attrs.join(' ')}>\n`
    xml += `${spaces}  <Initialization range="${sb.initialization.range}"/>\n`
    xml += `${spaces}</SegmentBase>\n`
    return xml
  }

  return `${spaces}<SegmentBase ${attrs.join(' ')}/>\n`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert seconds to ISO 8601 duration
 */
export function secondsToIsoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  let duration = 'PT'
  if (hours > 0) duration += `${hours}H`
  if (minutes > 0) duration += `${minutes}M`
  if (secs > 0 || duration === 'PT') {
    duration += `${secs.toFixed(3).replace(/\.?0+$/, '')}S`
  }

  return duration
}

/**
 * Parse ISO 8601 duration to seconds
 */
export function isoDurationToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/)
  if (!match) return 0

  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseFloat(match[3] || '0')

  return hours * 3600 + minutes * 60 + seconds
}

/**
 * DASH MPD builder
 */
export class DashMpdBuilder {
  private periods: DashPeriod[] = []
  private options: DashMpdOptions = {}
  private currentPeriod: DashPeriod | null = null
  private currentAdaptationSet: DashAdaptationSet | null = null

  /**
   * Set MPD type
   */
  setType(type: 'static' | 'dynamic'): this {
    this.options.type = type
    return this
  }

  /**
   * Set profile
   */
  setProfile(profile: DashProfile): this {
    this.options.profiles = profile
    return this
  }

  /**
   * Set duration
   */
  setDuration(seconds: number): this {
    this.options.mediaPresentationDuration = secondsToIsoDuration(seconds)
    return this
  }

  /**
   * Set minimum buffer time
   */
  setMinBufferTime(seconds: number): this {
    this.options.minBufferTime = secondsToIsoDuration(seconds)
    return this
  }

  /**
   * Set base URL
   */
  setBaseURL(url: string): this {
    this.options.baseURL = url
    return this
  }

  /**
   * Add a period
   */
  addPeriod(id?: string): this {
    this.currentPeriod = {
      id,
      adaptationSets: [],
    }
    this.periods.push(this.currentPeriod)
    this.currentAdaptationSet = null
    return this
  }

  /**
   * Add video adaptation set
   */
  addVideoAdaptationSet(options: Partial<DashAdaptationSet> = {}): this {
    if (!this.currentPeriod) {
      this.addPeriod()
    }

    this.currentAdaptationSet = {
      contentType: 'video',
      mimeType: 'video/mp4',
      segmentAlignment: true,
      ...options,
      representations: [],
    }
    this.currentPeriod!.adaptationSets.push(this.currentAdaptationSet)
    return this
  }

  /**
   * Add audio adaptation set
   */
  addAudioAdaptationSet(options: Partial<DashAdaptationSet> = {}): this {
    if (!this.currentPeriod) {
      this.addPeriod()
    }

    this.currentAdaptationSet = {
      contentType: 'audio',
      mimeType: 'audio/mp4',
      segmentAlignment: true,
      ...options,
      representations: [],
    }
    this.currentPeriod!.adaptationSets.push(this.currentAdaptationSet)
    return this
  }

  /**
   * Add subtitle adaptation set
   */
  addSubtitleAdaptationSet(options: Partial<DashAdaptationSet> = {}): this {
    if (!this.currentPeriod) {
      this.addPeriod()
    }

    this.currentAdaptationSet = {
      contentType: 'text',
      mimeType: 'application/mp4',
      ...options,
      representations: [],
    }
    this.currentPeriod!.adaptationSets.push(this.currentAdaptationSet)
    return this
  }

  /**
   * Add representation to current adaptation set
   */
  addRepresentation(rep: DashRepresentation): this {
    if (!this.currentAdaptationSet) {
      throw new Error('No adaptation set active')
    }
    this.currentAdaptationSet.representations.push(rep)
    return this
  }

  /**
   * Set segment template for current adaptation set
   */
  setSegmentTemplate(template: DashSegmentTemplate): this {
    if (!this.currentAdaptationSet) {
      throw new Error('No adaptation set active')
    }
    this.currentAdaptationSet.segmentTemplate = template
    return this
  }

  /**
   * Add content protection to current adaptation set
   */
  addContentProtection(cp: DashContentProtection): this {
    if (!this.currentAdaptationSet) {
      throw new Error('No adaptation set active')
    }
    if (!this.currentAdaptationSet.contentProtection) {
      this.currentAdaptationSet.contentProtection = []
    }
    this.currentAdaptationSet.contentProtection.push(cp)
    return this
  }

  /**
   * Build MPD
   */
  build(): string {
    return generateMpd(this.periods, this.options)
  }
}

/**
 * Common DRM system IDs
 */
export const DRM_SYSTEM_IDS = {
  WIDEVINE: 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
  PLAYREADY: 'urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95',
  FAIRPLAY: 'urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2',
  CLEARKEY: 'urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e',
  CENC: 'urn:mpeg:dash:mp4protection:2011',
}
