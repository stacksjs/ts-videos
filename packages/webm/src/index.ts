/**
 * WebM/Matroska codec package for ts-videos
 */

import type { Source, Target } from 'ts-videos'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-videos'
import { WebmDemuxer } from './demuxer'
import { WebmMuxer, type WebmMuxerOptions } from './muxer'
import { EBML_IDS, readEbmlId, readEbmlSize, readEbmlString } from './ebml'

export { WebmDemuxer } from './demuxer'
export { WebmMuxer, type WebmMuxerOptions } from './muxer'
export * from './ebml'

export class WebmInputFormat extends InputFormat {
  get name(): string {
    return 'webm'
  }

  get mimeType(): string {
    return 'video/webm'
  }

  get extensions(): string[] {
    return ['webm']
  }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0

    const bytes = await reader.readBytes(64)
    if (!bytes || bytes.length < 32) return false

    const idResult = readEbmlId(bytes, 0)
    if (!idResult || idResult.id !== EBML_IDS.EBML) return false

    const sizeResult = readEbmlSize(bytes, idResult.length)
    if (!sizeResult) return false

    let offset = idResult.length + sizeResult.length
    const endOffset = offset + sizeResult.size

    while (offset < endOffset && offset < bytes.length - 8) {
      const childId = readEbmlId(bytes, offset)
      if (!childId) break
      offset += childId.length

      const childSize = readEbmlSize(bytes, offset)
      if (!childSize) break
      offset += childSize.length

      if (childId.id === EBML_IDS.DocType) {
        const docType = readEbmlString(bytes.subarray(offset, offset + childSize.size))
        return docType === 'webm'
      }

      offset += childSize.size
    }

    return false
  }

  createDemuxer(source: Source): Demuxer {
    return new WebmDemuxer(source)
  }
}

export class MkvInputFormat extends InputFormat {
  get name(): string {
    return 'mkv'
  }

  get mimeType(): string {
    return 'video/x-matroska'
  }

  get extensions(): string[] {
    return ['mkv', 'mka', 'mk3d']
  }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0

    const bytes = await reader.readBytes(64)
    if (!bytes || bytes.length < 32) return false

    const idResult = readEbmlId(bytes, 0)
    if (!idResult || idResult.id !== EBML_IDS.EBML) return false

    const sizeResult = readEbmlSize(bytes, idResult.length)
    if (!sizeResult) return false

    let offset = idResult.length + sizeResult.length
    const endOffset = offset + sizeResult.size

    while (offset < endOffset && offset < bytes.length - 8) {
      const childId = readEbmlId(bytes, offset)
      if (!childId) break
      offset += childId.length

      const childSize = readEbmlSize(bytes, offset)
      if (!childSize) break
      offset += childSize.length

      if (childId.id === EBML_IDS.DocType) {
        const docType = readEbmlString(bytes.subarray(offset, offset + childSize.size))
        return docType === 'matroska'
      }

      offset += childSize.size
    }

    return false
  }

  createDemuxer(source: Source): Demuxer {
    return new WebmDemuxer(source)
  }
}

export class WebmOutputFormat extends OutputFormat {
  private options: WebmMuxerOptions

  constructor(options: WebmMuxerOptions = {}) {
    super()
    this.options = { ...options, isWebm: true }
  }

  get name(): string {
    return 'webm'
  }

  get mimeType(): string {
    return 'video/webm'
  }

  get extension(): string {
    return 'webm'
  }

  createMuxer(target: Target): Muxer {
    return new WebmMuxer(target, this.options)
  }
}

export class MkvOutputFormat extends OutputFormat {
  private options: WebmMuxerOptions

  constructor(options: WebmMuxerOptions = {}) {
    super()
    this.options = { ...options, isWebm: false }
  }

  get name(): string {
    return 'mkv'
  }

  get mimeType(): string {
    return 'video/x-matroska'
  }

  get extension(): string {
    return 'mkv'
  }

  createMuxer(target: Target): Muxer {
    return new WebmMuxer(target, this.options)
  }
}

export const WEBM = new WebmInputFormat()
export const MKV = new MkvInputFormat()
export const WEBM_OUTPUT = new WebmOutputFormat()
export const MKV_OUTPUT = new MkvOutputFormat()
