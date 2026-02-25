/**
 * Source abstractions for reading media from various backends
 * Supports buffers, files, URLs, and streams
 */

import type { Source } from './reader'
import { FileSlice } from './reader'

export class BufferSource implements Source {
  private readonly buffer: Uint8Array

  constructor(buffer: Uint8Array | ArrayBuffer) {
    this.buffer = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  }

  async getSize(): Promise<number> {
    return this.buffer.byteLength
  }

  async readSlice(offset: number, length: number): Promise<FileSlice | null> {
    if (offset < 0 || offset >= this.buffer.byteLength) {
      return null
    }

    const actualLength = Math.min(length, this.buffer.byteLength - offset)
    const bytes = this.buffer.subarray(offset, offset + actualLength)
    return new FileSlice(bytes, offset)
  }
}

export class BlobSource implements Source {
  private readonly blob: Blob
  private cachedSize: number | null = null

  constructor(blob: Blob) {
    this.blob = blob
  }

  async getSize(): Promise<number> {
    if (this.cachedSize === null) {
      this.cachedSize = this.blob.size
    }
    return this.cachedSize
  }

  async readSlice(offset: number, length: number): Promise<FileSlice | null> {
    const size = await this.getSize()
    if (offset < 0 || offset >= size) {
      return null
    }

    const actualLength = Math.min(length, size - offset)
    const slice = this.blob.slice(offset, offset + actualLength)
    const buffer = await slice.arrayBuffer()
    return new FileSlice(new Uint8Array(buffer), offset)
  }
}

export class FileSource implements Source {
  private readonly filePath: string
  private fileHandle: FileHandle | null = null
  private cachedSize: number | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private async ensureOpen(): Promise<FileHandle> {
    if (!this.fileHandle) {
      const fs = await import('node:fs/promises')
      this.fileHandle = await fs.open(this.filePath, 'r')
    }
    return this.fileHandle
  }

  async getSize(): Promise<number | null> {
    if (this.cachedSize === null) {
      try {
        const handle = await this.ensureOpen()
        const stat = await handle.stat()
        this.cachedSize = stat.size
      }
      catch {
        return null
      }
    }
    return this.cachedSize
  }

  async readSlice(offset: number, length: number): Promise<FileSlice | null> {
    try {
      const handle = await this.ensureOpen()
      const buffer = new Uint8Array(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)

      if (bytesRead === 0) {
        return null
      }

      return new FileSlice(buffer.subarray(0, bytesRead), offset)
    }
    catch {
      return null
    }
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close()
      this.fileHandle = null
    }
  }
}

interface FileHandle {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  stat(): Promise<{ size: number }>
  close(): Promise<void>
}

export class UrlSource implements Source {
  private readonly url: string
  private cachedSize: number | null = null
  private supportsRangeRequests = true
  private cache: Map<string, { data: Uint8Array, timestamp: number }> = new Map()
  private readonly cacheMaxAge = 60000

  constructor(url: string) {
    this.url = url
  }

  async getSize(): Promise<number | null> {
    if (this.cachedSize !== null) {
      return this.cachedSize
    }

    try {
      const response = await fetch(this.url, { method: 'HEAD' })
      const contentLength = response.headers.get('content-length')
      const acceptRanges = response.headers.get('accept-ranges')

      if (contentLength) {
        this.cachedSize = Number.parseInt(contentLength, 10)
      }

      this.supportsRangeRequests = acceptRanges === 'bytes'

      return this.cachedSize
    }
    catch {
      return null
    }
  }

  async readSlice(offset: number, length: number): Promise<FileSlice | null> {
    const cacheKey = `${offset}:${length}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return new FileSlice(cached.data, offset)
    }

    try {
      const headers: Record<string, string> = {}

      if (this.supportsRangeRequests) {
        headers['Range'] = `bytes=${offset}-${offset + length - 1}`
      }

      const response = await fetch(this.url, { headers })

      if (!response.ok && response.status !== 206) {
        return null
      }

      const buffer = await response.arrayBuffer()
      let data: Uint8Array

      if (this.supportsRangeRequests) {
        data = new Uint8Array(buffer)
      }
      else {
        data = new Uint8Array(buffer).subarray(offset, offset + length)
      }

      this.cache.set(cacheKey, { data, timestamp: Date.now() })

      for (const [key, value] of this.cache.entries()) {
        if (Date.now() - value.timestamp > this.cacheMaxAge) {
          this.cache.delete(key)
        }
      }

      return new FileSlice(data, offset)
    }
    catch {
      return null
    }
  }
}

export class StreamSource implements Source {
  private readonly stream: ReadableStream<Uint8Array>
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private buffer: Uint8Array[] = []
  private totalBytesRead = 0
  private done = false

  constructor(stream: ReadableStream<Uint8Array>) {
    this.stream = stream
  }

  async getSize(): Promise<number | null> {
    return null
  }

  private async readUntil(targetOffset: number): Promise<void> {
    if (this.done) return

    if (!this.reader) {
      this.reader = this.stream.getReader() as ReadableStreamDefaultReader<Uint8Array>
    }

    while (this.totalBytesRead < targetOffset && !this.done) {
      const { value, done } = await this.reader!.read()
      if (done) {
        this.done = true
        break
      }
      if (value) {
        this.buffer.push(value)
        this.totalBytesRead += value.byteLength
      }
    }
  }

  async readSlice(offset: number, length: number): Promise<FileSlice | null> {
    await this.readUntil(offset + length)

    if (offset >= this.totalBytesRead) {
      return null
    }

    const result = new Uint8Array(Math.min(length, this.totalBytesRead - offset))
    let resultOffset = 0
    let currentOffset = 0

    for (const chunk of this.buffer) {
      const chunkEnd = currentOffset + chunk.byteLength

      if (chunkEnd > offset && currentOffset < offset + length) {
        const copyStart = Math.max(0, offset - currentOffset)
        const copyEnd = Math.min(chunk.byteLength, offset + length - currentOffset)
        const toCopy = chunk.subarray(copyStart, copyEnd)

        result.set(toCopy, resultOffset)
        resultOffset += toCopy.byteLength
      }

      currentOffset = chunkEnd

      if (currentOffset >= offset + length) break
    }

    return new FileSlice(result.subarray(0, resultOffset), offset)
  }

  async close(): Promise<void> {
    if (this.reader) {
      await this.reader.cancel()
      this.reader = null
    }
  }
}

export function createSource(input: Uint8Array | ArrayBuffer | Blob | string | ReadableStream<Uint8Array>): Source {
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    return new BufferSource(input)
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new BlobSource(input)
  }

  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return new UrlSource(input)
    }
    return new FileSource(input)
  }

  if (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream) {
    return new StreamSource(input)
  }

  throw new Error('Unsupported input type')
}
