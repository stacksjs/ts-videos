import { describe, expect, it } from 'bun:test'
import { Input } from 'ts-videos/input'
import { Output } from 'ts-videos/output'
import { WebmInputFormat, WebmOutputFormat } from './index'

describe('WebM demuxing', () => {
  it('reads every block of every track when tracks are read in turn', async () => {
    // One cursor over the file, and a block of the track not asked for was
    // dropped: with picture and sound read together, each lost the blocks the
    // other's search passed.
    const output = new Output(new WebmOutputFormat())
    const video = output.addVideoTrack({ codec: 'vp9', width: 320, height: 180, frameRate: 30 }).id
    const audio = output.addAudioTrack({ codec: 'opus', sampleRate: 48000, channels: 1 }).id
    // 10 frames at 30 a second beside 17 packets of 20 ms: about five of sound to three of picture.
    const packets: { track: number, at: number, byte: number }[] = []
    for (let frame = 0; frame < 10; frame++) packets.push({ track: video, at: frame / 30, byte: frame })
    for (let packet = 0; packet < 17; packet++) packets.push({ track: audio, at: packet * 0.02, byte: 100 + packet })
    packets.sort((a, b) => a.at - b.at)
    for (const packet of packets) {
      await output.writePacket(packet.track, { data: new Uint8Array([packet.byte, 1, 2, 3]), timestamp: packet.at, duration: packet.track === video ? 1 / 30 : 0.02, isKeyframe: true })
    }
    const bytes = await output.finalize()

    const input = new Input(bytes)
    input.setFormats([new WebmInputFormat()])
    try {
      const tracks = await input.getTracks()
      const read = new Map<number, number[]>(tracks.map(track => [track.id, []]))
      for await (const { trackId, packet } of input.allPackets()) read.get(trackId)!.push(packet.data[0])
      const [picture, sound] = tracks.map(track => read.get(track.id)!)
      expect(picture).toEqual(Array.from({ length: 10 }, (_, frame) => frame))
      expect(sound).toEqual(Array.from({ length: 17 }, (_, packet) => 100 + packet))
    }
    finally {
      await input.close()
    }
  })
})
