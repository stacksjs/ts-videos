/**
 * Binary reader for parsing media file formats
 * Supports both synchronous buffer reading and async file reading
 */

export class FileSlice {
  readonly bytes: Uint8Array
  readonly view: DataView
  readonly offset: number
  readonly fileStartPos: number
  readonly fileEndPos: number

  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.offset = offset
    this.fileStartPos = offset
    this.fileEndPos = offset + bytes.byteLength
  }

  contains(pos: number, length: number): boolean {
    return pos >= this.fileStartPos && pos + length <= this.fileEndPos
  }

  getRelativeOffset(absolutePos: number): number {
    return absolutePos - this.fileStartPos
  }
}

export class Reader {
  private pos = 0
  private slice: FileSlice | null = null
  private source: Source | null = null
  private _sizePromise: Promise<number | null> | null = null

  constructor(source?: Source) {
    this.source = source ?? null
  }

  static fromBuffer(buffer: Uint8Array): Reader {
    const reader = new Reader()
    reader.slice = new FileSlice(buffer, 0)
    return reader
  }

  static fromSource(source: Source): Reader {
    return new Reader(source)
  }

  get position(): number {
    return this.pos
  }

  set position(value: number) {
    this.pos = value
  }

  async getSize(): Promise<number | null> {
    if (this.slice && !this.source) {
      return this.slice.bytes.byteLength
    }
    if (!this.source) return null
    return this._sizePromise ??= this.source.getSize()
  }

  async ensureBytes(length: number): Promise<boolean> {
    if (this.slice?.contains(this.pos, length)) {
      return true
    }
    if (!this.source) return false

    const slice = await this.source.readSlice(this.pos, length)
    if (!slice) return false

    this.slice = slice
    return true
  }

  async readBytes(length: number): Promise<Uint8Array | null> {
    if (!(await this.ensureBytes(length))) return null

    const offset = this.slice!.getRelativeOffset(this.pos)
    const bytes = this.slice!.bytes.subarray(offset, offset + length)
    this.pos += length
    return bytes
  }

  async readU8(): Promise<number | null> {
    if (!(await this.ensureBytes(1))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getUint8(offset)
    this.pos += 1
    return value
  }

  async readU16BE(): Promise<number | null> {
    if (!(await this.ensureBytes(2))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getUint16(offset, false)
    this.pos += 2
    return value
  }

  async readU16LE(): Promise<number | null> {
    if (!(await this.ensureBytes(2))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getUint16(offset, true)
    this.pos += 2
    return value
  }

  async readU24BE(): Promise<number | null> {
    if (!(await this.ensureBytes(3))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const b0 = this.slice!.view.getUint8(offset)
    const b1 = this.slice!.view.getUint8(offset + 1)
    const b2 = this.slice!.view.getUint8(offset + 2)
    this.pos += 3
    return (b0 << 16) | (b1 << 8) | b2
  }

  async readU32BE(): Promise<number | null> {
    if (!(await this.ensureBytes(4))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getUint32(offset, false)
    this.pos += 4
    return value
  }

  async readU32LE(): Promise<number | null> {
    if (!(await this.ensureBytes(4))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getUint32(offset, true)
    this.pos += 4
    return value
  }

  async readU64BE(): Promise<bigint | null> {
    if (!(await this.ensureBytes(8))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getBigUint64(offset, false)
    this.pos += 8
    return value
  }

  async readU64LE(): Promise<bigint | null> {
    if (!(await this.ensureBytes(8))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getBigUint64(offset, true)
    this.pos += 8
    return value
  }

  async readI8(): Promise<number | null> {
    if (!(await this.ensureBytes(1))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getInt8(offset)
    this.pos += 1
    return value
  }

  async readI16BE(): Promise<number | null> {
    if (!(await this.ensureBytes(2))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getInt16(offset, false)
    this.pos += 2
    return value
  }

  async readI16LE(): Promise<number | null> {
    if (!(await this.ensureBytes(2))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getInt16(offset, true)
    this.pos += 2
    return value
  }

  async readI32BE(): Promise<number | null> {
    if (!(await this.ensureBytes(4))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getInt32(offset, false)
    this.pos += 4
    return value
  }

  async readI32LE(): Promise<number | null> {
    if (!(await this.ensureBytes(4))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getInt32(offset, true)
    this.pos += 4
    return value
  }

  async readI64BE(): Promise<bigint | null> {
    if (!(await this.ensureBytes(8))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getBigInt64(offset, false)
    this.pos += 8
    return value
  }

  async readI64LE(): Promise<bigint | null> {
    if (!(await this.ensureBytes(8))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getBigInt64(offset, true)
    this.pos += 8
    return value
  }

  async readF32BE(): Promise<number | null> {
    if (!(await this.ensureBytes(4))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getFloat32(offset, false)
    this.pos += 4
    return value
  }

  async readF32LE(): Promise<number | null> {
    if (!(await this.ensureBytes(4))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getFloat32(offset, true)
    this.pos += 4
    return value
  }

  async readF64BE(): Promise<number | null> {
    if (!(await this.ensureBytes(8))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getFloat64(offset, false)
    this.pos += 8
    return value
  }

  async readF64LE(): Promise<number | null> {
    if (!(await this.ensureBytes(8))) return null
    const offset = this.slice!.getRelativeOffset(this.pos)
    const value = this.slice!.view.getFloat64(offset, true)
    this.pos += 8
    return value
  }

  async readString(length: number, encoding: 'utf-8' | 'ascii' | 'latin1' = 'utf-8'): Promise<string | null> {
    const bytes = await this.readBytes(length)
    if (!bytes) return null

    if (encoding === 'ascii' || encoding === 'latin1') {
      let str = ''
      for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i])
      }
      return str
    }

    return new TextDecoder(encoding).decode(bytes)
  }

  async readNullTerminatedString(maxLength = 1024): Promise<string | null> {
    const bytes: number[] = []
    for (let i = 0; i < maxLength; i++) {
      const byte = await this.readU8()
      if (byte === null) return null
      if (byte === 0) break
      bytes.push(byte)
    }
    return new TextDecoder().decode(new Uint8Array(bytes))
  }

  async readFourCC(): Promise<string | null> {
    return this.readString(4, 'ascii')
  }

  async peek<T>(fn: () => Promise<T>): Promise<T> {
    const savedPos = this.pos
    const result = await fn()
    this.pos = savedPos
    return result
  }

  async skip(length: number): Promise<void> {
    this.pos += length
  }

  async seek(position: number): Promise<void> {
    this.pos = position
  }

  async readVarint(): Promise<number | null> {
    let result = 0
    let shift = 0
    while (true) {
      const byte = await this.readU8()
      if (byte === null) return null
      result |= (byte & 0x7F) << shift
      if ((byte & 0x80) === 0) break
      shift += 7
    }
    return result
  }

  async readEBMLVarint(): Promise<{ value: bigint, length: number } | null> {
    const firstByte = await this.readU8()
    if (firstByte === null) return null

    let length = 1
    let mask = 0x80
    while ((firstByte & mask) === 0 && length < 8) {
      mask >>= 1
      length++
    }

    if (length > 8) return null

    let value = BigInt(firstByte & (mask - 1))
    for (let i = 1; i < length; i++) {
      const byte = await this.readU8()
      if (byte === null) return null
      value = (value << 8n) | BigInt(byte)
    }

    return { value, length }
  }
}

export interface Source {
  getSize(): Promise<number | null>
  readSlice(offset: number, length: number): Promise<FileSlice | null>
  close?(): Promise<void>
}
