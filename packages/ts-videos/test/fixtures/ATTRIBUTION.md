# Fixture provenance

The MP4 and M4A files in this directory are deterministic, locally generated test fixtures.

- `generate.swift` creates the H.264, HEVC Main10, landscape, portrait, and silent source videos with Apple AVFoundation.
- `tone.m4a` is a generated 440 Hz stereo tone encoded with the native macOS audio converter.
- `generate-muxed.ts` combines those generated tracks through ts-videos itself to create the single-audio and multi-audio MP4 fixtures.
- `captions.vtt` and `chapters.json` are hand-authored test metadata.

No third-party media is included.
