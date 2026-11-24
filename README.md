<p align="center"><img src="https://github.com/stacksjs/ts-videos/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly][commitizen-friendly]][commitizen-href]
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# ts-videos

> A media toolkit written in TypeScript. No ffmpeg, no native binaries.

ts-videos reads, inspects and rewrites audio and video containers in plain TypeScript, so it runs the same in Bun, Node and the browser. In a browser it can also re-encode video with the browser's own codecs (WebCodecs), for example to shrink a phone clip on the device before it is uploaded.

## Features

- **Read and inspect** MP4, MOV, WebM, MKV and MPEG-TS: tracks, codecs, size, rotation, frame rate, HDR and colour, metadata, chapters
- **Remux without re-encoding**: move tracks into another container, trim by time, extract a single track
- **Prepare uploads in the browser**: turn a phone clip into an upright H.264 and AAC MP4 with a JPEG poster, on the device
- **Streaming**: HLS and DASH playlists, fragmented MP4, adaptive renditions
- **Subtitles**: read, write and convert SRT, WebVTT, ASS and TTML; shift, merge and split cues
- **Metadata**: chapters, cover art, ID3, Vorbis comments, MP4 and Matroska tags
- **Codec parsing**: H.264, H.265 and AAC configuration records, codec strings for `MediaSource` and HLS
- **Colour and HDR**: HDR10, HLG and Dolby Vision detection, tone mapping and gamut conversion
- **Decode audio**: AAC (M4A), Opus (Ogg, WebM), MP3 and WAV to samples, or to the 16 kHz mono WAV speech-to-text takes, on the server too
- **Audio**: loudness (EBU R128), waveforms and audio analysis
- **CLI**: `info`, `convert` and `extract` from the terminal

## Packages

| Package | What it does |
| --- | --- |
| [`ts-videos`][npm-ts-videos] | The core: inputs, outputs, conversion, streaming, subtitles, metadata and the CLI |
| [`@ts-videos/mp4`][npm-mp4] | MP4 and MOV (QuickTime) reading and writing, fragmented MP4 |
| [`@ts-videos/webm`][npm-webm] | WebM and MKV (Matroska) reading and writing |
| [`@ts-videos/ts`][npm-ts] | MPEG-TS reading and writing |

## Install

```bash
bun add ts-videos
```

`@ts-videos/mp4` and `@ts-videos/webm` are optional dependencies of `ts-videos` and are installed with it. Add `@ts-videos/ts` yourself if you need MPEG-TS.

## Usage

### Inspect a file

An `Input` reads whichever formats you give it.

```ts
import { MovInputFormat, Mp4InputFormat } from '@ts-videos/mp4'
import { MkvInputFormat, WebmInputFormat } from '@ts-videos/webm'
import { createSource, Input } from 'ts-videos'

const input = new Input({
  source: createSource('clip.mov'),
  formats: [new Mp4InputFormat(), new MovInputFormat(), new WebmInputFormat(), new MkvInputFormat()],
})

console.log(await input.getFormatName()) // 'mov'
console.log(await input.getDuration()) // seconds

const video = await input.getPrimaryVideoTrack()
console.log(video?.codec, video?.width, video?.height, video?.rotation, video?.frameRate)

const audio = await input.getPrimaryAudioTrack()
console.log(audio?.codec, audio?.sampleRate, audio?.channels)

await input.close()
```

`createSource` takes a file path, an `http(s)` URL, a `Uint8Array`, an `ArrayBuffer`, a `Blob` or a `ReadableStream`.

### Remux into another container

`Conversion` copies the encoded tracks into the output without re-encoding them, so it is fast and lossless. It can trim by time, but it cannot change codec, size or bitrate (see [Re-encoding][re-encoding]).

```ts
import { MovInputFormat, Mp4InputFormat, Mp4OutputFormat } from '@ts-videos/mp4'
import { Conversion, createSource, Input, Output } from 'ts-videos'

const input = new Input({ source: createSource('clip.mov'), formats: [new Mp4InputFormat(), new MovInputFormat()] })
const output = new Output({ format: new Mp4OutputFormat({ fastStart: true }) })

const conversion = await Conversion.init({ input, output, options: { startTime: 0, endTime: 10 } })
conversion.onProgress(progress => console.log(`${progress.percentage.toFixed(1)}%`))

const bytes = await conversion.execute()
await Bun.write('clip.mp4', bytes)
await conversion.close()
```

### Prepare a video for upload (browser)

`prepareVideoForUpload` turns a picked clip into an MP4 that fits 1280×720 at up to 30 fps: H.264 and AAC, upright, SDR, with its index at the front so it can start playing before it has fully arrived, plus a JPEG poster. It runs on the device with the browser's codecs, so nothing is sent anywhere. A clip that already fits is returned unchanged.

```ts
import { canPrepareVideoForUpload, prepareVideoForUpload, UploadVideoTooLargeError } from 'ts-videos'

async function prepare(file: File): Promise<Blob> {
  if (!canPrepareVideoForUpload())
    return file // no WebCodecs here: send the original

  try {
    const result = await prepareVideoForUpload(file, {
      maxOutputBytes: 100 * 1024 * 1024,
      onProgress: progress => console.log(progress),
    })
    return result.video // result.poster is a JPEG Blob
  }
  catch (error) {
    if (error instanceof UploadVideoTooLargeError)
      throw error // the clip is too long for the limit
    return file // the browser could not decode or encode it: send the original
  }
}
```

