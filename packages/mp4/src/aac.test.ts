import { describe, expect, it } from 'bun:test'
import { audioSpecificConfigFromEsds, buildAudioSpecificConfig, buildEsdsPayload, esdsPayloadFor, isEsdsPayload, readAudioSpecificConfig } from './aac'

describe('the AAC decoder record', () => {
  it('writes AAC-LC for the common rates', () => {
    // 44.1 kHz stereo is the two bytes every AAC file starts from.
    expect(buildAudioSpecificConfig(44100, 2)).toEqual(new Uint8Array([0x12, 0x10]))
    expect(buildAudioSpecificConfig(48000, 1)).toEqual(new Uint8Array([0x11, 0x88]))
    expect(readAudioSpecificConfig(buildAudioSpecificConfig(48000, 2))).toEqual({ sampleRate: 48000, channels: 2 })
    expect(readAudioSpecificConfig(buildAudioSpecificConfig(44100, 8))).toEqual({ sampleRate: 44100, channels: 8 })
  })

  it('states a rate outside the table in full', () => {
    expect(readAudioSpecificConfig(buildAudioSpecificConfig(46875, 2))).toEqual({ sampleRate: 46875, channels: 2 })
  })

  it('wraps a record in an esds and finds it again', () => {
    const config = new Uint8Array([0x11, 0x90])
    const payload = buildEsdsPayload(config, 128_000)
    expect(isEsdsPayload(payload)).toBe(true)
    expect(isEsdsPayload(config)).toBe(false)
    expect(audioSpecificConfigFromEsds(payload)).toEqual(config)
  })

  it('reads an esds written with one-byte lengths, as ffmpeg and iPhones write it', () => {
    const payload = new Uint8Array([
      0, 0, 0, 0,
      0x03, 0x19, 0x00, 0x01, 0x00,
      0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0x01, 0xF4, 0x00, 0, 0x01, 0xF4, 0x00,
      0x05, 0x02, 0x11, 0x90,
      0x06, 0x01, 0x02,
    ])
    expect(audioSpecificConfigFromEsds(payload)).toEqual(new Uint8Array([0x11, 0x90]))
  })

  it('gives a muxer an esds whatever the track came with', () => {
    const config = new Uint8Array([0x11, 0x90])
    const wrapped = buildEsdsPayload(config)
    // A bare record is wrapped, a whole payload is kept, and nothing at all becomes AAC-LC for the track.
    expect(audioSpecificConfigFromEsds(esdsPayloadFor({ codecDescription: config, sampleRate: 48000, channels: 2 }))).toEqual(config)
    expect(esdsPayloadFor({ codecDescription: wrapped, sampleRate: 48000, channels: 2 })).toBe(wrapped)
    expect(audioSpecificConfigFromEsds(esdsPayloadFor({ sampleRate: 44100, channels: 2 }))).toEqual(new Uint8Array([0x12, 0x10]))
  })
})
