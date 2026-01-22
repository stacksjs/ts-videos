/**
 * Target abstractions for writing media to various backends
 * Supports buffers, files, and streams
 */

import type { Target } from './writer'

export class BufferTarget implements Target {
  private chunks: { data: Uint8Array, offset: number }[] = []
  private _buffer: Uint8Array | null = null

  get buffer(): Uint8Array {
    if (!this._buffer) {
      throw new Error('Buffer not finalized yet')
    }
    return this._buffer
  }

  async write(data: Uint8Array, offset: number): Promise<void> {
    this.chunks.push({ data: new Uint8Array(data), offset })
    this._buffer = null
  }

  async finalize(): Promise<void> {
    if (this.chunks.length === 0) {
      this._buffer = new Uint8Array(0)
      return
    }

    this.chunks.sort((a, b) => a.offset - b.offset)

    const lastChunk = this.chunks[this.chunks.length - 1]
    const totalSize = lastChunk.offset + lastChunk.data.byteLength

    this._buffer = new Uint8Array(totalSize)

    for (const chunk of this.chunks) {
      this._buffer.set(chunk.data, chunk.offset)
    }

    this.chunks = []
  }

  getPartialBuffer(): Uint8Array {
    if (this.chunks.length === 0) {
      return new Uint8Array(0)
    }

    this.chunks.sort((a, b) => a.offset - b.offset)

    const lastChunk = this.chunks[this.chunks.length - 1]
    const totalSize = lastChunk.offset + lastChunk.data.byteLength

    const buffer = new Uint8Array(totalSize)

    for (const chunk of this.chunks) {
      buffer.set(chunk.data, chunk.offset)
    }

    return buffer
  }
}

export class FileTarget implements Target {
  private readonly filePath: string
  private fileHandle: FileHandle | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private async ensureOpen(): Promise<FileHandle> {
    if (!this.fileHandle) {
      const fs = await import('node:fs/promises')
      this.fileHandle = await fs.open(this.filePath, 'w')
    }
    return this.fileHandle
  }

  async write(data: Uint8Array, offset: number): Promise<void> {
    const handle = await this.ensureOpen()
    await handle.write(data, 0, data.byteLength, offset)
  }

  async finalize(): Promise<void> {
    // Nothing to do
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close()
      this.fileHandle = null
    }
  }
}

interface FileHandle {
  write(data: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>
  close(): Promise<void>
}

export class StreamTarget implements Target {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  private currentOffset = 0

  constructor(stream: WritableStream<Uint8Array>) {
    this.writer = stream.getWriter()
  }

  async write(data: Uint8Array, offset: number): Promise<void> {
    if (offset !== this.currentOffset) {
      throw new Error('StreamTarget does not support non-sequential writes')
    }
    await this.writer.write(data)
    this.currentOffset += data.byteLength
  }

  async finalize(): Promise<void> {
    await this.writer.close()
  }
}

export class NullTarget implements Target {
  private bytesWritten = 0

  get size(): number {
    return this.bytesWritten
  }

  async write(data: Uint8Array, offset: number): Promise<void> {
    this.bytesWritten = Math.max(this.bytesWritten, offset + data.byteLength)
  }

  async finalize(): Promise<void> {
    // Nothing to do
  }
}

export class CallbackTarget implements Target {
  private readonly onWrite: (data: Uint8Array, offset: number) => Promise<void> | void
  private readonly onFinalize?: () => Promise<void> | void

  constructor(options: {
    onWrite: (data: Uint8Array, offset: number) => Promise<void> | void
    onFinalize?: () => Promise<void> | void
  }) {
    this.onWrite = options.onWrite
    this.onFinalize = options.onFinalize
  }

  async write(data: Uint8Array, offset: number): Promise<void> {
    await this.onWrite(data, offset)
  }

  async finalize(): Promise<void> {
    await this.onFinalize?.()
  }
}

export function createTarget(output: string | WritableStream<Uint8Array> | 'buffer' | null): Target {
  if (output === 'buffer' || output === null) {
    return new BufferTarget()
  }

  if (typeof output === 'string') {
    return new FileTarget(output)
  }

  if (typeof WritableStream !== 'undefined' && output instanceof WritableStream) {
    return new StreamTarget(output)
  }

  throw new Error('Unsupported output type')
}
