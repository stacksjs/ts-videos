import { describe, expect, test } from 'bun:test'
import { buildVideoDeliveryPlan } from '../src/delivery'
import { createVideoDeliveryPipeline, splitFragmentedMp4 } from '../src/delivery-pipeline'

const fixture = new URL('fixtures/landscape.mp4', import.meta.url).pathname

describe('video delivery pipeline', () => {
  test('reuses one fragmented MP4 derivative for HLS and DASH', async () => {
    const source = {
      width: 320,
      height: 180,
      duration: 2,
      frameRate: 30,
      container: 'mp4' as const,
      videoCodec: 'h264' as const,
      audioCodec: 'aac' as const,
      hasAudio: true,
    }
    const plan = buildVideoDeliveryPlan(source, {
      formats: ['mp4'],
      streaming: ['hls', 'dash'],
      renditions: [{
        name: '180p',
        width: 320,
        height: 180,
        frameRate: 30,
        videoBitrate: 350_000,
        audioBitrate: 64_000,
      }],
    })
    const result = await createVideoDeliveryPipeline(fixture, plan, {
      poster: false,
      previews: false,
    })

    expect(result.derivatives).toHaveLength(1)
    expect(result.adaptive?.hlsMaster).toContain('#EXTM3U')
    expect(result.adaptive?.dashManifest).toContain('<MPD')
    expect(Object.keys(result.files)).toContain('hls/180p/init.mp4')
    expect(Object.keys(result.files).some(path => path.endsWith('.m4s'))).toBe(true)

    const split = splitFragmentedMp4(result.derivatives[0].bytes)
    expect(split.initialization.byteLength).toBeGreaterThan(0)
    expect(split.segments).toHaveLength(1)
  })

  test('rejects truncated and non-fragmented MP4 data', () => {
    expect(() => splitFragmentedMp4(new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]))).toThrow(/size/)
    expect(() => splitFragmentedMp4(new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]))).toThrow(/moof/)
  })
})
