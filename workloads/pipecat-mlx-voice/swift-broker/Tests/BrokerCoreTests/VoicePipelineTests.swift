import Foundation
import Testing

@testable import BrokerCore

@Test func pipelineFailsClosedWithoutEnrollment() async {
    let pipeline = VoicePipeline(
        activityDetector: FakeVAD(), speakerEncoder: FakeEncoder(value: [1, 0]),
        transcriber: FakeTranscriber(), profileStore: MemoryStore(profile: nil)
    )
    await #expect(throws: VoicePipelineError.speakerProfileMissing) {
        try await pipeline.transcribeOwner(PCM16Wave(samples: [0.1], sampleRate: 16_000))
    }
}

@Test func pipelineRejectsDifferentSpeakerBeforeTranscription() async throws {
    let profile = try SpeakerProfile(
        modelIdentifier: "cam++", modelHash: "sha256:test", threshold: 0.75,
        embedding: [1, 0])
    let transcriber = FakeTranscriber()
    let pipeline = VoicePipeline(
        activityDetector: FakeVAD(), speakerEncoder: FakeEncoder(value: [0, 1]),
        transcriber: transcriber, profileStore: MemoryStore(profile: profile)
    )
    let text = try await pipeline.transcribeOwner(PCM16Wave(samples: [0.1], sampleRate: 16_000))
    #expect(text.isEmpty)
    #expect(await transcriber.calls == 0)
}

@Test func pipelineTranscribesMatchingSpeaker() async throws {
    let profile = try SpeakerProfile(
        modelIdentifier: "cam++", modelHash: "sha256:test", threshold: 0.75,
        embedding: [1, 0])
    let pipeline = VoicePipeline(
        activityDetector: FakeVAD(), speakerEncoder: FakeEncoder(value: [0.9, 0.1]),
        transcriber: FakeTranscriber(), profileStore: MemoryStore(profile: profile)
    )
    let text = try await pipeline.transcribeOwner(PCM16Wave(samples: [0.1], sampleRate: 16_000))
    #expect(text == "precise response")
}

private struct FakeVAD: VoiceActivityDetecting {
    func containsSufficientSpeech(_ samples: [Float], sampleRate: Int) async throws -> Bool { true }
}

private struct FakeEncoder: SpeakerEmbedding {
    let value: [Float]
    let modelIdentifier = "cam++"
    let modelHash = "sha256:test"
    func embedding(for samples: [Float], sampleRate: Int) async throws -> [Float] { value }
}

private actor FakeTranscriber: SpeechTranscribing {
    private(set) var calls = 0
    func transcribe(samples: [Float], sampleRate: Int) async throws -> String {
        calls += 1
        return " precise response "
    }
}

private actor MemoryStore: SpeakerProfileStore {
    private var profile: SpeakerProfile?
    init(profile: SpeakerProfile?) { self.profile = profile }
    func load() -> SpeakerProfile? { profile }
    func save(_ profile: SpeakerProfile) { self.profile = profile }
    func delete() { profile = nil }
}
