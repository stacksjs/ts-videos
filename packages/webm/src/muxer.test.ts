import { describe, expect, test } from 'bun:test'
import { BufferTarget, Input } from 'ts-videos'
import { MkvInputFormat } from './index'
import { WebmMuxer } from './muxer'

describe('WebmMuxer subtitles', () => {
  test('round-trips subtitle duration through a BlockGroup', async () => {
    const target = new BufferTarget()
    const muxer = new WebmMuxer(target, { isWebm: false })
    const track = muxer.addSubtitleTrack({ codec: 'webvtt', language: 'en' })

    await muxer.writePacket(track.id, {
      data: new TextEncoder().encode('Opening caption'),
      timestamp: 1,
      duration: 1.25,
      isKeyframe: true,
    })
    await muxer.finalize()

    const input = new Input(target.buffer)
    input.setFormats([new MkvInputFormat()])
    const [subtitle] = await input.getSubtitleTracks()
    const packet = await input.readPacket(subtitle.id)

    expect(subtitle).toMatchObject({ codec: 'webvtt', language: 'en' })
    expect(packet?.duration).toBeCloseTo(1.25, 3)
    expect(new TextDecoder().decode(packet?.data)).toBe('Opening caption')
    await input.close()
  })
})
