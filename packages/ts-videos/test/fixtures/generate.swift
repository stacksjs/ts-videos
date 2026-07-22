import AVFoundation
import CoreVideo
import Foundation
import VideoToolbox

struct Fixture {
  let name: String
  let width: Int
  let height: Int
  let codec: AVVideoCodecType
  let hdr: Bool
}

let fixtures = [
  Fixture(name: "landscape-video.mp4", width: 320, height: 180, codec: .h264, hdr: false),
  Fixture(name: "portrait-video.mp4", width: 180, height: 320, codec: .h264, hdr: false),
  Fixture(name: "silent-video.mp4", width: 256, height: 144, codec: .h264, hdr: false),
  Fixture(name: "hdr-video.mp4", width: 320, height: 180, codec: .hevc, hdr: true),
]

func makeFixture(_ fixture: Fixture) throws {
  let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent(fixture.name)
  try? FileManager.default.removeItem(at: output)
  let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
  var compression: [String: Any] = [
    AVVideoAverageBitRateKey: 300_000,
    AVVideoExpectedSourceFrameRateKey: 30,
    AVVideoMaxKeyFrameIntervalKey: 30,
  ]
  if fixture.hdr {
    compression[AVVideoProfileLevelKey] = kVTProfileLevel_HEVC_Main10_AutoLevel
  }
  else {
    compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
  }
  var settings: [String: Any] = [
    AVVideoCodecKey: fixture.codec,
    AVVideoWidthKey: fixture.width,
    AVVideoHeightKey: fixture.height,
    AVVideoCompressionPropertiesKey: compression,
  ]
  if fixture.hdr {
    settings[AVVideoColorPropertiesKey] = [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_2020,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_SMPTE_ST_2084_PQ,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_2020,
    ]
  }
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
  input.expectsMediaDataInRealTime = false
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: fixture.width,
    kCVPixelBufferHeightKey as String: fixture.height,
  ])
  guard writer.canAdd(input) else { throw NSError(domain: "fixtures", code: 1) }
  writer.add(input)
  guard writer.startWriting() else { throw writer.error ?? NSError(domain: "fixtures", code: 2) }
  writer.startSession(atSourceTime: .zero)

  for frame in 0..<60 {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
    var pixelBuffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool,
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer) == kCVReturnSuccess,
          let pixelBuffer
    else { throw NSError(domain: "fixtures", code: 3) }
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    let base = CVPixelBufferGetBaseAddress(pixelBuffer)!.assumingMemoryBound(to: UInt8.self)
    let stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
    for y in 0..<fixture.height {
      for x in 0..<fixture.width {
        let offset = y * stride + x * 4
        base[offset] = UInt8((x + frame * 3) % 256)
        base[offset + 1] = UInt8((y * 2 + frame * 2) % 256)
        base[offset + 2] = UInt8((x + y + frame * 4) % 256)
        base[offset + 3] = 255
      }
    }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
    guard adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30)) else {
      throw writer.error ?? NSError(domain: "fixtures", code: 4)
    }
  }
  input.markAsFinished()
  let semaphore = DispatchSemaphore(value: 0)
  writer.finishWriting { semaphore.signal() }
  semaphore.wait()
  guard writer.status == .completed else { throw writer.error ?? NSError(domain: "fixtures", code: 5) }
}

do {
  for fixture in fixtures { try makeFixture(fixture) }
}
catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
