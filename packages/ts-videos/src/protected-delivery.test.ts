import { describe, expect, it } from 'bun:test'
import { buildVideoDeliveryPlan } from './delivery'
import { createAdaptiveDeliveryBundle, encryptHlsSegment } from './protected-delivery'

const source = {
  width: 1280,
  height: 720,
  duration: 8,
  frameRate: 30,
  container: 'mp4' as const,
  videoCodec: 'h264' as const,
  audioCodec: 'aac' as const,
  hasAudio: true,
}

describe('protected adaptive delivery', () => {
  it('encrypts HLS with AES-CBC padding', async () => {
    const encrypted = await encryptHlsSegment(new Uint8Array([1, 2, 3]), new Uint8Array(16).fill(4), new Uint8Array(16))
    expect(encrypted.byteLength).toBe(16)
    expect(encrypted).not.toEqual(new Uint8Array([1, 2, 3]))
  })

  it('builds encrypted HLS and clear DASH artifacts from aligned inputs', async () => {
    const rendition = { name: '720p', width: 1280, height: 720, frameRate: 30, videoBitrate: 2_000_000, audioBitrate: 128_000 }
    const plan = buildVideoDeliveryPlan(source, { renditions: [rendition] }, {
      videoEncoder: false,
      audioEncoder: false,
      videoCodecs: [],
      audioCodecs: [],
    })
    const original = new Uint8Array([1, 2, 3, 4])
    const bundle = await createAdaptiveDeliveryBundle(plan, [{
      rendition,
      initialization: { uri: 'init.mp4', data: new Uint8Array([0, 1]) },
      segments: [{ uri: 'segment-1.m4s', duration: 4, data: original }, { uri: 'segment-2.m4s', duration: 4, data: original }],
    }], {
      hlsAes128: { key: new Uint8Array(16).fill(9), keyUri: '/media/keys/asset' },
      drm: {
        descriptors: [{ system: 'widevine', keyId: '00112233-4455-6677-8899-aabbccddeeff', licenseUrl: '/media/licenses/widevine', pssh: 'AAAA' }],
        dashSegmentsEncrypted: true,
      },
    })
    expect(bundle.hlsMaster).toContain('hls/720p/index.m3u8'.replace('hls/', ''))
    expect(bundle.files['hls/720p/index.m3u8']).toContain('#EXT-X-KEY:METHOD=AES-128')
    expect(bundle.files['dash/manifest.mpd']).toContain('urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed')
    expect(bundle.files['dash/720p/segment-1.m4s']).toEqual(original)
    expect(bundle.files['hls/720p/segment-1.m4s']).not.toEqual(original)
  })

  it('rejects mismatched rendition inputs', async () => {
    const plan = buildVideoDeliveryPlan(source, { renditions: [{ name: '720p', width: 1280, height: 720, frameRate: 30, videoBitrate: 2_000_000, audioBitrate: 128_000 }] })
    await expect(createAdaptiveDeliveryBundle(plan, [], {})).rejects.toThrow('planned rendition count')
  })

  it('refuses to label clear segments as proprietary DRM content', async () => {
    const rendition = { name: '720p', width: 1280, height: 720, frameRate: 30, videoBitrate: 2_000_000, audioBitrate: 128_000 }
    const plan = buildVideoDeliveryPlan(source, { renditions: [rendition] })
    await expect(createAdaptiveDeliveryBundle(plan, [{
      rendition,
      segments: [{ uri: 'segment.m4s', duration: 8, data: new Uint8Array([1]) }],
    }], {
      hls: false,
      drm: { descriptors: [{ system: 'widevine', keyId: '00112233445566778899aabbccddeeff', licenseUrl: '/license' }] },
    })).rejects.toThrow('pre-encrypted CENC segments')
  })
})
