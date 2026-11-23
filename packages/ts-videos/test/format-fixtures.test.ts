import { describe, expect, test } from 'bun:test'
import { MovInputFormat, Mp4InputFormat } from '../../mp4/src'
import { Input } from '../src/input'
import { parseVtt } from '../src/subtitles'

const fixture = (name: string): string => new URL(`fixtures/${name}`, import.meta.url).pathname

async function inspect(name: string): Promise<{
  video: Awaited<ReturnType<Input['getVideoTracks']>>
  audio: Awaited<ReturnType<Input['getAudioTracks']>>
  duration: number
  packetCounts: Map<number, number>
}> {
  const input = new Input(fixture(name))
  input.setFormats([new Mp4InputFormat(), new MovInputFormat()])

  try {
    const [video, audio, duration] = await Promise.all([
      input.getVideoTracks(),
      input.getAudioTracks(),
      input.getDuration(),
    ])
    const packetCounts = new Map<number, number>()
    for await (const { trackId } of input.allPackets()) {
      packetCounts.set(trackId, (packetCounts.get(trackId) ?? 0) + 1)
    }

    return { video, audio, duration, packetCounts }
  }
  finally {
    await input.close()
  }
}

describe('video format fixtures', () => {
  test('reads landscape video with AAC audio', async () => {
    const result = await inspect('landscape.mp4')

    expect(result.video).toHaveLength(1)
    expect(result.video[0]).toMatchObject({ codec: 'h264', width: 320, height: 180 })
    expect(result.audio).toHaveLength(1)
    expect(result.audio[0]).toMatchObject({ codec: 'aac', channels: 2, sampleRate: 32000 })
    expect(result.duration).toBeCloseTo(2, 1)
    expect(result.packetCounts.get(result.video[0].id)).toBeGreaterThan(0)
    expect(result.packetCounts.get(result.audio[0].id)).toBeGreaterThan(0)
  })

  test('preserves portrait dimensions and silent tracks', async () => {
    const portrait = await inspect('portrait-video.mp4')
    const silent = await inspect('silent-video.mp4')

    expect(portrait.video[0]).toMatchObject({ width: 180, height: 320 })
    expect(portrait.audio).toHaveLength(0)
    expect(silent.video[0]).toMatchObject({ width: 256, height: 144 })
    expect(silent.audio).toHaveLength(0)
  })

  test('preserves HDR color metadata', async () => {
    const result = await inspect('hdr-video.mp4')

    expect(result.video[0]).toMatchObject({
      codec: 'h265',
      colorSpace: {
        primaries: 'bt2020',
        transfer: 'smpte2084',
        matrix: 'bt2020nc',
        range: 'limited',
      },
    })
  })

  test('reads a portrait iPhone-style HLG clip as portrait, HLG and 60 fps', async () => {
    // hlg-portrait.mov (make-hlg-portrait.sh): 3840x2160 HEVC Main10 HLG at
    // 60 fps, stored landscape with a -90 degree display matrix, in a
    // QuickTime file whose colr box is 'nclc'. Each of these was misread:
    // the matrix's -1 (0xFFFF0000) as 65535 so rotation fell through to 0,
    // 'nclc' ignored so the HDR went undetected, and the frame rate never
    // computed (stacksjs/ts-videos#1006, #1007, #1008).
    const result = await inspect('hlg-portrait.mov')

    expect(result.video).toHaveLength(1)
    expect(result.video[0]).toMatchObject({ codec: 'h265', width: 3840, height: 2160, rotation: 90 })
    expect(result.video[0]?.colorSpace).toMatchObject({ primaries: 'bt2020', transfer: 'arib-std-b67', matrix: 'bt2020nc' })
    expect(result.video[0]?.frameRate).toBeCloseTo(60, 1)
  })

  test('computes the frame rate of every fixture', async () => {
    const result = await inspect('landscape.mp4')
    expect(result.video[0]?.frameRate).toBeGreaterThan(0)
  })

  test('reads every audio track from a multi-audio source', async () => {
    const result = await inspect('multiple-audio.mp4')

    expect(result.audio).toHaveLength(2)
    expect(result.audio.every(track => track.codec === 'aac')).toBe(true)
    expect(result.audio.every(track => (result.packetCounts.get(track.id) ?? 0) > 0)).toBe(true)
  })

  test('parses caption and chapter sidecars', async () => {
    const captions = parseVtt(await Bun.file(fixture('captions.vtt')).text())
    const chapterDocument = await Bun.file(fixture('chapters.json')).json() as {
      duration: number
      chapters: { startTime: number, endTime: number, title: string }[]
    }

    expect(captions.cues.map(cue => cue.text)).toEqual(['Opening gradient', 'Closing gradient'])
    expect(chapterDocument).toEqual({
      duration: 2000,
      chapters: [
        { startTime: 0, endTime: 1000, title: 'Opening' },
        { startTime: 1000, endTime: 2000, title: 'Closing' },
      ],
    })
  })
})
