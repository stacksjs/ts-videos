#!/bin/sh
# Rebuilds the voice fixtures with macOS's own speech synthesiser and Apple's
# audio converter (no ffmpeg): what a voice note from the phone app (AAC in
# M4A), Safari (AAC) and a plain WAV upload look like to the server.
# The ref-*.wav files are Apple's own decodes, which the AAC decoder is
# checked against.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap "rm -rf '$tmp'" EXIT
say -o "$tmp/speech.aiff" "Felt strong today. Knee is fine."
# A WAV as Apple writes it, with its FLLR padding chunk before the samples.
afconvert -f WAVE -d LEI16@22050 -c 1 "$tmp/speech.aiff" "$here/speech-s16-22k-mono.wav"

say -o "$tmp/short.aiff" "Knee is fine."
# The phone app's voice note: AAC-LC, mono, 44.1 kHz, in M4A.
afconvert -f m4af -d aac@44100 -c 1 -b 64000 "$tmp/short.aiff" "$here/voice-aac-lc.m4a"
# Stereo at 48 kHz, as Safari and Voice Memos record.
afconvert -f m4af -d aac@48000 -c 2 -b 96000 "$tmp/short.aiff" "$here/voice-aac-stereo.m4a"
# HE-AAC (SBR), what low bitrates use.
afconvert -f m4af -d aach@44100 -c 1 -b 32000 "$tmp/short.aiff" "$here/voice-he-aac.m4a"
afconvert -f WAVE -d LEI16 "$here/voice-aac-lc.m4a" "$here/ref-voice-aac-lc.wav"
afconvert -f WAVE -d LEI16 "$here/voice-aac-stereo.m4a" "$here/ref-voice-aac-stereo.wav"
