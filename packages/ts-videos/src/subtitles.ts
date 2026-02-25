/**
 * Subtitle support for reading and writing various subtitle formats
 * Supports SRT, VTT, ASS/SSA, TTML, and embedded subtitles
 */

// ============================================================================
// Types
// ============================================================================

/** Supported subtitle formats */
export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa' | 'ttml' | 'sbv' | 'sub'

/** A single subtitle cue */
export interface SubtitleCue {
  /** Unique identifier for the cue */
  id?: string
  /** Start time in milliseconds */
  startTime: number
  /** End time in milliseconds */
  endTime: number
  /** Text content (may include formatting) */
  text: string
  /** Speaker/voice identifier */
  voice?: string
  /** Positioning settings */
  position?: SubtitlePosition
  /** Style settings */
  style?: SubtitleStyle
  /** Alignment */
  align?: 'start' | 'center' | 'end' | 'left' | 'right'
  /** Vertical alignment */
  vertical?: 'rl' | 'lr'
  /** Line position */
  line?: number | 'auto'
}

/** Subtitle positioning */
export interface SubtitlePosition {
  /** X position (percentage or pixels) */
  x?: number
  /** Y position (percentage or pixels) */
  y?: number
  /** Width (percentage) */
  width?: number
  /** Anchor point */
  anchor?: 'start' | 'middle' | 'end'
}

/** Subtitle styling */
export interface SubtitleStyle {
  fontFamily?: string
  fontSize?: number | string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  color?: string
  backgroundColor?: string
  textShadow?: string
  textDecoration?: 'none' | 'underline' | 'line-through'
  opacity?: number
}

/** Complete subtitle track */
export interface SubtitleTrack {
  /** Track format */
  format: SubtitleFormat
  /** Language code (BCP 47) */
  language?: string
  /** Track title/label */
  title?: string
  /** Whether this is the default track */
  default?: boolean
  /** List of cues */
  cues: SubtitleCue[]
  /** Header metadata (for ASS/SSA) */
  header?: Record<string, string>
  /** Style definitions (for ASS/SSA) */
  styles?: AssStyle[]
}

/** ASS/SSA style definition */
export interface AssStyle {
  name: string
  fontName: string
  fontSize: number
  primaryColor: string
  secondaryColor: string
  outlineColor: string
  backColor: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikeOut: boolean
  scaleX: number
  scaleY: number
  spacing: number
  angle: number
  borderStyle: number
  outline: number
  shadow: number
  alignment: number
  marginL: number
  marginR: number
  marginV: number
  encoding: number
}

// ============================================================================
// Format Detection
// ============================================================================

/** Detect subtitle format from content */
export function detectSubtitleFormat(content: string): SubtitleFormat | null {
  const trimmed = content.trim()

  // VTT starts with WEBVTT
  if (trimmed.startsWith('WEBVTT')) {
    return 'vtt'
  }

  // ASS/SSA has [Script Info] section
  if (trimmed.includes('[Script Info]')) {
    return trimmed.includes('ScriptType: v4.00+') ? 'ass' : 'ssa'
  }

  // TTML is XML-based
  if (trimmed.startsWith('<?xml') && trimmed.includes('<tt')) {
    return 'ttml'
  }

  // SBV uses numeric timestamps without hours
  if (/^\d{1,2}:\d{2}\.\d{3},\d{1,2}:\d{2}\.\d{3}$/m.test(trimmed)) {
    return 'sbv'
  }

  // SRT has numbered entries with --> arrows
  if (/^\d+\s*[\r\n]+\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/m.test(trimmed)) {
    return 'srt'
  }

  // MicroDVD SUB format
  if (/^\{\d+\}\{\d+\}/.test(trimmed)) {
    return 'sub'
  }

  return null
}

// ============================================================================
// SRT Parser/Generator
// ============================================================================

