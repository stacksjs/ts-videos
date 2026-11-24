/**
 * The AAC decoder record, in the two shapes it travels in.
 *
 * An AudioSpecificConfig is the two or more bytes a decoder is configured
 * with: what WebCodecs calls an audio track's `description`, and what a
 * Matroska file keeps as CodecPrivate. An MP4 wraps it in an `esds` box, three
 * descriptors deep. A track's `codecDescription` is the AudioSpecificConfig;
 * the wrapping is this file's business and the muxers'.
 */

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

/** Whether bytes are an `esds` box's contents (version, flags, then an ES descriptor) rather than a bare AudioSpecificConfig. */
export function isEsdsPayload(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 && bytes[4] === 0x03
}

/** A descriptor's tag and where its contents lie; its length is one to four bytes of seven bits each. */
function readDescriptor(bytes: Uint8Array, at: number): { tag: number, start: number, end: number } | null {
  if (at + 2 > bytes.byteLength) return null
  const tag = bytes[at]
  let length = 0
  let cursor = at + 1
  for (let count = 0; count < 4 && cursor < bytes.byteLength; count++) {
    const byte = bytes[cursor++]
    length = (length << 7) | (byte & 0x7F)
    if (!(byte & 0x80)) break
  }
  return { tag, start: cursor, end: Math.min(bytes.byteLength, cursor + length) }
}

/** The AudioSpecificConfig inside an `esds` box's contents, or undefined when there is none. */
export function audioSpecificConfigFromEsds(payload: Uint8Array): Uint8Array | undefined {
  const es = readDescriptor(payload, 4)
  if (!es || es.tag !== 0x03) return undefined
  // ES_ID, then a flags byte that says which optional fields follow.
  let cursor = es.start + 3
  const flags = payload[es.start + 2] ?? 0
  if (flags & 0x80) cursor += 2
  if (flags & 0x40) cursor += 1 + (payload[cursor] ?? 0)
  if (flags & 0x20) cursor += 2
  while (cursor < es.end) {
    const descriptor = readDescriptor(payload, cursor)
    if (!descriptor) return undefined
    if (descriptor.tag === 0x04) {
      // Object type, stream type, buffer size and two bitrates: 13 bytes, then the decoder's own record.
      let inner = descriptor.start + 13
      while (inner < descriptor.end) {
        const specific = readDescriptor(payload, inner)
        if (!specific) return undefined
        if (specific.tag === 0x05) return payload.slice(specific.start, specific.end)
        inner = specific.end
      }
      return undefined
    }
    cursor = descriptor.end
  }
  return undefined
}

/** What an AudioSpecificConfig says of the sound: its rate and channels, undefined where it does not state them plainly. */
export function readAudioSpecificConfig(config: Uint8Array): { sampleRate?: number, channels?: number } {
  if (config.byteLength < 2) return {}
  let bit = 0
  const read = (count: number): number => {
    let value = 0
    for (let index = 0; index < count; index++, bit++) {
      const byte = config[bit >> 3] ?? 0
      value = (value << 1) | ((byte >> (7 - (bit & 7))) & 1)
    }
    return value
  }
  let objectType = read(5)
  if (objectType === 31) objectType = 32 + read(6)
  const rateIndex = read(4)
  const sampleRate = rateIndex === 15 ? read(24) : SAMPLE_RATES[rateIndex]
  const channelConfiguration = read(4)
  // 7 is 7.1; 0 leaves the layout to the stream itself.
  const channels = channelConfiguration === 7 ? 8 : channelConfiguration || undefined
  return { sampleRate, channels }
}

/** An AAC-LC AudioSpecificConfig for a rate and channel count, for a track that came with none. */
export function buildAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const index = SAMPLE_RATES.indexOf(sampleRate)
  const configuration = channels === 8 ? 7 : Math.max(1, Math.min(6, channels))
  if (index < 0) {
    // An explicit 24-bit rate: 5 bits type, 4 bits escape, 24 bits rate, 4 bits channels.
    const bits = (2n << 35n) | (15n << 31n) | (BigInt(sampleRate) << 7n) | (BigInt(configuration) << 3n)
    return Uint8Array.from({ length: 5 }, (_, at) => Number((bits >> BigInt(8 * (4 - at))) & 0xFFn))
  }
  return new Uint8Array([(2 << 3) | (index >> 1), ((index & 1) << 7) | (configuration << 3)])
}

function descriptor(tag: number, contents: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + contents.byteLength)
  out[0] = tag
  // Always the four-byte length form: every reader takes it, and sizes stay predictable.
  out[1] = 0x80 | ((contents.byteLength >> 21) & 0x7F)
  out[2] = 0x80 | ((contents.byteLength >> 14) & 0x7F)
  out[3] = 0x80 | ((contents.byteLength >> 7) & 0x7F)
  out[4] = contents.byteLength & 0x7F
  out.set(contents, 5)
  return out
}

/** An `esds` box's contents around an AudioSpecificConfig. */
export function buildEsdsPayload(config: Uint8Array, bitrate = 0): Uint8Array {
  const rate = Math.max(0, Math.min(0xFFFFFFFF, Math.round(bitrate)))
  const decoder = new Uint8Array(13 + 5 + config.byteLength)
  decoder[0] = 0x40 // MPEG-4 audio
  decoder[1] = 0x15 // an audio stream
  new DataView(decoder.buffer).setUint32(5, rate) // the most it uses
  new DataView(decoder.buffer).setUint32(9, rate) // and on average
  decoder.set(descriptor(0x05, config), 13)
  const decoderDescriptor = descriptor(0x04, decoder)
  const sync = descriptor(0x06, new Uint8Array([0x02]))
  const es = new Uint8Array(3 + decoderDescriptor.byteLength + sync.byteLength)
  es.set(decoderDescriptor, 3)
  es.set(sync, 3 + decoderDescriptor.byteLength)
  const wrapped = descriptor(0x03, es)
  const payload = new Uint8Array(4 + wrapped.byteLength)
  payload.set(wrapped, 4)
  return payload
}

/**
 * The bytes an MP4 `esds` box holds for an AAC track, whatever the track came
 * with: an AudioSpecificConfig (a WebCodecs encoder, a Matroska file, this
 * demuxer) is wrapped, a whole `esds` payload (what this demuxer gave before)
 * is kept, and a track with no record gets an AAC-LC one for its rate and
 * channels. Written raw, an AudioSpecificConfig made a file no decoder opened.
 */
export function esdsPayloadFor(track: { codecDescription?: Uint8Array, sampleRate: number, channels: number, bitrate?: number }): Uint8Array {
  const given = track.codecDescription
  if (given && isEsdsPayload(given)) return given
  const config = given && given.byteLength >= 2 ? given : buildAudioSpecificConfig(track.sampleRate, track.channels)
  return buildEsdsPayload(config, track.bitrate)
}
