/**
 * Streaming enhancements for media processing
 * Provides append-only modes, chunked output, and streaming utilities
 */

import type { EncodedPacket } from './types'

/**
 * Chunk information for streaming output
 */
export interface StreamChunk {
  /** Chunk data */
  data: Uint8Array
  /** Chunk index (0-based) */
  index: number
  /** Start timestamp of chunk (seconds) */
  startTime: number
  /** End timestamp of chunk (seconds) */
  endTime: number
  /** Duration of chunk (seconds) */
  duration: number
  /** Whether this is the initialization segment */
  isInit: boolean
  /** Whether this chunk starts with a keyframe */
  startsWithKeyframe: boolean
}

/**
 * Streaming output options
 */
export interface StreamingOptions {
  /** Target chunk duration in seconds */
  chunkDuration?: number
  /** Maximum chunk size in bytes */
  maxChunkSize?: number
  /** Minimum chunk duration in seconds */
  minChunkDuration?: number
  /** Force keyframe at chunk boundaries */
  forceKeyframes?: boolean
  /** Emit initialization segment separately */
  separateInit?: boolean
  /** Low-latency mode (smaller chunks, lower delay) */
  lowLatency?: boolean
}

/**
 * Chunk writer callback
 */
export type ChunkCallback = (_chunk: StreamChunk) => void | Promise<void>

/**
 * ChunkedStreamWriter - Write media in chunks for streaming
 */
export class ChunkedStreamWriter {
  private options: Required<StreamingOptions>
  private chunks: StreamChunk[] = []
  private currentChunkData: Uint8Array[] = []
  private currentChunkStartTime = 0
  private currentChunkEndTime = 0
  private currentChunkSize = 0
  private chunkIndex = 0
  private lastKeyframeTime = 0
  private hasKeyframe = false
  private initSegment: Uint8Array | null = null
  private callback: ChunkCallback | null = null

  constructor(options: StreamingOptions = {}) {
    this.options = {
      chunkDuration: options.chunkDuration ?? 2,
      maxChunkSize: options.maxChunkSize ?? 10 * 1024 * 1024, // 10MB default
      minChunkDuration: options.minChunkDuration ?? 0.5,
      forceKeyframes: options.forceKeyframes ?? true,
      separateInit: options.separateInit ?? true,
      lowLatency: options.lowLatency ?? false,
    }

    if (this.options.lowLatency) {
      this.options.chunkDuration = Math.min(0.5, this.options.chunkDuration)
      this.options.minChunkDuration = Math.min(0.1, this.options.minChunkDuration)
    }
  }

  /**
   * Set callback for when chunks are ready
   */
  onChunk(callback: ChunkCallback): void {
    this.callback = callback
  }

  /**
   * Set initialization segment (for fragmented formats)
   */
  setInitSegment(data: Uint8Array): void {
    this.initSegment = data

    if (this.options.separateInit && this.callback) {
      const initChunk: StreamChunk = {
        data,
        index: -1, // Init segment has special index
        startTime: 0,
        endTime: 0,
        duration: 0,
        isInit: true,
        startsWithKeyframe: false,
      }
      this.callback(initChunk)
    }
  }

  /**
   * Write a packet to the stream
   */
  async writePacket(packet: EncodedPacket): Promise<void> {
    const shouldStartNewChunk = this.shouldStartNewChunk(packet)

    if (shouldStartNewChunk && this.currentChunkData.length > 0) {
      await this.flushChunk()
    }

    // Start new chunk if needed
    if (this.currentChunkData.length === 0) {
      this.currentChunkStartTime = packet.timestamp
      this.hasKeyframe = packet.isKeyframe
    }

    // Track keyframes
    if (packet.isKeyframe) {
      this.lastKeyframeTime = packet.timestamp
      if (!this.hasKeyframe) {
        this.hasKeyframe = true
      }
    }

    // Add packet to current chunk
    this.currentChunkData.push(packet.data)
    this.currentChunkSize += packet.data.byteLength
    this.currentChunkEndTime = packet.timestamp + (packet.duration ?? 0)
  }

  private shouldStartNewChunk(packet: EncodedPacket): boolean {
    if (this.currentChunkData.length === 0) return false

    const currentDuration = this.currentChunkEndTime - this.currentChunkStartTime

    // Always start new chunk on keyframe if duration exceeds target
    if (packet.isKeyframe && currentDuration >= this.options.chunkDuration) {
      return true
    }

    // Start new chunk if max size exceeded (only at keyframes if possible)
    if (this.currentChunkSize >= this.options.maxChunkSize) {
      if (packet.isKeyframe || !this.options.forceKeyframes) {
        return true
      }
    }

    // Don't split in the middle of a GOP if forceKeyframes is true
    if (this.options.forceKeyframes && !packet.isKeyframe) {
      return false
    }

    // Start new chunk if duration exceeds target significantly
    if (currentDuration >= this.options.chunkDuration * 1.5) {
      return true
    }

    return false
  }