/** Parse SRT subtitle file */
export function parseSrt(content: string): SubtitleTrack {
  const cues: SubtitleCue[] = []
  const blocks = content.trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // First line is the index (optional)
    let lineIndex = 0
    let id: string | undefined

    if (/^\d+$/.test(lines[0].trim())) {
      id = lines[0].trim()
      lineIndex = 1
    }

    // Timestamp line
    const timestampLine = lines[lineIndex]
    const timestampMatch = timestampLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    )
    if (!timestampMatch) continue

    const startTime =
      parseInt(timestampMatch[1]) * 3600000 +
      parseInt(timestampMatch[2]) * 60000 +
      parseInt(timestampMatch[3]) * 1000 +
      parseInt(timestampMatch[4])

    const endTime =
      parseInt(timestampMatch[5]) * 3600000 +
      parseInt(timestampMatch[6]) * 60000 +
      parseInt(timestampMatch[7]) * 1000 +
      parseInt(timestampMatch[8])

    // Text lines
    const text = lines.slice(lineIndex + 1).join('\n')

    cues.push({
      id,
      startTime,
      endTime,
      text,
    })
  }

  return { format: 'srt', cues }
}

/** Generate SRT subtitle file */
export function generateSrt(track: SubtitleTrack): string {
  const lines: string[] = []

  for (let i = 0; i < track.cues.length; i++) {
    const cue = track.cues[i]

    // Index
    lines.push(String(i + 1))

    // Timestamps
    const startStr = formatSrtTime(cue.startTime)
    const endStr = formatSrtTime(cue.endTime)
    lines.push(`${startStr} --> ${endStr}`)

    // Text
    lines.push(cue.text)

    // Blank line between cues
    lines.push('')
  }

  return lines.join('\n')
}

