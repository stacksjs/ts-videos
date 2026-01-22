/**
 * Binary writer for creating media file formats
 * Supports both buffer-based and streaming output
 */

export class Writer {
  private chunks: Uint8Array[] = []
  private target: Target | null = null
  private pos = 0
  private buffer: Uint8Array
  private bufferPos = 0
  private readonly bufferSize: number

  constructor(options: { target?: Target, bufferSize?: number } = {}) {
    this.target = options.target ?? null
    this.bufferSize = options.bufferSize ?? 65536
    this.buffer = new Uint8Array(this.bufferSize)
  }

  get position(): number {
    return this.pos
  }

  private async flushBuffer(): Promise<void> {
    if (this.bufferPos === 0) return

    const data = this.buffer.subarray(0, this.bufferPos)
    if (this.target) {
      await this.target.write(data, this.pos - this.bufferPos)
    }
    else {
      this.chunks.push(new Uint8Array(data))
    }
    this.bufferPos = 0
  }

  private ensureCapacity(length: number): void {
    if (this.bufferPos + length > this.bufferSize) {
      // Need to flush
    }
  }

  async writeBytes(bytes: Uint8Array): Promise<void> {
    if (bytes.length > this.bufferSize - this.bufferPos) {
      await this.flushBuffer()
      if (bytes.length > this.bufferSize) {
        if (this.target) {
          await this.target.write(bytes, this.pos)
        }
        else {
          this.chunks.push(new Uint8Array(bytes))
        }
        this.pos += bytes.length
        return
      }
    }

    this.buffer.set(bytes, this.bufferPos)
    this.bufferPos += bytes.length
    this.pos += bytes.length
  }

  async writeU8(value: number): Promise<void> {
    if (this.bufferPos >= this.bufferSize) {
      await this.flushBuffer()
    }
    this.buffer[this.bufferPos++] = value & 0xFF
    this.pos++
  }

  async writeU16BE(value: number): Promise<void> {
    if (this.bufferPos + 2 > this.bufferSize) {
      await this.flushBuffer()
    }
    this.buffer[this.bufferPos++] = (value >> 8) & 0xFF
    this.buffer[this.bufferPos++] = value & 0xFF
    this.pos += 2
  }

  async writeU16LE(value: number): Promise<void> {
    if (this.bufferPos + 2 > this.bufferSize) {
      await this.flushBuffer()
    }
    this.buffer[this.bufferPos++] = value & 0xFF
    this.buffer[this.bufferPos++] = (value >> 8) & 0xFF
    this.pos += 2
  }

