import { describe, expect, it } from 'bun:test'
import { Mp4Muxer } from '../../mp4/src/muxer'
import { createMp4ChapterAtom, parseMp4Chapters } from '../src/chapters'
import { BufferTarget } from '../src/target'

async function muxWithChapters(chapters: { title: string, startTimeMs: number }[]): Promise<Uint8Array> {
  const target = new BufferTarget()
  const muxer = new Mp4Muxer(target)
  const track = muxer.addAudioTrack({
    codec: 'aac',
    sampleRate: 44100,
    channels: 2,
    codecDescription: new Uint8Array([0x12, 0x10]),
  })
  for (const chapter of chapters) {
    muxer.addChapter(chapter.title, chapter.startTimeMs)
  }
  await muxer.start()
  // 6 dummy packets of 0.5s each -> 3s total duration
  for (let i = 0; i < 6; i++) {
    await muxer.writePacket(track.id, {
      data: new Uint8Array(64).fill(i + 1),
      timestamp: i * 0.5,
      duration: 0.5,
      isKeyframe: true,
    })
  }
  await muxer.finalize()
  return target.buffer
}

describe('parseMp4Chapters', () => {
  it('round-trips a QuickTime chapter text track written by Mp4Muxer', async () => {
    const buffer = await muxWithChapters([
      { title: 'Intro', startTimeMs: 0 },
      { title: 'Chapter Twö — 🎧', startTimeMs: 1000 },
      { title: 'Finale', startTimeMs: 2500 },
    ])

    const { chapters } = parseMp4Chapters(buffer)

    expect(chapters.length).toBe(3)
    expect(chapters[0].title).toBe('Intro')
    expect(chapters[1].title).toBe('Chapter Twö — 🎧')
    expect(chapters[2].title).toBe('Finale')
    expect(chapters[0].startTime).toBe(0)
    expect(chapters[1].startTime).toBe(1000)
    expect(chapters[2].startTime).toBe(2500)
    expect(chapters[0].endTime).toBe(1000)
    expect(chapters[1].endTime).toBe(2500)
    expect(chapters[2].endTime).toBe(3000)
  })

  it('falls back to generic titles with correct timing when given only the moov box', async () => {
    const buffer = await muxWithChapters([
      { title: 'One', startTimeMs: 0 },
      { title: 'Two', startTimeMs: 1500 },
    ])

    // Extract just the moov box: chunk offsets now point outside the buffer
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let moov: Uint8Array | null = null
    let offset = 0
    while (offset + 8 <= buffer.length) {
      const size = view.getUint32(offset)
      const type = String.fromCharCode(buffer[offset + 4], buffer[offset + 5], buffer[offset + 6], buffer[offset + 7])
      if (type === 'moov') {
        moov = buffer.subarray(offset, offset + size)
        break
      }
      offset += size
    }
    expect(moov).not.toBeNull()

    const { chapters } = parseMp4Chapters(moov!)

    expect(chapters.length).toBe(2)
    expect(chapters[0].title).toBe('Chapter 1')
    expect(chapters[1].title).toBe('Chapter 2')
    expect(chapters[0].startTime).toBe(0)
    expect(chapters[1].startTime).toBe(1500)
  })

  it('parses Nero chpl chapters when no chapter track exists', () => {
    const chpl = createMp4ChapterAtom([
      { startTime: 0, title: 'Part One' },
      { startTime: 60000, title: 'Part Two' },
    ])

    const box = (type: string, payload: Uint8Array): Uint8Array => {
      const out = new Uint8Array(8 + payload.length)
      new DataView(out.buffer).setUint32(0, out.length)
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
      out.set(payload, 8)
      return out
    }
    const file = box('moov', box('udta', chpl))

    const { chapters } = parseMp4Chapters(file)

    expect(chapters.length).toBe(2)
    expect(chapters[0].title).toBe('Part One')
    expect(chapters[0].startTime).toBe(0)
    expect(chapters[1].title).toBe('Part Two')
    expect(chapters[1].startTime).toBe(60000)
  })

  it('returns no chapters for data without a moov box', () => {
    expect(parseMp4Chapters(new Uint8Array(0)).chapters.length).toBe(0)
    expect(parseMp4Chapters(new Uint8Array(64)).chapters.length).toBe(0)
  })
})