function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`
}

// ============================================================================
// VTT Parser/Generator
// ============================================================================

/** Parse WebVTT subtitle file */
export function parseVtt(content: string): SubtitleTrack {
  const cues: SubtitleCue[] = []
  const lines = content.split('\n')

  if (!lines[0].trim().startsWith('WEBVTT')) {
    throw new Error('Invalid WebVTT file: missing WEBVTT header')
  }

  let i = 1
  // Skip header lines until blank line
  while (i < lines.length && lines[i].trim() !== '') {
    i++
  }

  // Parse cues
  while (i < lines.length) {
    // Skip blank lines
    while (i < lines.length && lines[i].trim() === '') {
      i++
    }
    if (i >= lines.length) break

    // Check for NOTE or STYLE blocks
    if (lines[i].trim().startsWith('NOTE')) {
      while (i < lines.length && lines[i].trim() !== '') i++
      continue
    }
    if (lines[i].trim().startsWith('STYLE')) {
      while (i < lines.length && lines[i].trim() !== '') i++
      continue
    }

    // Parse cue
    let id: string | undefined

    // Check if first line is cue ID
    if (!lines[i].includes('-->')) {
      id = lines[i].trim()
      i++
    }

    if (i >= lines.length || !lines[i].includes('-->')) continue

    // Parse timestamp line
    const timestampLine = lines[i]
    const parts = timestampLine.split('-->')
    if (parts.length !== 2) {
      i++
      continue
    }

    const startTime = parseVttTime(parts[0].trim())
    const endParts = parts[1].trim().split(/\s+/)
    const endTime = parseVttTime(endParts[0])

    // Parse settings
    const settings = endParts.slice(1).join(' ')
    const position = parseVttSettings(settings)

    i++

    // Collect text lines
    const textLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i])
      i++
    }

    cues.push({
      id,
      startTime,
      endTime,
      text: textLines.join('\n'),
      position,
    })
  }

  return { format: 'vtt', cues }
}

function parseVttTime(timeStr: string): number {
  const parts = timeStr.split(':')
  let hours = 0
  let minutes = 0
  let seconds = 0

  if (parts.length === 3) {
    hours = parseInt(parts[0])
    minutes = parseInt(parts[1])
    seconds = parseFloat(parts[2])
  }
  else if (parts.length === 2) {
    minutes = parseInt(parts[0])
    seconds = parseFloat(parts[1])
  }

  return hours * 3600000 + minutes * 60000 + Math.round(seconds * 1000)
}

function parseVttSettings(settings: string): SubtitlePosition | undefined {
  if (!settings) return undefined

  const position: SubtitlePosition = {}
  const parts = settings.split(/\s+/)

  for (const part of parts) {
    const [key, value] = part.split(':')
    if (!value) continue

    switch (key) {
      case 'position':
        position.x = parseFloat(value)
        break
      case 'line':
        position.y = parseFloat(value)
        break
      case 'size':
        position.width = parseFloat(value)
        break
      case 'align':
        position.anchor = value as 'start' | 'middle' | 'end'
        break
    }
  }

  return Object.keys(position).length > 0 ? position : undefined
}

/** Generate WebVTT subtitle file */
export function generateVtt(track: SubtitleTrack): string {
  const lines: string[] = ['WEBVTT', '']

  for (const cue of track.cues) {
    // Optional cue ID
    if (cue.id) {
      lines.push(cue.id)
    }

    // Timestamps
    const startStr = formatVttTime(cue.startTime)
    const endStr = formatVttTime(cue.endTime)
    let timestampLine = `${startStr} --> ${endStr}`

    // Settings
    const settings: string[] = []
    if (cue.position?.x !== undefined) settings.push(`position:${cue.position.x}%`)
    if (cue.position?.y !== undefined) settings.push(`line:${cue.position.y}%`)
    if (cue.position?.width !== undefined) settings.push(`size:${cue.position.width}%`)
    if (cue.align) settings.push(`align:${cue.align}`)

    if (settings.length > 0) {
      timestampLine += ' ' + settings.join(' ')
    }

    lines.push(timestampLine)
    lines.push(cue.text)
    lines.push('')
  }

  return lines.join('\n')
}

function formatVttTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

// ============================================================================
// ASS/SSA Parser/Generator
// ============================================================================

/** Parse ASS/SSA subtitle file */
export function parseAss(content: string): SubtitleTrack {
  const cues: SubtitleCue[] = []
  const header: Record<string, string> = {}
  const styles: AssStyle[] = []

  const lines = content.split('\n')
  let section = ''

  let styleFormat: string[] = []
  let eventFormat: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Section headers
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).toLowerCase()
      continue
    }

    if (section === 'script info') {
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim()
        const value = trimmed.slice(colonIndex + 1).trim()
        header[key] = value
      }
    }
    else if (section === 'v4+ styles' || section === 'v4 styles') {
      if (trimmed.startsWith('Format:')) {
        styleFormat = trimmed.slice(7).split(',').map((s) => s.trim().toLowerCase())
      }
      else if (trimmed.startsWith('Style:')) {
        const values = parseAssCsv(trimmed.slice(6))
        const style = parseAssStyle(styleFormat, values)
        if (style) styles.push(style)
      }
    }
    else if (section === 'events') {
      if (trimmed.startsWith('Format:')) {
        eventFormat = trimmed.slice(7).split(',').map((s) => s.trim().toLowerCase())
      }
      else if (trimmed.startsWith('Dialogue:')) {
        const values = parseAssCsv(trimmed.slice(9))
        const cue = parseAssDialogue(eventFormat, values)
        if (cue) cues.push(cue)
      }
    }
  }

  const format = header.ScriptType === 'v4.00+' ? 'ass' : 'ssa'
  return { format, cues, header, styles }
}

function parseAssCsv(line: string): string[] {
  const values: string[] = []
  let current = ''
  let depth = 0

  for (const char of line) {
    if (char === '(' || char === '{') depth++
    else if (char === ')' || char === '}') depth--

    if (char === ',' && depth === 0) {
      values.push(current.trim())
      current = ''
    }
    else {
      current += char
    }
  }

  if (current) values.push(current.trim())
  return values
}

function parseAssStyle(format: string[], values: string[]): AssStyle | null {
  const style: Partial<AssStyle> = {}

  for (let i = 0; i < format.length && i < values.length; i++) {
    const key = format[i]
    const value = values[i]

    switch (key) {
      case 'name':
        style.name = value
        break
      case 'fontname':
        style.fontName = value
        break
      case 'fontsize':
        style.fontSize = parseInt(value)
        break
      case 'primarycolour':
        style.primaryColor = value
        break
      case 'secondarycolour':
        style.secondaryColor = value
        break
      case 'outlinecolour':
        style.outlineColor = value
        break
      case 'backcolour':
        style.backColor = value
        break
      case 'bold':
        style.bold = value === '-1' || value === '1'
        break
      case 'italic':
        style.italic = value === '-1' || value === '1'
        break
      case 'underline':
        style.underline = value === '-1' || value === '1'
        break
      case 'strikeout':
        style.strikeOut = value === '-1' || value === '1'
        break
      case 'scalex':
        style.scaleX = parseFloat(value)
        break
      case 'scaley':
        style.scaleY = parseFloat(value)
        break
      case 'spacing':
        style.spacing = parseFloat(value)
        break
      case 'angle':
        style.angle = parseFloat(value)
        break
      case 'borderstyle':
        style.borderStyle = parseInt(value)
        break
      case 'outline':
        style.outline = parseFloat(value)
        break
      case 'shadow':
        style.shadow = parseFloat(value)
        break
      case 'alignment':
        style.alignment = parseInt(value)
        break
      case 'marginl':
        style.marginL = parseInt(value)
        break
      case 'marginr':
        style.marginR = parseInt(value)
        break
      case 'marginv':
        style.marginV = parseInt(value)
        break
      case 'encoding':
        style.encoding = parseInt(value)
        break
    }
  }

  if (!style.name) return null
  return style as AssStyle
}

function parseAssDialogue(format: string[], values: string[]): SubtitleCue | null {
  let startTime = 0
  let endTime = 0
  let text = ''
  let style: string | undefined

  for (let i = 0; i < format.length && i < values.length; i++) {
    const key = format[i]
    const value = values[i]

    switch (key) {
      case 'start':
        startTime = parseAssTime(value)
        break
      case 'end':
        endTime = parseAssTime(value)
        break
      case 'text':
        // Text is always the last field and may contain commas
        text = values.slice(i).join(',')
        break
      case 'style':
        style = value
        break
    }

    if (key === 'text') break
  }

  if (!text) return null

  // Convert ASS formatting to plain text (basic conversion)
  const plainText = text
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/\{[^}]*\}/g, '') // Remove override tags

  return {
    startTime,
    endTime,
    text: plainText,
    voice: style,
  }
}

function parseAssTime(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/)
  if (!match) return 0

  return (
    parseInt(match[1]) * 3600000 +
    parseInt(match[2]) * 60000 +
    parseInt(match[3]) * 1000 +
    parseInt(match[4]) * 10
  )
}

/** Generate ASS subtitle file */
export function generateAss(track: SubtitleTrack): string {
  const lines: string[] = []

  // Script Info
  lines.push('[Script Info]')
  lines.push('ScriptType: v4.00+')
  lines.push('Collisions: Normal')
  lines.push('PlayDepth: 0')
  if (track.header) {
    for (const [key, value] of Object.entries(track.header)) {
      if (!['ScriptType', 'Collisions', 'PlayDepth'].includes(key)) {
        lines.push(`${key}: ${value}`)
      }
    }
  }
  lines.push('')

  // Styles
  lines.push('[V4+ Styles]')
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding')

  if (track.styles && track.styles.length > 0) {
    for (const style of track.styles) {
      lines.push(`Style: ${style.name},${style.fontName},${style.fontSize},${style.primaryColor},${style.secondaryColor},${style.outlineColor},${style.backColor},${style.bold ? -1 : 0},${style.italic ? -1 : 0},${style.underline ? -1 : 0},${style.strikeOut ? -1 : 0},${style.scaleX},${style.scaleY},${style.spacing},${style.angle},${style.borderStyle},${style.outline},${style.shadow},${style.alignment},${style.marginL},${style.marginR},${style.marginV},${style.encoding}`)
    }
  }
  else {
    // Default style
    lines.push('Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1')
  }
  lines.push('')

  // Events
  lines.push('[Events]')
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')

  for (const cue of track.cues) {
    const startStr = formatAssTime(cue.startTime)
    const endStr = formatAssTime(cue.endTime)
    const style = cue.voice || 'Default'
    const text = cue.text.replace(/\n/g, '\\N')

    lines.push(`Dialogue: 0,${startStr},${endStr},${style},,0,0,0,,${text}`)
  }

  return lines.join('\n')
}

function formatAssTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const centis = Math.floor((ms % 1000) / 10)

  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`
}

