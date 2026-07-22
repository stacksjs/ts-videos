import { describe, expect, test } from 'bun:test'
import { BufferTarget, Input } from 'ts-videos'
import { MovInputFormat } from './index'
import { Mp4Muxer } from './muxer'

describe('ProRes sample entries', () => {
  test('round-trips the 4444 XQ profile through MOV metadata', async () => {
    const target = new BufferTarget()
    const muxer = new Mp4Muxer(target, { brand: 'qt  ' })
    const track = muxer.addVideoTrack({
      codec: 'prores',
      profile: '4444-xq',
      width: 1920,
      height: 1080,
      frameRate: 24,
    })
    await muxer.writePacket(track.id, {
      data: new Uint8Array([0, 0, 0, 8, 0x69, 0x63, 0x70, 0x66]),
      timestamp: 0,
      duration: 1 / 24,
      isKeyframe: true,
    })
    await muxer.finalize()

    const input = new Input(target.buffer)
    input.setFormats([new MovInputFormat()])
    expect(await input.getPrimaryVideoTrack()).toMatchObject({ codec: 'prores', profile: '4444-xq' })
    await input.close()
  })
})