  /**
   * Flush current chunk
   */
  async flushChunk(): Promise<void> {
    if (this.currentChunkData.length === 0) return

    const totalSize = this.currentChunkData.reduce((sum, d) => sum + d.byteLength, 0)
    const data = new Uint8Array(totalSize)
    let offset = 0

    for (const chunk of this.currentChunkData) {
      data.set(_chunk, offset)
      offset += chunk.byteLength
    }

    const chunk: StreamChunk = {
      data,
      index: this.chunkIndex++,
      startTime: this.currentChunkStartTime,
      endTime: this.currentChunkEndTime,
      duration: this.currentChunkEndTime - this.currentChunkStartTime,
      isInit: false,
      startsWithKeyframe: this.hasKeyframe,
    }

    this.chunks.push(_chunk)

    if (this.callback) {
      await this.callback(_chunk)
    }

    // Reset for next chunk
    this.currentChunkData = []
    this.currentChunkSize = 0
    this.hasKeyframe = false
  }

  /**
   * Finalize and get all chunks
   */
  async finalize(): Promise<StreamChunk[]> {
    await this.flushChunk()
    return this.chunks
  }

  /**
   * Get initialization segment
   */
  getInitSegment(): Uint8Array | null {
    return this.initSegment
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunkIndex
  }

  /**
   * Get total duration
   */
  getTotalDuration(): number {
    if (this.chunks.length === 0) return 0
    const lastChunk = this.chunks[this.chunks.length - 1]
    return lastChunk.endTime
  }
}

/**
 * AppendableBuffer - Buffer that supports efficient appending
 */
export class AppendableBuffer {
  private chunks: Uint8Array[] = []
  private totalSize = 0
  private position = 0

  /**
   * Append data to buffer
   */
  append(data: Uint8Array): void {
    this.chunks.push(data)
    this.totalSize += data.byteLength
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.totalSize
  }

  /**
   * Read data from buffer
   */
  read(offset: number, length: number): Uint8Array | null {
    if (offset >= this.totalSize) return null

    const result = new Uint8Array(Math.min(length, this.totalSize - offset))
    let resultOffset = 0
    let currentOffset = 0

    for (const chunk of this.chunks) {
      const chunkEnd = currentOffset + chunk.byteLength

      if (chunkEnd > offset && currentOffset < offset + length) {
        const sourceStart = Math.max(0, offset - currentOffset)
        const sourceEnd = Math.min(chunk.byteLength, offset + length - currentOffset)
        const copyLength = sourceEnd - sourceStart

        result.set(chunk.subarray(sourceStart, sourceEnd), resultOffset)
        resultOffset += copyLength
      }

      currentOffset = chunkEnd
      if (currentOffset >= offset + length) break
    }

    return result
  }

  /**
   * Get all data as single buffer
   */
  getBuffer(): Uint8Array {
    const result = new Uint8Array(this.totalSize)
    let offset = 0

    for (const chunk of this.chunks) {
      result.set(_chunk, offset)
      offset += chunk.byteLength
    }

    return result
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.chunks = []
    this.totalSize = 0
    this.position = 0
  }

  /**
   * Compact buffer (merge all chunks into one)
   */
  compact(): void {
    if (this.chunks.length <= 1) return

    const buffer = this.getBuffer()
    this.chunks = [buffer]
  }
}

/**
 * RingBuffer - Fixed-size circular buffer for streaming
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[]
  private writePos = 0
  private readPos = 0
  private count = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  /**
   * Write item to buffer
   */
  write(item: T): boolean {
    if (this.count >= this.capacity) {
      return false // Buffer full
    }

    this.buffer[this.writePos] = item
    this.writePos = (this.writePos + 1) % this.capacity
    this.count++
    return true
  }

  /**
   * Write item, overwriting oldest if full
   */
  writeOverwrite(item: T): void {
    if (this.count >= this.capacity) {
      // Advance read position to discard oldest
      this.readPos = (this.readPos + 1) % this.capacity
      this.count--
    }
    this.write(item)
  }

  /**
   * Read oldest item from buffer
   */
  read(): T | undefined {
    if (this.count === 0) return undefined

    const item = this.buffer[this.readPos]
    this.buffer[this.readPos] = undefined
    this.readPos = (this.readPos + 1) % this.capacity
    this.count--
    return item
  }

  /**
   * Peek at oldest item without removing
   */
  peek(): T | undefined {
    if (this.count === 0) return undefined
    return this.buffer[this.readPos]
  }

  /**
   * Get number of items in buffer
   */
  get length(): number {
    return this.count
  }

  /**
   * Check if buffer is empty
   */
  get isEmpty(): boolean {
    return this.count === 0
  }

  /**
   * Check if buffer is full
   */
  get isFull(): boolean {
    return this.count >= this.capacity
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.buffer.fill(undefined)
    this.writePos = 0
    this.readPos = 0
    this.count = 0
  }
}

/**
 * AsyncQueue - Queue with async read/write operations
 */
export class AsyncQueue<T> {
  private queue: T[] = []
  private waitingReaders: Array<(value: T) => void> = []
  private closed = false
  private maxSize: number

  constructor(maxSize = Infinity) {
    this.maxSize = maxSize
  }