// ============================================================================
// TTML Parser/Generator
// ============================================================================

/** Parse TTML (Timed Text Markup Language) subtitle file */
export function parseTtml(content: string): SubtitleTrack {
  const cues: SubtitleCue[] = []

  // Basic XML parsing for TTML
  const pRegex = /<p[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi
  let match

  while ((match = pRegex.exec(content)) !== null) {
    const beginStr = match[1]
    const endStr = match[2]
    let text = match[3]

    // Convert TTML time to milliseconds
    const startTime = parseTtmlTime(beginStr)
    const endTime = parseTtmlTime(endStr)

    // Strip XML tags from text
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim()

    if (text) {
      cues.push({ startTime, endTime, text })
    }
  }

  return { format: 'ttml', cues }
}

function parseTtmlTime(timeStr: string): number {
  // Handle different TTML time formats
  // HH:MM:SS.mmm or HH:MM:SS:frames or offset (e.g., "10s", "100ms")

  // Offset format
  if (/^\d+(?:\.\d+)?s$/.test(timeStr)) {
    return Math.round(parseFloat(timeStr) * 1000)
  }
  if (/^\d+ms$/.test(timeStr)) {
    return parseInt(timeStr)
  }

  // Clock time format
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})(?:[.:](\d+))?/)
  if (match) {
    const hours = parseInt(match[1])
    const minutes = parseInt(match[2])
    const seconds = parseInt(match[3])
    let millis = 0

    if (match[4]) {
      const frac = match[4]
      if (frac.length <= 3) {
        millis = parseInt(frac.padEnd(3, '0'))
      }
      else {
        // Frames - assume 30fps
        millis = Math.round((parseInt(frac) / 30) * 1000)
      }
    }

    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis
  }

  return 0
}

