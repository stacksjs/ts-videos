/**
 * Utility functions for ts-videos
 */

import { config } from './config'

export class AsyncMutex {
  private locked = false
  private queue: Array<() => void> = []

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    }
    finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    }
    else {
      this.locked = false
    }
  }
}

export class CallSerializer {
  private queue: Promise<unknown> = Promise.resolve()

  async call<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(fn)
    this.queue = result.catch(() => {})
    return result
  }
}

export function binarySearch<T>(
  array: T[],
  target: number,
  getValue: (item: T) => number,
): number {
  let left = 0
  let right = array.length - 1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const value = getValue(array[mid])

    if (value === target) {
      return mid
    }
    else if (value < target) {
      left = mid + 1
    }
    else {
      right = mid - 1
    }
  }

  return -left - 1
}

export function binarySearchLessOrEqual<T>(
  array: T[],
  target: number,
  getValue: (item: T) => number,
): number {
  let left = 0
  let right = array.length - 1
  let result = -1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const value = getValue(array[mid])

    if (value <= target) {
      result = mid
      left = mid + 1
    }
    else {
      right = mid - 1
    }
  }

  return result
}

export function binarySearchGreaterOrEqual<T>(
  array: T[],
  target: number,
  getValue: (item: T) => number,
): number {
  let left = 0
  let right = array.length - 1
  let result = -1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const value = getValue(array[mid])

    if (value >= target) {
      result = mid
      right = mid - 1
    }
    else {
      left = mid + 1
    }
  }

  return result
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.byteLength
  }
  return result
}

export function compareBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

export function intoTimescale(timeInSeconds: number, timescale: number, round = true): number {
  const value = timeInSeconds * timescale
  return round ? Math.round(value) : value
}

export function fromTimescale(timeInTimescale: number, timescale: number): number {
  return timeInTimescale / timescale
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}

export function parseDuration(str: string): number {
  const parts = str.split(':')
  let seconds = 0

  if (parts.length === 3) {
    seconds = Number.parseFloat(parts[0]) * 3600 + Number.parseFloat(parts[1]) * 60 + Number.parseFloat(parts[2])
  }
  else if (parts.length === 2) {
    seconds = Number.parseFloat(parts[0]) * 60 + Number.parseFloat(parts[1])
  }
  else {
    seconds = Number.parseFloat(parts[0])
  }

  return seconds
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

export function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b)
}

export function simplifyFraction(numerator: number, denominator: number): [number, number] {
  const divisor = gcd(numerator, denominator)
  return [numerator / divisor, denominator / divisor]
}

export function debugLog(category: string, message: string, verbose?: boolean | string[]): void {
  if (verbose === false) {
    return
  }

  if (verbose === true || config.verbose === true) {
    console.debug(`[ts-videos:${category}] ${message}`)
  }

  if (Array.isArray(verbose)) {
    const matches = verbose.some(prefix => category.startsWith(prefix))
    if (matches) {
      console.log(`[ts-videos:${category}] ${message}`)
    }
  }

  if (Array.isArray(config.verbose)) {
    const matches = config.verbose.some(prefix => category.startsWith(prefix))
    if (matches) {
      console.log(`[ts-videos:${category}] ${message}`)
    }
  }
}

export function defer<T>(): { promise: Promise<T>, resolve: (value: T) => void, reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function crc32(data: Uint8Array): number {
  const table = getCRC32Table()
  let crc = 0xFFFFFFFF

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF]
  }

  return (crc ^ 0xFFFFFFFF) >>> 0
}

let crc32Table: Uint32Array | null = null

function getCRC32Table(): Uint32Array {
  if (crc32Table) return crc32Table

  crc32Table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crc32Table[i] = c
  }

  return crc32Table
}

export function detectEndianness(): 'little' | 'big' {
  const buffer = new ArrayBuffer(2)
  new DataView(buffer).setInt16(0, 256, true)
  return new Int16Array(buffer)[0] === 256 ? 'little' : 'big'
}

export const isLittleEndian: boolean = detectEndianness() === 'little'
