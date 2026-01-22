/**
 * Bit-level reader/writer for codec-specific bitstream parsing
 * Used for parsing NAL units, Vorbis headers, Opus configs, etc.
 */

export class BitstreamReader {
  private data: Uint8Array
  private bitPos = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  get bitsRemaining(): number {
    return this.data.length * 8 - this.bitPos
  }

  get bytesRemaining(): number {
    return Math.ceil(this.bitsRemaining / 8)
  }

  get position(): number {
    return this.bitPos
  }

  get bytePosition(): number {
    return Math.floor(this.bitPos / 8)
  }

  readBit(): number {
    if (this.bitPos >= this.data.length * 8) {
      throw new Error('Bitstream exhausted')
    }

    const byteIndex = Math.floor(this.bitPos / 8)
    const bitIndex = 7 - (this.bitPos % 8)
    this.bitPos++

    return (this.data[byteIndex] >> bitIndex) & 1
  }

  readBits(count: number): number {
    if (count > 32) {
      throw new Error('Cannot read more than 32 bits at once')
    }
    if (count === 0) return 0

    let result = 0
    for (let i = 0; i < count; i++) {
      result = (result << 1) | this.readBit()
    }
    return result
  }

  readBitsBigInt(count: number): bigint {
    if (count === 0) return 0n

    let result = 0n
    for (let i = 0; i < count; i++) {
      result = (result << 1n) | BigInt(this.readBit())
    }
    return result
  }

  readBitsLE(count: number): number {
    if (count > 32) {
      throw new Error('Cannot read more than 32 bits at once')
    }
    if (count === 0) return 0

    let result = 0
    for (let i = 0; i < count; i++) {
      result |= this.readBit() << i
    }
    return result
  }

  readU8(): number {
    return this.readBits(8)
  }

  readU16(): number {
    return this.readBits(16)
  }

  readU32(): number {
    return this.readBits(32)
  }

  readAlignedByte(): number {
    this.alignToByte()
    return this.readBits(8)
  }

  readExpGolomb(): number {
    let leadingZeros = 0
    while (this.readBit() === 0 && leadingZeros < 32) {
      leadingZeros++
    }

    if (leadingZeros === 0) return 0
    const suffix = this.readBits(leadingZeros)
    return (1 << leadingZeros) - 1 + suffix
  }

  readSignedExpGolomb(): number {
    const value = this.readExpGolomb()
    if (value === 0) return 0
    const sign = (value & 1) === 1 ? 1 : -1
    return sign * Math.ceil(value / 2)
  }

  readUEV(): number {
    return this.readExpGolomb()
  }

  readSEV(): number {
    return this.readSignedExpGolomb()
  }

  skipBits(count: number): void {
    this.bitPos += count
    if (this.bitPos > this.data.length * 8) {
      this.bitPos = this.data.length * 8
    }
  }

  alignToByte(): void {
    const remainder = this.bitPos % 8
    if (remainder !== 0) {
      this.bitPos += 8 - remainder
    }
  }

  readBytes(count: number): Uint8Array {
    this.alignToByte()
    const startByte = this.bytePosition
    this.bitPos += count * 8
    return this.data.subarray(startByte, startByte + count)
  }

  peekBits(count: number): number {
    const savedPos = this.bitPos
    const result = this.readBits(count)
    this.bitPos = savedPos
    return result
  }

  peekBit(): number {
    const savedPos = this.bitPos
    const result = this.readBit()
    this.bitPos = savedPos
    return result
  }

  seek(bitPosition: number): void {
    this.bitPos = bitPosition
  }

  seekByte(bytePosition: number): void {
    this.bitPos = bytePosition * 8
  }

  hasMoreData(): boolean {
    return this.bitPos < this.data.length * 8
  }

  getRemainingBytes(): Uint8Array {
    this.alignToByte()
    return this.data.subarray(this.bytePosition)
  }
}

export class BitstreamWriter {
  private data: number[] = []
  private currentByte = 0
  private bitPos = 0

  get length(): number {
    return this.data.length * 8 + this.bitPos
  }

  get byteLength(): number {
    return this.data.length + (this.bitPos > 0 ? 1 : 0)
  }

  writeBit(bit: number): void {
    this.currentByte = (this.currentByte << 1) | (bit & 1)
    this.bitPos++

    if (this.bitPos === 8) {
      this.data.push(this.currentByte)
      this.currentByte = 0
      this.bitPos = 0
    }
  }

  writeBits(value: number, count: number): void {
    if (count > 32) {
      throw new Error('Cannot write more than 32 bits at once')
    }

    for (let i = count - 1; i >= 0; i--) {
      this.writeBit((value >> i) & 1)
    }
  }

  writeBitsBigInt(value: bigint, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.writeBit(Number((value >> BigInt(i)) & 1n))
    }
  }

  writeBitsLE(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.writeBit((value >> i) & 1)
    }
  }

  writeU8(value: number): void {
    this.writeBits(value, 8)
  }

  writeU16(value: number): void {
    this.writeBits(value, 16)
  }

  writeU32(value: number): void {
    this.writeBits(value, 32)
  }

  writeExpGolomb(value: number): void {
    if (value === 0) {
      this.writeBit(1)
      return
    }

    const temp = value + 1
    const leadingZeros = 31 - Math.clz32(temp)

    for (let i = 0; i < leadingZeros; i++) {
      this.writeBit(0)
    }

    this.writeBits(temp, leadingZeros + 1)
  }

  writeSignedExpGolomb(value: number): void {
    if (value === 0) {
      this.writeExpGolomb(0)
      return
    }

    const absValue = Math.abs(value)
    const mappedValue = value > 0 ? 2 * absValue - 1 : 2 * absValue
    this.writeExpGolomb(mappedValue)
  }

  writeUEV(value: number): void {
    this.writeExpGolomb(value)
  }

  writeSEV(value: number): void {
    this.writeSignedExpGolomb(value)
  }

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.writeU8(byte)
    }
  }

  alignToByte(fillBit = 0): void {
    while (this.bitPos !== 0) {
      this.writeBit(fillBit)
    }
  }

  alignToByteWithOne(): void {
    if (this.bitPos !== 0) {
      this.writeBit(1)
      while (this.bitPos !== 0) {
        this.writeBit(0)
      }
    }
  }

  finalize(): Uint8Array {
    const result = new Uint8Array(this.byteLength)
    for (let i = 0; i < this.data.length; i++) {
      result[i] = this.data[i]
    }
    if (this.bitPos > 0) {
      result[this.data.length] = this.currentByte << (8 - this.bitPos)
    }
    return result
  }

  getBuffer(): Uint8Array {
    return this.finalize()
  }
}

export function removeEmulationPreventionBytes(data: Uint8Array): Uint8Array {
  const result: number[] = []
  let i = 0

  while (i < data.length) {
    if (i + 2 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
      result.push(0, 0)
      i += 3
    }
    else {
      result.push(data[i])
      i++
    }
  }

  return new Uint8Array(result)
}

export function addEmulationPreventionBytes(data: Uint8Array): Uint8Array {
  const result: number[] = []
  let zerosCount = 0

  for (let i = 0; i < data.length; i++) {
    if (zerosCount === 2 && data[i] <= 3) {
      result.push(3)
      zerosCount = 0
    }

    result.push(data[i])

    if (data[i] === 0) {
      zerosCount++
    }
    else {
      zerosCount = 0
    }
  }

  return new Uint8Array(result)
}