/** Generate TTML subtitle file */
export function generateTtml(track: SubtitleTrack, _options: { frameRate?: number } = {}): string {
  const lines: string[] = []

  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">')
  lines.push('  <head>')
  lines.push('    <styling>')
  lines.push('      <style xml:id="default" tts:fontFamily="Arial" tts:fontSize="100%" tts:textAlign="center"/>')
  lines.push('    </styling>')
  lines.push('  </head>')
  lines.push('  <body>')
  lines.push('    <div>')

  for (const cue of track.cues) {
    const startStr = formatTtmlTime(cue.startTime)
    const endStr = formatTtmlTime(cue.endTime)
    const text = cue.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br/>')

    lines.push(`      <p begin="${startStr}" end="${endStr}">${text}</p>`)
  }

  lines.push('    </div>')
  lines.push('  </body>')
  lines.push('</tt>')

  return lines.join('\n')
}

function formatTtmlTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

// ============================================================================
// High-Level Functions
// ============================================================================

/** Parse subtitles from string content */
export function parseSubtitles(content: string, format?: SubtitleFormat): SubtitleTrack {
  const detectedFormat = format ?? detectSubtitleFormat(content)

  if (!detectedFormat) {
    throw new Error('Could not detect subtitle format')
  }

  switch (detectedFormat) {
    case 'srt':
      return parseSrt(content)
    case 'vtt':
      return parseVtt(content)
    case 'ass':
    case 'ssa':
      return parseAss(content)
    case 'ttml':
      return parseTtml(content)
    default:
      throw new Error(`Unsupported subtitle format: ${detectedFormat}`)
  }
}

/** Generate subtitles to string */
export function generateSubtitles(track: SubtitleTrack, format?: SubtitleFormat): string {
  const outputFormat = format ?? track.format

  switch (outputFormat) {
    case 'srt':
      return generateSrt(track)
    case 'vtt':
      return generateVtt(track)
    case 'ass':
    case 'ssa':
      return generateAss(track)
    case 'ttml':
      return generateTtml(track)
    default:
      throw new Error(`Unsupported subtitle format: ${outputFormat}`)
  }
}

/** Convert subtitles between formats */
export function convertSubtitles(content: string, targetFormat: SubtitleFormat): string {
  const track = parseSubtitles(content)
  return generateSubtitles(track, targetFormat)
}

// ============================================================================
// Subtitle Manipulation
// ============================================================================

