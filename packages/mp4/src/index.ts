/**
 * MP4/MOV (ISOBMFF) codec package for ts-videos
 */

import type { Source, Target } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-videos'
import { Mp4Demuxer } from './demuxer'
import { Mp4Muxer, type Mp4MuxerOptions } from './muxer'
import { FragmentedMp4Muxer, type FragmentedMp4Options } from './fragmented'
import { MP4_BRANDS, MOV_BRANDS, readFourCC } from './boxes'

export { Mp4Demuxer } from './demuxer'
export { Mp4Muxer, type Mp4MuxerOptions } from './muxer'
export { FragmentedMp4Muxer, type FragmentedMp4Options } from './fragmented'
export * from './boxes'

export class Mp4InputFormat extends InputFormat {
  get name(): string {
    return 'mp4'
  }

  get mimeType(): string {
    return 'video/mp4'
  }

  get extensions(): string[] {
    return ['mp4', 'm4v', 'm4a', 'f4v']
  }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0

    const size = await reader.readU32BE()
    if (size === null || size < 8) return false

    const type = await reader.readFourCC()
    if (type !== 'ftyp') return false

    const brand = await reader.readFourCC()
    if (!brand) return false

    return MP4_BRANDS.has(brand)
  }

  createDemuxer(source: Source): Demuxer {
    return new Mp4Demuxer(source)
  }
}

export class MovInputFormat extends InputFormat {
  get name(): string {
    return 'mov'
  }

  get mimeType(): string {
    return 'video/quicktime'
  }

  get extensions(): string[] {
    return ['mov', 'qt']
  }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0

    const size = await reader.readU32BE()
    if (size === null || size < 8) return false

    const type = await reader.readFourCC()
    if (type !== 'ftyp') return false

    const brand = await reader.readFourCC()
    if (!brand) return false

    return MOV_BRANDS.has(brand)
  }

  createDemuxer(source: Source): Demuxer {
    return new Mp4Demuxer(source)
  }
}

export class Mp4OutputFormat extends OutputFormat {
  private options: Mp4MuxerOptions

  constructor(options: Mp4MuxerOptions = {}) {
    super()
    this.options = options
  }

  get name(): string {
    return 'mp4'
  }

  get mimeType(): string {
    return 'video/mp4'
  }

  get extension(): string {
    return 'mp4'
  }

  createMuxer(target: Target): Muxer {
    return new Mp4Muxer(target, this.options)
  }
}

export class MovOutputFormat extends OutputFormat {
  private options: Mp4MuxerOptions

  constructor(options: Mp4MuxerOptions = {}) {
    super()
    this.options = { ...options, brand: 'qt  ' }
  }

  get name(): string {
    return 'mov'
  }

  get mimeType(): string {
    return 'video/quicktime'
  }

  get extension(): string {
    return 'mov'
  }

  createMuxer(target: Target): Muxer {
    return new Mp4Muxer(target, this.options)
  }
}

/**
 * Fragmented MP4 output format for streaming
 */
export class FragmentedMp4OutputFormat extends OutputFormat {
  private options: FragmentedMp4Options

  constructor(options: FragmentedMp4Options = {}) {
    super()
    this.options = options
  }

  get name(): string {
    return 'fmp4'
  }

  get mimeType(): string {
    return 'video/mp4'
  }

  get extension(): string {
    return 'mp4'
  }

  createMuxer(target: Target): Muxer {
    return new FragmentedMp4Muxer(target, this.options)
  }
}

/**
 * CMAF (Common Media Application Format) output format
 * Compatible with HLS and DASH streaming
 */
export class CmafOutputFormat extends OutputFormat {
  private options: FragmentedMp4Options

  constructor(options: Omit<FragmentedMp4Options, 'cmaf'> = {}) {
    super()
    this.options = { ...options, cmaf: true }
  }

  get name(): string {
    return 'cmaf'
  }

  get mimeType(): string {
    return 'video/mp4'
  }

  get extension(): string {
    return 'cmfv' // CMAF video
  }

  createMuxer(target: Target): Muxer {
    return new FragmentedMp4Muxer(target, this.options)
  }
}

export const MP4 = new Mp4InputFormat()
export const MOV = new MovInputFormat()
export const MP4_OUTPUT = new Mp4OutputFormat()
export const MOV_OUTPUT = new MovOutputFormat()
export const FMP4_OUTPUT = new FragmentedMp4OutputFormat()
export const CMAF_OUTPUT = new CmafOutputFormat()
