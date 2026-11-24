import { describe, expect, test } from 'bun:test'
import { MovInputFormat, Mp4InputFormat } from '../../mp4/src'
import { AacDecodeError, createAacDecoder, imdct } from '../src/aac-decoder'
import { decodeAudio, decodeAudioToWav, decodeWav, resampleAudio } from '../src/audio-decode'
import { Input } from '../src/input'
import { createSource } from '../src/source'
import type { EncodedPacket } from '../src/types'

const fixture = (path: string): string => new URL(`fixtures/${path}`, import.meta.url).pathname
const formats = [new Mp4InputFormat(), new MovInputFormat()]

/** Signal to error, in decibels, of `actual` against `expected`, over every channel. */
function snr(expected: Float32Array[], actual: Float32Array[]): number {
  let signal = 0
  let error = 0
  expected.forEach((channel, c) => {
    for (let i = 0; i < channel.length; i++) {
      signal += channel[i] ** 2
      error += (channel[i] - actual[c][i]) ** 2
    }
  })
  return 10 * Math.log10(signal / error)
}

async function reference(name: string): Promise<ReturnType<typeof decodeWav>> {
  return decodeWav(new Uint8Array(await Bun.file(fixture(`voice/${name}`)).arrayBuffer()))
}

describe('AAC', () => {
  // The fixtures are Apple's encoder's (test/fixtures/voice/make-voice-fixtures.sh);
  // ref-*.wav are Apple's own decodes of them, written as 16-bit, so ~90 dB is exact.
  test('decodes a phone voice note (mono AAC-LC in M4A) as Apple does, sample for sample', async () => {
    const [ours, apple] = await Promise.all([decodeAudio(fixture('voice/voice-aac-lc.m4a'), { formats }), reference('ref-voice-aac-lc.wav')])
    expect(ours).toMatchObject({ codec: 'aac', sampleRate: 44100 })
    expect(ours.channels).toHaveLength(1)
    // Apple's 2112 samples of encoder priming are gone, and the padding at the end.
    expect(ours.channels[0].length).toBe(apple.channels[0].length)
    expect(snr(apple.channels, ours.channels)).toBeGreaterThan(80)
  })

  test('decodes stereo 48 kHz AAC as Apple does', async () => {
    const [ours, apple] = await Promise.all([decodeAudio(fixture('voice/voice-aac-stereo.m4a'), { formats }), reference('ref-voice-aac-stereo.wav')])
    expect(ours).toMatchObject({ codec: 'aac', sampleRate: 48000 })
    expect(ours.channels).toHaveLength(2)
    expect(ours.channels[0].length).toBe(apple.channels[0].length)
    expect(snr(apple.channels, ours.channels)).toBeGreaterThan(80)
  })

  test('decodes the AAC core of HE-AAC: the voice, at half the rate', async () => {
    const [he, lc] = await Promise.all([decodeAudio(fixture('voice/voice-he-aac.m4a'), { formats }), decodeAudio(fixture('voice/voice-aac-lc.m4a'), { formats })])
    expect(he.sampleRate).toBe(22050)
    expect(he.duration).toBeCloseTo(lc.duration, 2)
    // Two encodings of the same words: below 11 kHz they sound the same.
    const [low] = resampleAudio(lc.channels, 44100, 22050)
    let dot = 0
    let a = 0
    let b = 0
    for (let i = 0; i < Math.min(low.length, he.channels[0].length); i++) {
      dot += low[i] * he.channels[0][i]
      a += low[i] ** 2
      b += he.channels[0][i] ** 2
    }
    expect(dot / Math.sqrt(a * b)).toBeGreaterThan(0.95)
  })

  test('turns a voice note into the 16 kHz mono WAV speech-to-text takes', async () => {
    const wav = await decodeAudioToWav(fixture('voice/voice-aac-stereo.m4a'), { maxDurationSeconds: 300 })
    const apple = await reference('ref-voice-aac-stereo.wav')
    expect(wav).toMatchObject({ mimeType: 'audio/wav', sampleRate: 16000, channels: 1 })
    expect(wav.durationSeconds).toBeCloseTo(apple.channels[0].length / 48000, 3)
    expect(decodeWav(wav.audio).channels[0].length).toBe(Math.floor(apple.channels[0].length / 3))
  })

  test('hears a damaged frame as silence and carries on, but refuses a damaged file', async () => {
    const input = new Input({ source: createSource(fixture('voice/voice-aac-lc.m4a')), formats })
    const track = (await input.getPrimaryAudioTrack())!
    const packets: EncodedPacket[] = []
    for await (const packet of input.packets(track.id)) packets.push(packet)
    await input.close()

    const decoder = createAacDecoder(track)
    const outputs = packets.map((packet, i) => decoder.decode(i === 10 ? { ...packet, data: new Uint8Array([0x20, 0, 0]) } : packet))
    expect(outputs.every(output => output?.channels[0].length === 1024)).toBe(true)
    expect(Math.max(...outputs[10]!.channels[0])).toBe(0)
    expect(Math.max(...outputs[20]!.channels[0].map(Math.abs))).toBeGreaterThan(0)

    const broken = createAacDecoder(track)
    expect(() => packets.forEach(packet => broken.decode({ ...packet, data: new Uint8Array([0x20, 0, 0]) }))).toThrow(AacDecodeError)
  })

  test('the inverse MDCT matches its definition', () => {
    for (const half of [1024, 128]) {
      const length = half * 2
      const input = new Float32Array(half).map((_, k) => Math.sin(k * 1.7) * 0.5)
      const fast = imdct(input)
      for (const n of [0, 1, half / 2, half - 1, half, length - 1]) {
        let sum = 0
        for (let k = 0; k < half; k++) sum += input[k] * Math.cos(2 * Math.PI / length * (n + (half + 1) / 2) * (k + 0.5))
        expect(fast[n]).toBeCloseTo(sum * 2 / length, 6)
      }
    }
  })
})