/** Shift all cue times by an offset */
export function shiftSubtitles(track: SubtitleTrack, offsetMs: number): SubtitleTrack {
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      startTime: Math.max(0, cue.startTime + offsetMs),
      endTime: Math.max(0, cue.endTime + offsetMs),
    })),
  }
}

/** Scale subtitle times by a factor */
export function scaleSubtitles(track: SubtitleTrack, factor: number): SubtitleTrack {
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      startTime: Math.round(cue.startTime * factor),
      endTime: Math.round(cue.endTime * factor),
    })),
  }
}

/** Merge multiple subtitle tracks */
export function mergeSubtitles(tracks: SubtitleTrack[]): SubtitleTrack {
  const allCues = tracks.flatMap((t) => t.cues)
  allCues.sort((a, b) => a.startTime - b.startTime)

  return {
    format: tracks[0]?.format ?? 'srt',
    cues: allCues,
  }
}

/** Filter cues by time range */
export function filterSubtitlesByTime(
  track: SubtitleTrack,
  startMs: number,
  endMs: number,
): SubtitleTrack {
  return {
    ...track,
    cues: track.cues.filter((cue) => cue.endTime > startMs && cue.startTime < endMs),
  }
}

/** Split long cues into shorter ones */
export function splitLongCues(track: SubtitleTrack, maxDurationMs: number): SubtitleTrack {
  const newCues: SubtitleCue[] = []

  for (const cue of track.cues) {
    const duration = cue.endTime - cue.startTime

    if (duration <= maxDurationMs) {
      newCues.push(cue)
    }
    else {
      // Split into multiple cues
      const parts = Math.ceil(duration / maxDurationMs)
      const words = cue.text.split(/\s+/)
      const wordsPerPart = Math.ceil(words.length / parts)

      for (let i = 0; i < parts; i++) {
        const partWords = words.slice(i * wordsPerPart, (i + 1) * wordsPerPart)
        if (partWords.length === 0) continue

        const partStart = cue.startTime + (duration * i) / parts
        const partEnd = cue.startTime + (duration * (i + 1)) / parts

        newCues.push({
          ...cue,
          startTime: Math.round(partStart),
          endTime: Math.round(partEnd),
          text: partWords.join(' '),
        })
      }
    }
  }

  return { ...track, cues: newCues }
}

/** Remove formatting/tags from subtitle text */
export function stripFormatting(track: SubtitleTrack): SubtitleTrack {
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      text: cue.text
        .replace(/<[^>]+>/g, '') // HTML tags
        .replace(/\{[^}]+\}/g, '') // ASS override tags
        .replace(/\\N/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\h/g, ' ')
        .trim(),
    })),
  }
}

/** Find cue at a specific time */
export function findCueAtTime(track: SubtitleTrack, timeMs: number): SubtitleCue | undefined {
  return track.cues.find((cue) => cue.startTime <= timeMs && cue.endTime >= timeMs)
}

/** Get subtitle statistics */
export function getSubtitleStats(track: SubtitleTrack): {
  cueCount: number
  totalDuration: number
  averageDuration: number
  totalCharacters: number
  averageCharactersPerSecond: number
  longestCue: SubtitleCue | null
  shortestCue: SubtitleCue | null
} {
  if (track.cues.length === 0) {
    return {
      cueCount: 0,
      totalDuration: 0,
      averageDuration: 0,
      totalCharacters: 0,
      averageCharactersPerSecond: 0,
      longestCue: null,
      shortestCue: null,
    }
  }

  let totalDuration = 0
  let totalCharacters = 0
  let longestCue = track.cues[0]
  let shortestCue = track.cues[0]

  for (const cue of track.cues) {
    const duration = cue.endTime - cue.startTime
    totalDuration += duration
    totalCharacters += cue.text.length

    if (duration > (longestCue.endTime - longestCue.startTime)) {
      longestCue = cue
    }
    if (duration < (shortestCue.endTime - shortestCue.startTime)) {
      shortestCue = cue
    }
  }

  return {
    cueCount: track.cues.length,
    totalDuration,
    averageDuration: totalDuration / track.cues.length,
    totalCharacters,
    averageCharactersPerSecond: totalDuration > 0 ? (totalCharacters / totalDuration) * 1000 : 0,
    longestCue,
    shortestCue,
  }
}
