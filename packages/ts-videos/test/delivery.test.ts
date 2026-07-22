import { describe, expect, test } from 'bun:test'
import {
  assertPacketCopyConversion,
  assertVideoPlanExecutable,
  buildVideoDeliveryPlan,
  deriveVideoLadder,
  detectVideoRuntimeCapabilities,
  generatePreviewVtt,
  validateSegmentAlignment,
} from '../src'

const source = {
  width: 1920,
  height: 1080,
  duration: 120,
  frameRate: 30,
  container: 'mp4' as const,
  videoCodec: 'h264' as const,
  audioCodec: 'aac' as const,
  videoBitrate: 8_000_000,
  hasAudio: true,
}

describe('video delivery planning', () => {
  test('refuses to relabel packet-copy output as transcoded media', () => {
    expect(() => assertPacketCopyConversion({
      id: 1,
      index: 0,
      type: 'video',
      codec: 'h264',
      width: 1920,
      height: 1080,
      frameRate: 30,
    }, null, { videoCodec: 'vp9' })).toThrow(/native encoder pipeline/)
  })

  test('derives a distinct ladder without upscaling', () => {
    const ladder = deriveVideoLadder(source)
    expect(ladder.map(rendition => rendition.height)).toEqual([240, 360, 480, 540, 720, 1080])
    expect(ladder.every(rendition => rendition.width <= source.width && rendition.height <= source.height)).toBe(true)
    expect(new Set(ladder.map(rendition => `${rendition.width}x${rendition.height}`)).size).toBe(ladder.length)
  })

  test('handles portrait sources by preserving orientation and aspect ratio', () => {
    const ladder = deriveVideoLadder({ ...source, width: 1080, height: 1920 })
    expect(ladder.at(-1)).toMatchObject({ width: 1080, height: 1920 })
    expect(ladder.every(rendition => rendition.height > rendition.width)).toBe(true)
  })

  test('reports unavailable transcoding instead of treating remuxing as conversion', () => {
    const plan = buildVideoDeliveryPlan(source)
    expect(plan.outputs.find(output => output.container === 'webm')).toMatchObject({
      action: 'transcode',
      available: false,
      videoCodec: 'vp9',
      audioCodec: 'opus',
    })
    expect(() => assertVideoPlanExecutable(plan)).toThrow(/vp9 video encoder/)
  })

  test('marks outputs executable when codecs are available', () => {
    const plan = buildVideoDeliveryPlan(source, {}, {
      videoEncoder: true,
      audioEncoder: true,
      videoCodecs: ['h264', 'vp9'],
      audioCodecs: ['aac', 'opus'],
    })
    expect(plan.outputs.every(output => output.available)).toBe(true)
    expect(() => assertVideoPlanExecutable(plan)).not.toThrow()
    expect(plan.keyframeInterval).toBe(plan.segmentDuration * source.frameRate)
  })

  test('reports native runtime capabilities', async () => {
    const capabilities = await detectVideoRuntimeCapabilities()
    expect(typeof capabilities.videoEncoder).toBe('boolean')
    expect(typeof capabilities.audioEncoder).toBe('boolean')
  })
})

describe('video preview and segment metadata', () => {
  test('generates sprite-aware WebVTT cues', () => {
    const vtt = generatePreviewVtt([
      { startTime: 0, endTime: 10, uri: 'preview.jpg', x: 0, y: 0, width: 160, height: 90 },
      { startTime: 10, endTime: 20, uri: 'preview.jpg', x: 160, y: 0, width: 160, height: 90 },
    ])
    expect(vtt).toContain('00:00:00.000 --> 00:00:10.000')
    expect(vtt).toContain('preview.jpg#xywh=160,0,160,90')
  })

  test('rejects overlapping preview cues', () => {
    expect(() => generatePreviewVtt([
      { startTime: 0, endTime: 5, uri: 'a.jpg' },
      { startTime: 4, endTime: 6, uri: 'b.jpg' },
    ])).toThrow(/overlaps/)
  })

  test('finds misaligned segment boundaries', () => {
    const issues = validateSegmentAlignment([
      [{ startTime: 0, duration: 4 }, { startTime: 4, duration: 4 }],
      [{ startTime: 0, duration: 4 }, { startTime: 4.2, duration: 4 }],
    ])
    expect(issues).toEqual([{ rendition: 1, segment: 1, expected: 4, actual: 4.2 }])
  })
})
