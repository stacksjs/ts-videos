/**
 * Format registry for managing input/output formats
 */

import type { Source } from './reader'
import type { InputFormat } from './demuxer'
import type { OutputFormat } from './muxer'

export class FormatRegistry {
  private static inputFormats: InputFormat[] = []
  private static outputFormats: OutputFormat[] = []

  static registerInputFormat(format: InputFormat): void {
    if (!this.inputFormats.includes(format)) {
      this.inputFormats.push(format)
    }
  }

  static registerOutputFormat(format: OutputFormat): void {
    if (!this.outputFormats.includes(format)) {
      this.outputFormats.push(format)
    }
  }

  static getInputFormats(): InputFormat[] {
    return [...this.inputFormats]
  }

  static getOutputFormats(): OutputFormat[] {
    return [...this.outputFormats]
  }

  static async detectInputFormat(source: Source): Promise<InputFormat | null> {
    for (const format of this.inputFormats) {
      const canRead = await format.canRead(source)
      if (canRead) {
        return format
      }
    }
    return null
  }

  static getInputFormatByName(name: string): InputFormat | null {
    return this.inputFormats.find(f => f.name === name) ?? null
  }

  static getInputFormatByExtension(ext: string): InputFormat | null {
    const normalizedExt = ext.toLowerCase().replace(/^\./, '')
    return this.inputFormats.find(f => f.extensions.includes(normalizedExt)) ?? null
  }

  static getOutputFormatByName(name: string): OutputFormat | null {
    return this.outputFormats.find(f => f.name === name) ?? null
  }

  static getOutputFormatByExtension(ext: string): OutputFormat | null {
    const normalizedExt = ext.toLowerCase().replace(/^\./, '')
    return this.outputFormats.find(f => f.extension === normalizedExt) ?? null
  }

  static clear(): void {
    this.inputFormats = []
    this.outputFormats = []
  }
}

export function registerFormat(format: InputFormat | OutputFormat): void {
  if ('canRead' in format && 'createDemuxer' in format) {
    FormatRegistry.registerInputFormat(format as InputFormat)
  }
  if ('createMuxer' in format) {
    FormatRegistry.registerOutputFormat(format as OutputFormat)
  }
}

export async function detectFormat(source: Source): Promise<InputFormat | null> {
  return FormatRegistry.detectInputFormat(source)
}

export const ALL_FORMATS: InputFormat[] = []
