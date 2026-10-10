import Foundation

public struct PCM16Wave: Sendable, Equatable {
    public let samples: [Float]
    public let sampleRate: Int

    public static func decode(
        _ data: Data,
        maximumBytes: Int = 4_194_304,
        maximumSeconds: Int = 45
    ) throws -> Self {
        guard data.count <= maximumBytes else { throw WaveError.payloadTooLarge }
        guard data.count >= 44 else { throw WaveError.truncated }
        guard data.ascii(at: 0, count: 4) == "RIFF", data.ascii(at: 8, count: 4) == "WAVE" else {
            throw WaveError.invalidContainer
        }

        let declaredSize = try data.uint32LE(at: 4)
        let (expectedSize, overflow) = Int(declaredSize).addingReportingOverflow(8)
        guard !overflow, expectedSize == data.count else { throw WaveError.inconsistentSize }

        var offset = 12
        var format: Format?
        var pcmData: Data?
        while offset < data.count {
            let (headerEnd, headerOverflow) = offset.addingReportingOverflow(8)
            guard !headerOverflow, headerEnd <= data.count else { throw WaveError.truncated }
            let chunkID = data.ascii(at: offset, count: 4)
            let chunkSize = Int(try data.uint32LE(at: offset + 4))
            let (chunkEnd, chunkOverflow) = headerEnd.addingReportingOverflow(chunkSize)
            guard !chunkOverflow, chunkEnd <= data.count else { throw WaveError.truncated }

            switch chunkID {
            case "fmt ":
                guard format == nil, chunkSize >= 16 else { throw WaveError.invalidFormat }
                format = try Format(data: data, offset: headerEnd)
            case "data":
                guard pcmData == nil else { throw WaveError.duplicateDataChunk }
                pcmData = data.subdata(in: headerEnd..<chunkEnd)
            default:
                break
            }

            let padding = chunkSize & 1
            let (nextOffset, nextOverflow) = chunkEnd.addingReportingOverflow(padding)
            guard !nextOverflow, nextOffset <= data.count else { throw WaveError.truncated }
            offset = nextOffset
        }

        guard offset == data.count, let format, let pcmData else {
            throw WaveError.missingRequiredChunk
        }
        guard
            format.audioFormat == 1, format.channels == 1, format.sampleRate == 16_000,
            format.bitsPerSample == 16, format.blockAlign == 2, format.byteRate == 32_000
        else {
            throw WaveError.unsupportedFormat
        }
        guard pcmData.count.isMultiple(of: 2) else { throw WaveError.invalidSampleData }
        let sampleCount = pcmData.count / 2
        guard sampleCount <= format.sampleRate * maximumSeconds else {
            throw WaveError.durationTooLong
        }

        var samples = [Float]()
        samples.reserveCapacity(sampleCount)
        for index in stride(from: 0, to: pcmData.count, by: 2) {
            let bits = UInt16(pcmData[index]) | (UInt16(pcmData[index + 1]) << 8)
            samples.append(Float(Int16(bitPattern: bits)) / 32_768.0)
        }
        return Self(samples: samples, sampleRate: format.sampleRate)
    }
}

public enum WaveError: Error, Equatable {
    case duplicateDataChunk
    case durationTooLong
    case inconsistentSize
    case invalidContainer
    case invalidFormat
    case invalidSampleData
    case missingRequiredChunk
    case payloadTooLarge
    case truncated
    case unsupportedFormat
}

private struct Format {
    let audioFormat: UInt16
    let channels: UInt16
    let sampleRate: Int
    let byteRate: Int
    let blockAlign: UInt16
    let bitsPerSample: UInt16

    init(data: Data, offset: Int) throws {
        audioFormat = try data.uint16LE(at: offset)
        channels = try data.uint16LE(at: offset + 2)
        sampleRate = Int(try data.uint32LE(at: offset + 4))
        byteRate = Int(try data.uint32LE(at: offset + 8))
        blockAlign = try data.uint16LE(at: offset + 12)
        bitsPerSample = try data.uint16LE(at: offset + 14)
    }
}

extension Data {
    fileprivate func ascii(at offset: Int, count: Int) -> String? {
        guard offset >= 0, count >= 0, offset <= self.count - count else { return nil }
        return String(data: self[offset..<(offset + count)], encoding: .ascii)
    }

    fileprivate func uint16LE(at offset: Int) throws -> UInt16 {
        guard offset >= 0, offset <= count - 2 else { throw WaveError.truncated }
        return UInt16(self[offset]) | (UInt16(self[offset + 1]) << 8)
    }

    fileprivate func uint32LE(at offset: Int) throws -> UInt32 {
        guard offset >= 0, offset <= count - 4 else { throw WaveError.truncated }
        return UInt32(self[offset]) | (UInt32(self[offset + 1]) << 8)
            | (UInt32(self[offset + 2]) << 16) | (UInt32(self[offset + 3]) << 24)
    }
}
