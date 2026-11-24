import { describe, expect, test } from 'bun:test'
import { MovInputFormat, Mp4InputFormat, Mp4OutputFormat } from '../../mp4/src'
import { Input } from '../src/input'
import { Output } from '../src/output'

const fixture = (name: string): string => new URL(`fixtures/${name}`, import.meta.url).pathname

/** Copies every packet of a fixture's first video and audio track into a new faststart MP4. */
async function remux(name: string, fastStart = true): Promise<Uint8Array> {
  const input = new Input(fixture(name))
  input.setFormats([new Mp4InputFormat(), new MovInputFormat()])
  try {
    const video = (await input.getPrimaryVideoTrack())!
    const audio = await input.getPrimaryAudioTrack()
    const output = new Output(new Mp4OutputFormat({ fastStart }))
    const videoId = output.addVideoTrack({
      codec: video.codec,
      width: video.width,
      height: video.height,
      frameRate: video.frameRate,
      codecDescription: video.codecDescription,
      colorSpace: video.colorSpace,
      rotation: video.rotation,
    }).id
    const audioId = audio
      ? output.addAudioTrack({ codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.channels, codecDescription: audio.codecDescription }).id
      : undefined
    for await (const { trackId, packet } of input.allPackets()) {
      if (trackId === video.id) await output.writePacket(videoId, packet)
      else if (audio && trackId === audio.id && audioId !== undefined) await output.writePacket(audioId, packet)
    }
    return await output.finalize()
  }
  finally {
    await input.close()
  }
}

async function read(source: string | Uint8Array): Promise<{ video: any, audio: any, duration: number, packets: Map<number, number>, digests: Map<number, string> }> {
  const input = new Input(source)
  input.setFormats([new Mp4InputFormat(), new MovInputFormat()])
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    const duration = await input.getDuration()
    const packets = new Map<number, number>()
    const hashers = new Map<number, Bun.CryptoHasher>()
    for await (const { trackId, packet } of input.allPackets()) {
      packets.set(trackId, (packets.get(trackId) ?? 0) + 1)
      if (!hashers.has(trackId)) hashers.set(trackId, new Bun.CryptoHasher('sha256'))
      hashers.get(trackId)!.update(packet.data)
    }
    const digests = new Map([...hashers].map(([id, hasher]) => [id, hasher.digest('hex')]))
    return { video, audio, duration, packets, digests }
  }
  finally {
    await input.close()
  }
}

const tagged = (bytes: Uint8Array, tag: string): boolean => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(tag, 0, 'latin1')

describe('remuxing a phone clip into an MP4', () => {
  test('keeps the quarter turn, the sound\'s rate, every packet and the length', async () => {
    // The muxer wrote an identity display matrix, so this upright clip came
    // out on its side, and the demuxer read 44.1 and 48 kHz with a signed
    // shift, as a negative rate that made the length nonsense.
    const before = await read(fixture('hlg-portrait.mov'))
    const bytes = await remux('hlg-portrait.mov')
    const after = await read(bytes)

    expect(before.video.rotation).toBe(90)
    expect(after.video).toMatchObject({ codec: 'h265', width: 3840, height: 2160, rotation: 90 })
    expect(before.audio.sampleRate).toBeGreaterThanOrEqual(44100)
    expect(after.audio.sampleRate).toBe(before.audio.sampleRate)
    expect(after.packets.get(after.video.id)).toBe(before.packets.get(before.video.id)!)
    expect(after.packets.get(after.audio.id)).toBe(before.packets.get(before.audio.id)!)
    expect(after.duration).toBeCloseTo(before.duration, 1)
  })

  test('carries the sound\'s decoder record out of a QuickTime file and into the MP4', async () => {
    // QuickTime nests the record in a `wave` box. Read flat, the track had
    // none, the MP4 was written without an esds, and no player decoded it.
    const before = await read(fixture('hlg-portrait.mov'))
    const after = await read(await remux('hlg-portrait.mov'))
    expect(before.audio.codecDescription?.byteLength).toBeGreaterThanOrEqual(2)
    expect(after.audio.codecDescription).toEqual(before.audio.codecDescription)
  })

  for (const fastStart of [true, false]) {
    test(`every track reads back its own bytes${fastStart ? ', index first' : ', index last'}`, async () => {
      // Each track's chunk table started at the first byte of the media data,
      // so the second track of every file read the first track's samples.
      for (const name of ['hlg-portrait.mov', 'landscape.mp4', 'multiple-audio.mp4']) {
        const before = await read(fixture(name))
        const after = await read(await remux(name, fastStart))
        expect(after.digests.get(after.video.id)).toBe(before.digests.get(before.video.id)!)
        if (before.audio) expect(after.digests.get(after.audio.id)).toBe(before.digests.get(before.audio.id)!)
      }
    })
  }

  test('lays sound beside its picture, half a second at a time', async () => {
    const bytes = await remux('landscape.mp4')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
    // Each track's chunk count. The fixture has 2 s of picture and a third of a
    // second of sound: the first half second of picture, the sound, then the
    // rest of the picture in one run, since nothing comes between its samples.
    const counts: number[] = []
    for (let at = text.indexOf('stco'); at >= 0; at = text.indexOf('stco', at + 4)) counts.push(view.getUint32(at + 8))
    expect(counts).toHaveLength(2)
    expect(counts).toEqual([2, 1])
  })

  test('tags H.265 as hvc1, the one Safari plays in an MP4', async () => {
    const bytes = await remux('hlg-portrait.mov')
    expect(tagged(bytes, 'hvc1')).toBe(true)
    expect(tagged(bytes, 'hev1')).toBe(false)
  })

  test('puts the index before the media', async () => {
    const bytes = await remux('landscape.mp4')
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
    expect(text.indexOf('moov')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
  })

  test('an unturned clip stays unturned', async () => {
    const after = await read(await remux('landscape.mp4'))
    expect(after.video.rotation ?? 0).toBe(0)
    expect(after.video).toMatchObject({ codec: 'h264', width: 320, height: 180 })
  })
})
