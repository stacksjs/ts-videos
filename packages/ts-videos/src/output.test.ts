import { describe, expect, it } from 'bun:test'
import type { Target } from './writer'
import type { EncodedPacket } from './types'
import type { OutputAudioTrack, OutputSubtitleTrack, OutputVideoTrack } from './muxer'
import { Muxer, OutputFormat } from './muxer'
import { Output } from './output'

class FixtureMuxer extends Muxer {
  get formatName(): string { return 'fixture' }
  get mimeType(): string { return 'application/octet-stream' }
  protected async writeHeader(): Promise<void> { await this.writer.writeBytes(new Uint8Array([1])) }
  protected async writeVideoPacket(_track: OutputVideoTrack, packet: EncodedPacket): Promise<void> { await this.writer.writeBytes(packet.data) }
  protected async writeAudioPacket(_track: OutputAudioTrack, packet: EncodedPacket): Promise<void> { await this.writer.writeBytes(packet.data) }
  protected async writeSubtitlePacket(_track: OutputSubtitleTrack, packet: EncodedPacket): Promise<void> { await this.writer.writeBytes(packet.data) }
  protected async writeTrailer(): Promise<void> { await this.writer.writeBytes(new Uint8Array([3])) }
}

class FixtureFormat extends OutputFormat {
  get name(): string { return 'fixture' }
  get mimeType(): string { return 'application/octet-stream' }
  get extension(): string { return 'bin' }
  createMuxer(target: Target): Muxer { return new FixtureMuxer(target) }
}

describe('Output', () => {
  it('returns finalized bytes from its default buffer target', async () => {
    const output = new Output(new FixtureFormat())
    const track = output.addAudioTrack({ codec: 'aac', sampleRate: 48_000, channels: 2 })
    await output.writeAudioPacket(track, { data: new Uint8Array([2]), timestamp: 0, isKeyframe: true })
    expect(await output.finalize()).toEqual(new Uint8Array([1, 2, 3]))
  })
})