  async writeU24BE(value: number): Promise<void> {
    if (this.bufferPos + 3 > this.bufferSize) {
      await this.flushBuffer()
    }
    this.buffer[this.bufferPos++] = (value >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (value >> 8) & 0xFF
    this.buffer[this.bufferPos++] = value & 0xFF
    this.pos += 3
  }

  async writeU32BE(value: number): Promise<void> {
    if (this.bufferPos + 4 > this.bufferSize) {
      await this.flushBuffer()
    }
    this.buffer[this.bufferPos++] = (value >> 24) & 0xFF
    this.buffer[this.bufferPos++] = (value >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (value >> 8) & 0xFF
    this.buffer[this.bufferPos++] = value & 0xFF
    this.pos += 4
  }

  async writeU32LE(value: number): Promise<void> {
    if (this.bufferPos + 4 > this.bufferSize) {
      await this.flushBuffer()
    }
    this.buffer[this.bufferPos++] = value & 0xFF
    this.buffer[this.bufferPos++] = (value >> 8) & 0xFF
    this.buffer[this.bufferPos++] = (value >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (value >> 24) & 0xFF
    this.pos += 4
  }

  async writeU64BE(value: bigint): Promise<void> {
    if (this.bufferPos + 8 > this.bufferSize) {
      await this.flushBuffer()
    }
    const hi = Number(value >> 32n)
    const lo = Number(value & 0xFFFFFFFFn)
    this.buffer[this.bufferPos++] = (hi >> 24) & 0xFF
    this.buffer[this.bufferPos++] = (hi >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (hi >> 8) & 0xFF
    this.buffer[this.bufferPos++] = hi & 0xFF
    this.buffer[this.bufferPos++] = (lo >> 24) & 0xFF
    this.buffer[this.bufferPos++] = (lo >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (lo >> 8) & 0xFF
    this.buffer[this.bufferPos++] = lo & 0xFF
    this.pos += 8
  }

  async writeU64LE(value: bigint): Promise<void> {
    if (this.bufferPos + 8 > this.bufferSize) {
      await this.flushBuffer()
    }
    const lo = Number(value & 0xFFFFFFFFn)
    const hi = Number(value >> 32n)
    this.buffer[this.bufferPos++] = lo & 0xFF
    this.buffer[this.bufferPos++] = (lo >> 8) & 0xFF
    this.buffer[this.bufferPos++] = (lo >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (lo >> 24) & 0xFF
    this.buffer[this.bufferPos++] = hi & 0xFF
    this.buffer[this.bufferPos++] = (hi >> 8) & 0xFF
    this.buffer[this.bufferPos++] = (hi >> 16) & 0xFF
    this.buffer[this.bufferPos++] = (hi >> 24) & 0xFF
    this.pos += 8
  }

  async writeI8(value: number): Promise<void> {
    await this.writeU8(value < 0 ? value + 256 : value)
  }

  async writeI16BE(value: number): Promise<void> {
    await this.writeU16BE(value < 0 ? value + 65536 : value)
  }

  async writeI16LE(value: number): Promise<void> {
    await this.writeU16LE(value < 0 ? value + 65536 : value)
  }

  async writeI32BE(value: number): Promise<void> {
    await this.writeU32BE(value < 0 ? value + 4294967296 : value)
  }

  async writeI32LE(value: number): Promise<void> {
    await this.writeU32LE(value < 0 ? value + 4294967296 : value)
  }

  async writeI64BE(value: bigint): Promise<void> {
    await this.writeU64BE(value < 0n ? value + 18446744073709551616n : value)
  }

  async writeI64LE(value: bigint): Promise<void> {
    await this.writeU64LE(value < 0n ? value + 18446744073709551616n : value)
  }

  async writeF32BE(value: number): Promise<void> {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value, false)
    await this.writeBytes(new Uint8Array(view.buffer))
  }

  async writeF32LE(value: number): Promise<void> {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value, true)
    await this.writeBytes(new Uint8Array(view.buffer))
  }

  async writeF64BE(value: number): Promise<void> {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value, false)
    await this.writeBytes(new Uint8Array(view.buffer))
  }

  async writeF64LE(value: number): Promise<void> {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value, true)
    await this.writeBytes(new Uint8Array(view.buffer))
  }

  async writeString(value: string, encoding: 'utf-8' | 'ascii' | 'latin1' = 'utf-8'): Promise<void> {
    if (encoding === 'ascii' || encoding === 'latin1') {
      const bytes = new Uint8Array(value.length)
      for (let i = 0; i < value.length; i++) {
        bytes[i] = value.charCodeAt(i) & 0xFF
      }
      await this.writeBytes(bytes)
    }
    else {
      const bytes = new TextEncoder().encode(value)
      await this.writeBytes(bytes)
    }
  }

  async writeNullTerminatedString(value: string): Promise<void> {
    await this.writeString(value, 'utf-8')
    await this.writeU8(0)
  }

  async writeFourCC(value: string): Promise<void> {
    if (value.length !== 4) {
      throw new Error(`FourCC must be exactly 4 characters, got ${value.length}`)
    }
    await this.writeString(value, 'ascii')
  }

  async writeZeros(count: number): Promise<void> {
    const zeros = new Uint8Array(count)
    await this.writeBytes(zeros)
  }

  async writePadding(alignment: number): Promise<void> {
    const remainder = this.pos % alignment
    if (remainder !== 0) {
      await this.writeZeros(alignment - remainder)
    }
  }

  async writeVarint(value: number): Promise<void> {
    while (value >= 0x80) {
      await this.writeU8((value & 0x7F) | 0x80)
      value >>>= 7
    }
    await this.writeU8(value)
  }

  async writeEBMLVarint(value: bigint, minLength = 1): Promise<void> {
    let length = minLength
    const maxValues = [
      0x7Fn,
      0x3FFFn,
      0x1FFFFFn,
      0xFFFFFFFn,
      0x7FFFFFFFFn,
      0x3FFFFFFFFFFn,
      0x1FFFFFFFFFFFFn,
      0xFFFFFFFFFFFFFFn,
    ]

    while (length < 8 && value > maxValues[length - 1]) {
      length++
    }

    const marker = 1 << (8 - length)
    const firstByte = marker | Number(value >> (BigInt(length - 1) * 8n))
    await this.writeU8(firstByte)

    for (let i = length - 2; i >= 0; i--) {
      await this.writeU8(Number((value >> (BigInt(i) * 8n)) & 0xFFn))
    }
  }

  async finalize(): Promise<Uint8Array> {
    await this.flushBuffer()

    if (this.target) {
      await this.target.finalize()
      return new Uint8Array(0)
    }

    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  getBuffer(): Uint8Array {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0) + this.bufferPos
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    if (this.bufferPos > 0) {
      result.set(this.buffer.subarray(0, this.bufferPos), offset)
    }
    return result
  }
}

export interface Target {
  write(data: Uint8Array, offset: number): Promise<void>
  finalize(): Promise<void>
  close?(): Promise<void>
}
