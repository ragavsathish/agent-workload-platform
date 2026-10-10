import Foundation
import Testing

@testable import BrokerCore

@Test func decodesStrictPCM16Wave() throws {
    let wave = makeWave(samples: [0, 16_384, -16_384])
    let decoded = try PCM16Wave.decode(wave)
    #expect(decoded.sampleRate == 16_000)
    #expect(decoded.samples == [0, 0.5, -0.5])
}

@Test func rejectsInconsistentRiffSize() {
    var wave = makeWave(samples: [0])
    wave[4] = 0
    #expect(throws: WaveError.inconsistentSize) { try PCM16Wave.decode(wave) }
}

@Test func rejectsStereo() {
    var wave = makeWave(samples: [0])
    wave[22] = 2
    #expect(throws: WaveError.unsupportedFormat) { try PCM16Wave.decode(wave) }
}

private func makeWave(samples: [Int16]) -> Data {
    var data = Data("RIFF".utf8)
    append(UInt32(36 + samples.count * 2), to: &data)
    data.append(Data("WAVEfmt ".utf8))
    append(UInt32(16), to: &data)
    append(UInt16(1), to: &data)
    append(UInt16(1), to: &data)
    append(UInt32(16_000), to: &data)
    append(UInt32(32_000), to: &data)
    append(UInt16(2), to: &data)
    append(UInt16(16), to: &data)
    data.append(Data("data".utf8))
    append(UInt32(samples.count * 2), to: &data)
    for sample in samples { append(UInt16(bitPattern: sample), to: &data) }
    return data
}

private func append<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var littleEndian = value.littleEndian
    withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
}
