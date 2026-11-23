import { describe, expect, test } from 'bun:test'

const cli = new URL('../bin/cli.ts', import.meta.url).pathname
const fixture = (name: string): string => new URL(`fixtures/${name}`, import.meta.url).pathname

async function info(name: string): Promise<{ format: string, tracks: { type: string, codec: string }[] }> {
  const proc = Bun.spawn(['bun', cli, 'info', fixture(name), '--json'], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(stderr).toBe('')
  expect(exitCode).toBe(0)
  return JSON.parse(stdout)
}

describe('ts-videos CLI', () => {
  // The container readers live in @ts-videos/mp4 and @ts-videos/webm; the CLI
  // has to hand them to Input, or every file reads as an unknown format.
  test('info reads an MP4', async () => {
    const result = await info('landscape.mp4')
    expect(result.format).toBe('mp4')
    expect(result.tracks.map(track => `${track.type}:${track.codec}`)).toEqual(['video:h264', 'audio:aac'])
  })

  test('info reads a QuickTime MOV', async () => {
    const result = await info('hlg-portrait.mov')
    expect(result.format).toBe('mov')
    expect(result.tracks.map(track => `${track.type}:${track.codec}`)).toEqual(['video:h265', 'audio:aac'])
  })
})
