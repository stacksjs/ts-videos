import { Mp4InputFormat, Mp4OutputFormat } from '@ts-videos/mp4'
import type { AudioTrack, EncodedPacket, VideoTrack } from '../../src/types'
import { Input } from '../../src/input'
import { Output } from '../../src/output'

async function packets(input: Input, trackId: number): Promise<EncodedPacket[]> {
  const result: EncodedPacket[] = []
  for await (const packet of input.packets(trackId)) result.push(packet)
  return result
}

async function generate(name: string, audioTracks: number): Promise<void> {
  const videoInput = new Input(new URL('landscape-video.mp4', import.meta.url).pathname)
  const audioInput = new Input(new URL('tone.m4a', import.meta.url).pathname)
  videoInput.setFormats([new Mp4InputFormat()])
  audioInput.setFormats([new Mp4InputFormat()])
  const videoTrack = await videoInput.getPrimaryVideoTrack() as VideoTrack
  const audioTrack = await audioInput.getPrimaryAudioTrack() as AudioTrack
  const output = new Output(new Mp4OutputFormat({ fastStart: true }))
  const outputVideo = output.addVideoTrack({
    codec: videoTrack.codec,
    width: videoTrack.width,
    height: videoTrack.height,
    frameRate: videoTrack.frameRate,
    bitrate: videoTrack.bitrate,
    codecDescription: videoTrack.codecDescription,
    colorSpace: videoTrack.colorSpace,
  })
  const outputAudio = Array.from({ length: audioTracks }, () => output.addAudioTrack({
    codec: audioTrack.codec,
    sampleRate: audioTrack.sampleRate,
    channels: audioTrack.channels,
    bitrate: audioTrack.bitrate,
    codecDescription: audioTrack.codecDescription,
  }))
  const videoPackets = await packets(videoInput, videoTrack.id)
  const audioPackets = await packets(audioInput, audioTrack.id)
  for (const packet of videoPackets) await output.writeVideoPacket(outputVideo, packet)
  for (const packet of audioPackets) {
    for (const track of outputAudio) await output.writeAudioPacket(track, packet)
  }
  await Bun.write(new URL(name, import.meta.url), await output.finalize())
  await videoInput.close()
  await audioInput.close()
}

async function main(): Promise<void> {
  await generate('landscape.mp4', 1)
  await generate('multiple-audio.mp4', 2)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