### Decode audio

`decodeAudioToWav` turns a voice note into what a speech-to-text service takes: a 16-bit WAV, 16 kHz mono unless asked otherwise. It reads the phone app's and Safari's M4A (AAC), Chrome's WebM and Firefox's and WhatsApp's Ogg (Opus), MP3 and WAV, all in TypeScript.

```ts
import { decodeAudio, decodeAudioToWav } from 'ts-videos'

const wav = await decodeAudioToWav(upload, { maxBytes: 12 * 1024 * 1024, maxDurationSeconds: 300 })
// wav.audio is the WAV file's bytes; wav.durationSeconds how long it plays

const { sampleRate, channels } = await decodeAudio('interview.mp3') // one Float32Array per channel
```

The decoders cover AAC-LC (and the AAC-LC core of HE-AAC), Opus in all three modes, MP3 (MPEG-1, MPEG-2 and MPEG 2.5 Layer III) and PCM. The encoder's delay and padding are trimmed when the file records them, so the samples start and end where the sound does. Other codecs, such as Vorbis and FLAC, throw `UnsupportedAudioCodecError`; `registerAudioDecoder` adds one. Audio over `maxDurationSeconds` throws `AudioTooLongError` as soon as the decoded part is longer.

### Subtitles

```ts
import { convertSubtitles, generateSubtitles, parseSubtitles, shiftSubtitles } from 'ts-videos'

const srt = `1
00:00:01,000 --> 00:00:03,000
Hello there
`

const vtt = convertSubtitles(srt, 'vtt')

const later = shiftSubtitles(parseSubtitles(srt), 2000) // two seconds later
console.log(generateSubtitles(later, 'srt'))
```

## Re-encoding

ts-videos has no video encoders or decoders of its own. Re-encoding uses WebCodecs (`VideoEncoder` and `VideoDecoder`), which browsers provide and Bun and Node do not. In short:

| | Browser | Bun / Node |
| --- | --- | --- |
| Inspect, remux, trim, extract | ✅ | ✅ |
| Decode audio (AAC, Opus, MP3, WAV) | ✅ | ✅ |
| Playlists, subtitles, metadata, chapters | ✅ | ✅ |
| Re-encode, resize, change bitrate | ✅ | ❌ |
| Posters and preview thumbnails | ✅ | ❌ |

Use `canPrepareVideoForUpload()` or `detectVideoRuntimeCapabilities()` to check at runtime.

## CLI

The `ts-videos` package installs a `ts-videos` command.

```bash
ts-videos info video.mp4                  # format, duration and tracks
ts-videos info video.mp4 --json           # the same, as JSON
ts-videos convert input.mov output.mp4    # remux into another container
ts-videos convert input.mp4 clip.mp4 --start 0:10 --end 0:20
ts-videos extract video.mp4 --audio audio.aac
ts-videos --help
```

Run it without installing with `bunx ts-videos info video.mp4`. Like `Conversion`, `convert` copies the encoded tracks, so options that need re-encoding (`--video-codec`, `--width`, `--video-bitrate` and so on) only work where WebCodecs is available.

## Testing

```bash
bun test
```

## Changelog

Please see our [releases][releases] page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide][contributing-guide] for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub][discussions-on-github]

For casual chit-chat with others using this package:

[Join the Stacks Discord Server][join-the-stacks-discord-server]

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where `ts-videos` is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains][jetbrains]
- [The Solana Foundation][the-solana-foundation]

## Credits

- [Chris Breuer][chris-breuer]
- [All Contributors][all-contributors]

## License

The MIT License (MIT). Please see [LICENSE][license] for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/ts-videos?style=flat-square
[npm-version-href]: https://npmjs.com/package/ts-videos
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/ts-videos/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/ts-videos/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/ts-videos/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/ts-videos -->
[commitizen-friendly]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[releases]: https://github.com/stacksjs/ts-videos/releases
[contributing-guide]: https://github.com/stacksjs/contributing
[discussions-on-github]: https://github.com/stacksjs/stacks/discussions
[join-the-stacks-discord-server]: https://stacksjs.com/discord
[jetbrains]: https://www.jetbrains.com/
[the-solana-foundation]: https://solana.com/
[chris-breuer]: https://github.com/chrisbbreuer
[all-contributors]: https://github.com/stacksjs/ts-videos/graphs/contributors
[license]: https://github.com/stacksjs/ts-videos/tree/main/LICENSE.md
[commitizen-href]: http://commitizen.github.io/cz-cli/

<!-- Packages -->
[npm-ts-videos]: https://www.npmjs.com/package/ts-videos
[npm-mp4]: https://www.npmjs.com/package/@ts-videos/mp4
[npm-webm]: https://www.npmjs.com/package/@ts-videos/webm
[npm-ts]: https://www.npmjs.com/package/@ts-videos/ts
[re-encoding]: #re-encoding
