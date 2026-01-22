import { CLI } from '@stacksjs/clapp'
import { version } from '../../../package.json'
import { Input, Output, Conversion, createSource, BufferTarget, formatDuration } from '../src'

const cli = new CLI('ts-videos')

cli
  .command('info <input>', 'Display information about a media file')
  .option('--json', 'Output as JSON', { default: false })
  .option('--verbose', 'Show detailed information', { default: false })
  .example('ts-videos info video.mp4')
  .example('ts-videos info audio.mp3 --json')
  .action(async (input: string, options: { json?: boolean, verbose?: boolean }) => {
    try {
      const source = createSource(input)
      const inputFile = new Input({ source })

      const [tracks, metadata, duration, format] = await Promise.all([
        inputFile.getTracks(),
        inputFile.getMetadata(),
        inputFile.getDuration(),
        inputFile.getFormatName(),
      ])

      if (options.json) {
        console.log(JSON.stringify({ format, duration, tracks, metadata }, null, 2))
      }
      else {
        console.log(`Format: ${format}`)
        console.log(`Duration: ${formatDuration(duration)}`)
        console.log(`\nTracks (${tracks.length}):`)

        for (const track of tracks) {
          if (track.type === 'video') {
            console.log(`  Video #${track.id}: ${track.codec} ${track.width}x${track.height}`)
            if (track.frameRate) console.log(`    Frame rate: ${track.frameRate.toFixed(2)} fps`)
            if (track.bitrate) console.log(`    Bitrate: ${Math.round(track.bitrate / 1000)} kbps`)
          }
          else if (track.type === 'audio') {
            console.log(`  Audio #${track.id}: ${track.codec} ${track.sampleRate}Hz ${track.channels}ch`)
            if (track.bitrate) console.log(`    Bitrate: ${Math.round(track.bitrate / 1000)} kbps`)
          }
          else if (track.type === 'subtitle') {
            console.log(`  Subtitle #${track.id}: ${track.codec}`)
          }
        }

        if (options.verbose && Object.keys(metadata).length > 0) {
          console.log('\nMetadata:')
          for (const [key, value] of Object.entries(metadata)) {
            if (value !== undefined) {
              console.log(`  ${key}: ${value}`)
            }
          }
        }
      }

      await inputFile.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli
  .command('convert <input> <output>', 'Convert a media file to another format')
  .option('--video-codec <codec>', 'Video codec (h264, h265, vp9, av1)')
  .option('--audio-codec <codec>', 'Audio codec (aac, mp3, opus, flac)')
  .option('--video-bitrate <bitrate>', 'Video bitrate in kbps')
  .option('--audio-bitrate <bitrate>', 'Audio bitrate in kbps')
  .option('--width <width>', 'Output width')
  .option('--height <height>', 'Output height')
  .option('--fps <fps>', 'Frame rate')
  .option('--sample-rate <rate>', 'Audio sample rate')
  .option('--channels <channels>', 'Audio channels')
  .option('--start <time>', 'Start time (seconds or HH:MM:SS)')
  .option('--end <time>', 'End time (seconds or HH:MM:SS)')
  .option('--fast-start', 'Enable fast start for MP4', { default: true })
  .option('--verbose', 'Show progress', { default: false })
  .example('ts-videos convert input.mp4 output.webm')
  .example('ts-videos convert input.wav output.mp3 --audio-bitrate 320')
  .example('ts-videos convert input.mp4 output.mp4 --video-codec h265 --start 0 --end 60')
  .action(async (input: string, output: string, options: Record<string, unknown>) => {
    try {
      console.log(`Converting ${input} to ${output}...`)

      const inputSource = createSource(input)
      const inputFile = new Input({ source: inputSource })

      const outputExt = output.split('.').pop()?.toLowerCase() ?? 'mp4'

      let outputFormat
      switch (outputExt) {
        case 'mp4':
        case 'm4v':
        case 'm4a':
          const { Mp4OutputFormat } = await import('@ts-videos/mp4')
          outputFormat = new Mp4OutputFormat({ fastStart: options.fastStart as boolean })
          break
        case 'webm':
          const { WebmOutputFormat } = await import('@ts-videos/webm')
          outputFormat = new WebmOutputFormat()
          break
        case 'mkv':
          const { MkvOutputFormat } = await import('@ts-videos/webm')
          outputFormat = new MkvOutputFormat()
          break
        case 'mp3':
          const { Mp3OutputFormat } = await import('@ts-audio/mp3')
          outputFormat = new Mp3OutputFormat()
          break
        case 'wav':
          const { WavOutputFormat } = await import('@ts-audio/wav')
          outputFormat = new WavOutputFormat()
          break
        case 'aac':
          const { AacOutputFormat } = await import('@ts-audio/aac')
          outputFormat = new AacOutputFormat()
          break
        case 'flac':
          const { FlacOutputFormat } = await import('@ts-audio/flac')
          outputFormat = new FlacOutputFormat()
          break
        case 'ogg':
        case 'oga':
          const { OggOutputFormat } = await import('@ts-audio/ogg')
          outputFormat = new OggOutputFormat()
          break
        default:
          throw new Error(`Unsupported output format: ${outputExt}`)
      }

      const outputFile = new Output({ format: outputFormat })

      const conversionOptions: Record<string, unknown> = {}
      if (options.videoCodec) conversionOptions.videoCodec = options.videoCodec
      if (options.audioCodec) conversionOptions.audioCodec = options.audioCodec
      if (options.videoBitrate) conversionOptions.videoBitrate = Number(options.videoBitrate) * 1000
      if (options.audioBitrate) conversionOptions.audioBitrate = Number(options.audioBitrate) * 1000
      if (options.width) conversionOptions.width = Number(options.width)
      if (options.height) conversionOptions.height = Number(options.height)
      if (options.fps) conversionOptions.frameRate = Number(options.fps)
      if (options.sampleRate) conversionOptions.sampleRate = Number(options.sampleRate)
      if (options.channels) conversionOptions.channels = Number(options.channels)
      if (options.start) conversionOptions.startTime = parseTime(String(options.start))
      if (options.end) conversionOptions.endTime = parseTime(String(options.end))

      const conversion = await Conversion.init({
        input: inputFile,
        output: outputFile,
        options: conversionOptions,
      })

      if (options.verbose) {
        conversion.onProgress((progress) => {
          const percent = progress.percentage.toFixed(1)
          const time = formatDuration(progress.currentTime)
          process.stdout.write(`\rProgress: ${percent}% (${time})`)
        })
      }

      const result = await conversion.execute()

      const fs = await import('node:fs/promises')
      await fs.writeFile(output, result)

      if (options.verbose) {
        console.log('')
      }
      console.log(`Successfully converted to ${output} (${result.byteLength} bytes)`)

      await conversion.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli
  .command('extract <input>', 'Extract tracks from a media file')
  .option('--video <output>', 'Extract video track to file')
  .option('--audio <output>', 'Extract audio track to file')
  .option('--track <id>', 'Extract specific track by ID')
  .option('--output <file>', 'Output file for --track option')
  .example('ts-videos extract video.mp4 --audio audio.aac')
  .example('ts-videos extract video.mkv --video video.h264 --audio audio.opus')
  .action(async (input: string, options: { video?: string, audio?: string, track?: string, output?: string }) => {
    try {
      const source = createSource(input)
      const inputFile = new Input({ source })

      const tracks = await inputFile.getTracks()

      if (options.video) {
        const videoTrack = tracks.find(t => t.type === 'video')
        if (!videoTrack) {
          throw new Error('No video track found')
        }

        console.log(`Extracting video track to ${options.video}...`)
        const packets: Uint8Array[] = []
        for await (const packet of inputFile.packets(videoTrack.id)) {
          packets.push(packet.data)
        }

        const fs = await import('node:fs/promises')
        const data = concatenateUint8Arrays(packets)
        await fs.writeFile(options.video, data)
        console.log(`Extracted ${data.byteLength} bytes`)
      }

      if (options.audio) {
        const audioTrack = tracks.find(t => t.type === 'audio')
        if (!audioTrack) {
          throw new Error('No audio track found')
        }

        console.log(`Extracting audio track to ${options.audio}...`)
        const packets: Uint8Array[] = []
        for await (const packet of inputFile.packets(audioTrack.id)) {
          packets.push(packet.data)
        }

        const fs = await import('node:fs/promises')
        const data = concatenateUint8Arrays(packets)
        await fs.writeFile(options.audio, data)
        console.log(`Extracted ${data.byteLength} bytes`)
      }

      if (options.track && options.output) {
        const trackId = Number.parseInt(options.track, 10)
        const track = tracks.find(t => t.id === trackId)
        if (!track) {
          throw new Error(`Track ${trackId} not found`)
        }

        console.log(`Extracting track ${trackId} to ${options.output}...`)
        const packets: Uint8Array[] = []
        for await (const packet of inputFile.packets(trackId)) {
          packets.push(packet.data)
        }

        const fs = await import('node:fs/promises')
        const data = concatenateUint8Arrays(packets)
        await fs.writeFile(options.output, data)
        console.log(`Extracted ${data.byteLength} bytes`)
      }

      await inputFile.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli
  .command('formats', 'List supported formats')
  .action(() => {
    console.log('Supported Input Formats:')
    console.log('  Video: mp4, mov, webm, mkv')
    console.log('  Audio: mp3, wav, aac, flac, ogg')
    console.log('')
    console.log('Supported Output Formats:')
    console.log('  Video: mp4, mov, webm, mkv')
    console.log('  Audio: mp3, wav, aac, flac, ogg')
    console.log('')
    console.log('Supported Video Codecs:')
    console.log('  h264 (AVC), h265 (HEVC), vp8, vp9, av1')
    console.log('')
    console.log('Supported Audio Codecs:')
    console.log('  aac, mp3, opus, vorbis, flac, pcm')
  })

cli.command('version', 'Show the version').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()

function parseTime(time: string): number {
  if (time.includes(':')) {
    const parts = time.split(':').map(Number)
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
    else if (parts.length === 2) {
      return parts[0] * 60 + parts[1]
    }
  }
  return Number.parseFloat(time)
}

function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.byteLength
  }
  return result
}
