# Changelog

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.3.1...v0.4.0)

## 🚀 Features

- **audio**: decode MP3 in TypeScript, no ffmpeg ([7c77742](https://github.com/stacksjs/ts-videos/commit/7c77742)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.4.0 ([a1a6c52](https://github.com/stacksjs/ts-videos/commit/a1a6c52)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.3.0...v0.3.1)

## 🐛 Bug Fixes

- **deps**: declare ts-gif, which ts-videos imports ([05138b6](https://github.com/stacksjs/ts-videos/commit/05138b6)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.3.1 ([31ad609](https://github.com/stacksjs/ts-videos/commit/31ad609)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.2.4...v0.3.0)

## 🚀 Features

- **audio**: decode Opus in TypeScript, from Ogg and WebM, no ffmpeg ([847c010](https://github.com/stacksjs/ts-videos/commit/847c010)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **audio**: decode AAC and WAV to samples and speech-ready WAV, no ffmpeg ([87dde45](https://github.com/stacksjs/ts-videos/commit/87dde45)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **mp4**: read where an audio track's sound starts and ends ([e06350f](https://github.com/stacksjs/ts-videos/commit/e06350f)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.3.0 ([682e750](https://github.com/stacksjs/ts-videos/commit/682e750)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.2.3...v0.2.4)

## 📚 Documentation

- rewrite the README for ts-videos ([8d2630c](https://github.com/stacksjs/ts-videos/commit/8d2630c)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.2.4 ([52cf387](https://github.com/stacksjs/ts-videos/commit/52cf387)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.2.2...v0.2.3)

## 🧹 Chores

- release v0.2.3 ([c4a07b9](https://github.com/stacksjs/ts-videos/commit/c4a07b9)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.2.1...v0.2.2)

## 🚀 Features

- **transcode**: refuse a clip too long for a size limit up front ([bdcc904](https://github.com/stacksjs/ts-videos/commit/bdcc904)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **config**: no top-level await, so a page bundle can hold a muxer ([857a3f6](https://github.com/stacksjs/ts-videos/commit/857a3f6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **transcode**: the last frame lasts as long as the one before it ([f8b3b0a](https://github.com/stacksjs/ts-videos/commit/f8b3b0a)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.2 ([ce0aa5d](https://github.com/stacksjs/ts-videos/commit/ce0aa5d)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.2.0...v0.2.1)

## 🚀 Features

- **transcode**: prepare a picked clip for upload in the browser ([986dce0](https://github.com/stacksjs/ts-videos/commit/986dce0)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **webm**: keep every block when tracks are read in turn ([49e83ff](https://github.com/stacksjs/ts-videos/commit/49e83ff)) _(by Chris <chrisbreuer93@gmail.com>)_
- **mp4**: write MP4s whose second track, rotation and AAC play ([c9cc614](https://github.com/stacksjs/ts-videos/commit/c9cc614)) _(by Chris <chrisbreuer93@gmail.com>)_
- **cli**: load the container readers so info, convert and extract can open files ([910ece2](https://github.com/stacksjs/ts-videos/commit/910ece2)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **mp4**: read 44.1 and 48 kHz audio sample rates as positive ([69fbdc3](https://github.com/stacksjs/ts-videos/commit/69fbdc3)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.2.1 ([7e74849](https://github.com/stacksjs/ts-videos/commit/7e74849)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.1.4...v0.2.0)

## 💥 Breaking Changes

- refactor!: remove ffmpeg-only helpers and fixture script ([6fb6de6](https://github.com/stacksjs/ts-videos/commit/6fb6de6)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🐛 Bug Fixes

- **mp4**: read rotation, QuickTime colour and frame rate from MOV/MP4 ([da6c0b1](https://github.com/stacksjs/ts-videos/commit/da6c0b1)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧪 Tests

- **mp4**: an iPhone-style HLG portrait clip reads as portrait, HLG, 60 fps ([feee0ad](https://github.com/stacksjs/ts-videos/commit/feee0ad)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🤖 Continuous Integration

- build the workspace packages before typecheck and tests ([30e059b](https://github.com/stacksjs/ts-videos/commit/30e059b)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.2.0 ([fc21b5a](https://github.com/stacksjs/ts-videos/commit/fc21b5a)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.1.3...v0.1.4)

## 🤖 Continuous Integration

- allow trusted publishing for video releases ([7b16399](https://github.com/stacksjs/ts-videos/commit/7b16399)) _(by Chris Breuer <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.1.4 ([505415e](https://github.com/stacksjs/ts-videos/commit/505415e)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _Chris Breuer <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.1.2...v0.1.3)

## 🐛 Bug Fixes

- **mp4**: make chapters readable in silent videos ([19ed1ea](https://github.com/stacksjs/ts-videos/commit/19ed1ea)) _(by Chris Breuer <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.1.3 ([be25d06](https://github.com/stacksjs/ts-videos/commit/be25d06)) _(by Chris <chrisbreuer93@gmail.com>)_
- run @stacksjs/logsmith, not the unrelated npm 'logsmith' ([73f1a18](https://github.com/stacksjs/ts-videos/commit/73f1a18)) _(by Chris <chrisbreuer93@gmail.com>)_
- release through @stacksjs/bumpx, not the unrelated npm 'bumpx' ([d987d46](https://github.com/stacksjs/ts-videos/commit/d987d46)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _Chris Breuer <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.1.1...v0.1.2)

## 🐛 Bug Fixes

- **build**: emit valid declarations with bun-plugin-dtsx 0.11 ([f0b3464](https://github.com/stacksjs/ts-videos/commit/f0b3464)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- link the community as stacksjs.com/discord ([62416c1](https://github.com/stacksjs/ts-videos/commit/62416c1)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.1.2 ([48aae85](https://github.com/stacksjs/ts-videos/commit/48aae85)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/ts-videos/compare/v0.1.0...v0.1.1)

## 🤖 Continuous Integration

- build video packages before publish ([dd6de24](https://github.com/stacksjs/ts-videos/commit/dd6de24)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.1.1 ([d6b522e](https://github.com/stacksjs/ts-videos/commit/d6b522e)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
