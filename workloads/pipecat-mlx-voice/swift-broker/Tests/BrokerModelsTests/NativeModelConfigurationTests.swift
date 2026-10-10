import Foundation
import Testing

@testable import BrokerModels

@Test func modelConfigurationVerifiesSpeakerArtifactHash() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("swift-broker-model-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    for directory in ["whisper", "vad", "kokoro"] {
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent(directory), withIntermediateDirectories: false)
    }
    let embedding = root.appendingPathComponent("embedding.bin")
    try Data("abc".utf8).write(to: embedding)
    let environment = modelEnvironment(
        root: root, embedding: embedding,
        hash: "852a9e4a1d3fa5635e75aa1110e0d540c16d30deed8a3029856428c528a47b25")

    let configuration = try NativeModelConfiguration(environment: environment)
    #expect(configuration.diarizerEmbeddingModel == embedding)

    var invalid = environment
    invalid["SWIFT_SPEAKER_MODEL_HASH"] = String(repeating: "0", count: 64)
    #expect(
        throws: NativeModelConfigurationError.artifactHashMismatch(
            "SWIFT_SPEAKER_MODEL_HASH")
    ) {
        try NativeModelConfiguration(environment: invalid)
    }
}

private func modelEnvironment(root: URL, embedding: URL, hash: String) -> [String: String] {
    [
        "SWIFT_MODEL_ROOT": root.path,
        "SWIFT_WHISPER_MODEL_DIRECTORY": root.appendingPathComponent("whisper").path,
        "SWIFT_VAD_MODEL_DIRECTORY": root.appendingPathComponent("vad").path,
        "SWIFT_DIARIZER_SEGMENTATION_MODEL": embedding.path,
        "SWIFT_DIARIZER_EMBEDDING_MODEL": embedding.path,
        "SWIFT_KOKORO_MODEL_DIRECTORY": root.appendingPathComponent("kokoro").path,
        "SWIFT_SPEAKER_MODEL_HASH": hash,
        "SWIFT_WHISPER_MODEL_HASH":
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "SWIFT_VAD_MODEL_HASH": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "SWIFT_DIARIZER_SEGMENTATION_HASH": hash,
        "SWIFT_KOKORO_MODEL_HASH":
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ]
}
