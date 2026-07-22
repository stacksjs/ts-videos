import { describe, expect, it } from 'bun:test'
import type { Input } from './input'
import type { Output } from './output'
import { generateVideoDerivatives, transcodeVideoWithWebCodecs } from './native-transcode'

describe('native video transcoding', () => {
  it('scales and streams video and audio into the selected muxer', async () => {
    const names = ['VideoDecoder', 'VideoEncoder', 'EncodedVideoChunk', 'VideoFrame', 'OffscreenCanvas', 'AudioDecoder', 'AudioEncoder', 'EncodedAudioChunk'] as const
    const originals = Object.fromEntries(names.map(name => [name, (globalThis as Record<string, unknown>)[name]]))
    class FakeChunk {
      type: 'key' | 'delta'
      timestamp: number
      duration?: number
      data: Uint8Array
      constructor(init: { type: 'key' | 'delta', timestamp: number, duration?: number, data: Uint8Array }) { Object.assign(this, init); this.type = init.type; this.timestamp = init.timestamp; this.data = init.data }
    }
    class FakeFrame {
      timestamp: number
      duration?: number
      constructor(_source: unknown, init: { timestamp: number, duration?: number }) { this.timestamp = init.timestamp; this.duration = init.duration }
      close(): void {}
    }
    class FakeDecoder {
      static async isConfigSupported(): Promise<{ supported: boolean }> { return { supported: true } }
      constructor(private init: { output: (_frame: FakeFrame) => void }) {}
      configure(): void {}
      decode(chunk: FakeChunk): void { this.init.output(new FakeFrame(null, chunk)) }
      async flush(): Promise<void> {}
      close(): void {}
    }
    class FakeEncoder {
      static async isConfigSupported(): Promise<{ supported: boolean }> { return { supported: true } }
      constructor(private init: { output: (_chunk: { type: 'key', timestamp: number, duration?: number, byteLength: number, copyTo: (_destination: Uint8Array) => void }, _metadata?: unknown) => void }) {}
      configure(): void {}
      encode(frame: FakeFrame): void {
        const encoded = new Uint8Array([7, 8, 9])
        this.init.output({ type: 'key', timestamp: frame.timestamp, duration: frame.duration, byteLength: encoded.byteLength, copyTo: destination => destination.set(encoded) }, { decoderConfig: { description: new Uint8Array([1, 2]) } })
      }
      async flush(): Promise<void> {}
      close(): void {}
    }
    class FakeAudioDecoder {
      static async isConfigSupported(): Promise<{ supported: boolean }> { return { supported: true } }
      constructor(private init: { output: (_data: { timestamp: number, duration?: number, close: () => void }) => void }) {}
      configure(): void {}
      decode(chunk: FakeChunk): void { this.init.output({ timestamp: chunk.timestamp, duration: chunk.duration, close: () => {} }) }
      async flush(): Promise<void> {}
      close(): void {}
    }
    class FakeAudioEncoder {
      static async isConfigSupported(): Promise<{ supported: boolean }> { return { supported: true } }
      constructor(private init: { output: (_chunk: { type: 'key', timestamp: number, duration?: number, byteLength: number, copyTo: (_destination: Uint8Array) => void }, _metadata?: unknown) => void }) {}
      configure(): void {}
      encode(data: { timestamp: number, duration?: number }): void {
        const encoded = new Uint8Array([5, 6])
        this.init.output({ type: 'key', timestamp: data.timestamp, duration: data.duration, byteLength: encoded.byteLength, copyTo: destination => destination.set(encoded) }, { decoderConfig: { description: new Uint8Array([3, 4]) } })
      }
      async flush(): Promise<void> {}
      close(): void {}
    }
    class FakeCanvas {
      constructor(_width: number, _height: number) {}
      getContext(): { drawImage: () => void } { return { drawImage: () => {} } }
    }
    Object.assign(globalThis, {
      VideoDecoder: FakeDecoder,
      VideoEncoder: FakeEncoder,
      EncodedVideoChunk: FakeChunk,
      VideoFrame: FakeFrame,
      OffscreenCanvas: FakeCanvas,
      AudioDecoder: FakeAudioDecoder,
      AudioEncoder: FakeAudioEncoder,
      EncodedAudioChunk: FakeChunk,
    })

    const written: Array<{ trackId: number, data: Uint8Array, timestamp: number }> = []
    const input = {
      getPrimaryVideoTrack: async () => ({ id: 1, index: 0, type: 'video', codec: 'h264', width: 1920, height: 1080, frameRate: 30 }),
      getPrimaryAudioTrack: async () => ({ id: 2, index: 1, type: 'audio', codec: 'opus', sampleRate: 48_000, channels: 2 }),
      getMetadata: async () => ({ title: 'Feature' }),
      allPackets: async function* () {
        yield { trackId: 1, packet: { data: new Uint8Array([1, 2]), timestamp: 0, duration: 1 / 30, isKeyframe: true } }
        yield { trackId: 2, packet: { data: new Uint8Array([3, 4]), timestamp: 0, duration: 0.02, isKeyframe: true } }
      },
      close: async () => {},
    } as unknown as Input
    const output = {
      setMetadata: () => {},
      addVideoTrack: (config: { codec: string, width: number, codecDescription?: Uint8Array }) => { expect(config).toMatchObject({ codec: 'h264', width: 1280, codecDescription: new Uint8Array([1, 2]) }); return { id: 4 } },
      addAudioTrack: (config: { codec: string, codecDescription?: Uint8Array }) => { expect(config).toMatchObject({ codec: 'aac', codecDescription: new Uint8Array([3, 4]) }); return { id: 5 } },
      writePacket: async (trackId: number, packet: { data: Uint8Array, timestamp: number }) => { written.push({ trackId, ...packet }) },
      finalize: async () => new Uint8Array([4, 5, 6]),
    } as unknown as Output

    try {
      const result = await transcodeVideoWithWebCodecs(input, output, {
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1280,
        height: 720,
        videoBitrate: 3_000_000,
        batchSize: 1,
      })
      expect(result).toMatchObject({ videoCodec: 'h264', audioCodec: 'aac', videoPackets: 1, audioPackets: 1, inputBytes: 4, outputBytes: 5 })
      expect(written.map(packet => packet.trackId)).toEqual([4, 5])

      const derivatives = await generateVideoDerivatives(new Uint8Array([1]), {
        source: { width: 1920, height: 1080, duration: 1, frameRate: 30, container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' },
        renditions: [{ name: '720p', width: 1280, height: 720, frameRate: 30, videoBitrate: 3_000_000, audioBitrate: 128_000 }],
        outputs: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', action: 'transcode', available: true }],
        streaming: [],
        segmentDuration: 2,
        keyframeInterval: 60,
      }, { inputFactory: () => input, outputFactory: () => output })
      expect(derivatives).toHaveLength(1)
      expect(derivatives[0].bytes).toEqual(new Uint8Array([4, 5, 6]))
    }
    finally {
      Object.assign(globalThis, originals)
    }
  })
})