  /**
   * Write item to queue
   */
  async write(item: T): Promise<void> {
    if (this.closed) {
      throw new Error('Queue is closed')
    }

    // If there's a waiting reader, deliver directly
    const reader = this.waitingReaders.shift()
    if (reader) {
      reader(item)
      return
    }

    // Otherwise add to queue
    if (this.queue.length >= this.maxSize) {
      // Wait for space (simple approach - could be improved with proper backpressure)
      await new Promise<void>(resolve => setTimeout(resolve, 10))
      return this.write(item)
    }

    this.queue.push(item)
  }

  /**
   * Read item from queue (waits if empty)
   */
  async read(): Promise<T | null> {
    if (this.queue.length > 0) {
      return this.queue.shift()!
    }

    if (this.closed) {
      return null
    }

    // Wait for item
    return new Promise<T | null>((resolve) => {
      if (this.closed) {
        resolve(null)
        return
      }

      const reader = (value: T) => resolve(value)
      this.waitingReaders.push(reader)
    })
  }

  /**
   * Read item without waiting
   */
  tryRead(): T | null {
    return this.queue.shift() ?? null
  }

  /**
   * Iterate over queue items
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const item = await this.read()
      if (item === null) break
      yield item
    }
  }

  /**
   * Close the queue
   */
  close(): void {
    this.closed = true
    // Wake up all waiting readers with null
    for (const reader of this.waitingReaders) {
      reader(null as unknown as T)
    }
    this.waitingReaders = []
  }

  /**
   * Check if queue is closed
   */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length
  }
}

/**
 * PacketBuffer - Buffer packets for reordering or delay
 */
export class PacketBuffer {
  private packets: EncodedPacket[] = []
  private maxSize: number
  private maxDuration: number

  constructor(options: { maxSize?: number; maxDuration?: number } = {}) {
    this.maxSize = options.maxSize ?? 100
    this.maxDuration = options.maxDuration ?? 5 // seconds
  }

  /**
   * Add packet to buffer
   */
  push(packet: EncodedPacket): void {
    this.packets.push(packet)

    // Sort by timestamp
    this.packets.sort((a, b) => a.timestamp - b.timestamp)

    // Prune if needed
    this.prune()
  }

  /**
   * Get next packet in timestamp order
   */
  shift(): EncodedPacket | null {
    return this.packets.shift() ?? null
  }

  /**
   * Peek at next packet without removing
   */
  peek(): EncodedPacket | null {
    return this.packets[0] ?? null
  }

  /**
   * Get packets up to timestamp
   */
  getPacketsUntil(timestamp: number): EncodedPacket[] {
    const result: EncodedPacket[] = []

    while (this.packets.length > 0 && this.packets[0].timestamp <= timestamp) {
      result.push(this.packets.shift()!)
    }

    return result
  }

  /**
   * Get all buffered packets
   */
  getAll(): EncodedPacket[] {
    return [...this.packets]
  }

  /**
   * Flush all packets
   */
  flush(): EncodedPacket[] {
    const result = this.packets
    this.packets = []
    return result
  }

  private prune(): void {
    // Remove excess packets
    while (this.packets.length > this.maxSize) {
      this.packets.shift()
    }

    // Remove old packets
    if (this.packets.length > 0) {
      const latestTime = this.packets[this.packets.length - 1].timestamp
      const cutoffTime = latestTime - this.maxDuration

      while (this.packets.length > 0 && this.packets[0].timestamp < cutoffTime) {
        this.packets.shift()
      }
    }
  }

  /**
   * Get buffer length
   */
  get length(): number {
    return this.packets.length
  }

  /**
   * Get buffered duration
   */
  get duration(): number {
    if (this.packets.length < 2) return 0
    return this.packets[this.packets.length - 1].timestamp - this.packets[0].timestamp
  }
}

/**
 * Create a transform stream for packets
 */
export function createPacketTransformStream(
  transform: (packet: EncodedPacket) => EncodedPacket | null | Promise<EncodedPacket | null>,
): TransformStream<EncodedPacket, EncodedPacket> {
  return new TransformStream<EncodedPacket, EncodedPacket>({
    async transform(_chunk, controller) {
      const result = await transform(_chunk)
      if (result) {
        controller.enqueue(result)
      }
    },
  })
}

/**
 * Create a filter stream for packets
 */
export function createPacketFilterStream(
  predicate: (packet: EncodedPacket) => boolean | Promise<boolean>,
): TransformStream<EncodedPacket, EncodedPacket> {
  return new TransformStream<EncodedPacket, EncodedPacket>({
    async transform(_chunk, controller) {
      if (await predicate(_chunk)) {
        controller.enqueue(_chunk)
      }
    },
  })
}

/**
 * Create a keyframe-only filter stream
 */
export function createKeyframeOnlyStream(): TransformStream<EncodedPacket, EncodedPacket> {
  return createPacketFilterStream(packet => packet.isKeyframe)
}

/**
 * Create a time range filter stream
 */
export function createTimeRangeStream(
  startTime: number,
  endTime: number,
): TransformStream<EncodedPacket, EncodedPacket> {
  return createPacketFilterStream(
    packet => packet.timestamp >= startTime && packet.timestamp <= endTime,
  )
}
