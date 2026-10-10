import Foundation

public struct SpeakerProfile: Codable, Sendable, Equatable {
    public let modelIdentifier: String
    public let modelHash: String
    public let threshold: Float
    public let embedding: [Float]
    public let enrollmentVersion: Int

    public init(
        modelIdentifier: String,
        modelHash: String,
        threshold: Float,
        embedding: [Float],
        enrollmentVersion: Int = 1
    ) throws {
        guard !modelIdentifier.isEmpty, !modelHash.isEmpty, threshold >= 0, threshold <= 1,
            !embedding.isEmpty, embedding.count <= 4_096,
            embedding.allSatisfy(\.isFinite), abs(Self.magnitude(embedding) - 1) < 0.01
        else { throw VoicePipelineError.invalidProfile }
        self.modelIdentifier = modelIdentifier
        self.modelHash = modelHash
        self.threshold = threshold
        self.embedding = embedding
        self.enrollmentVersion = enrollmentVersion
    }

    private static func magnitude(_ values: [Float]) -> Float {
        values.reduce(0) { $0 + $1 * $1 }.squareRoot()
    }
}

public protocol SpeakerProfileStore: Sendable {
    func load() async throws -> SpeakerProfile?
    func save(_ profile: SpeakerProfile) async throws
    func delete() async throws
}

public protocol VoiceActivityDetecting: Sendable {
    func containsSufficientSpeech(_ samples: [Float], sampleRate: Int) async throws -> Bool
}

public protocol SpeakerEmbedding: Sendable {
    var modelIdentifier: String { get }
    var modelHash: String { get }
    func embedding(for samples: [Float], sampleRate: Int) async throws -> [Float]
}

public protocol SpeechTranscribing: Sendable {
    func transcribe(samples: [Float], sampleRate: Int) async throws -> String
}

public protocol SpeechSynthesizing: Sendable {
    func synthesize(text: String, speed: Float) async throws -> PCMOutput
}

public struct PCMOutput: Sendable, Equatable {
    public let bytes: Data
    public let sampleRate: Int

    public init(bytes: Data, sampleRate: Int) {
        self.bytes = bytes
        self.sampleRate = sampleRate
    }
}

public actor VoicePipeline {
    private let activityDetector: any VoiceActivityDetecting
    private let speakerEncoder: any SpeakerEmbedding
    private let transcriber: any SpeechTranscribing
    private let profileStore: any SpeakerProfileStore

    public init(
        activityDetector: any VoiceActivityDetecting,
        speakerEncoder: any SpeakerEmbedding,
        transcriber: any SpeechTranscribing,
        profileStore: any SpeakerProfileStore
    ) {
        self.activityDetector = activityDetector
        self.speakerEncoder = speakerEncoder
        self.transcriber = transcriber
        self.profileStore = profileStore
    }

    public func transcribeOwner(_ wave: PCM16Wave) async throws -> String {
        guard let profile = try await profileStore.load() else {
            throw VoicePipelineError.speakerProfileMissing
        }
        guard
            profile.modelIdentifier == speakerEncoder.modelIdentifier,
            profile.modelHash == speakerEncoder.modelHash,
            try await activityDetector.containsSufficientSpeech(
                wave.samples, sampleRate: wave.sampleRate)
        else { return "" }

        let candidate = try await speakerEncoder.embedding(
            for: wave.samples, sampleRate: wave.sampleRate)
        guard cosineSimilarity(profile.embedding, candidate) >= profile.threshold else { return "" }
        return try await transcriber.transcribe(samples: wave.samples, sampleRate: wave.sampleRate)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public func cosineSimilarity(_ lhs: [Float], _ rhs: [Float]) -> Float {
    guard lhs.count == rhs.count, !lhs.isEmpty else { return -.infinity }
    var dot: Float = 0
    var lhsMagnitude: Float = 0
    var rhsMagnitude: Float = 0
    for (left, right) in zip(lhs, rhs) {
        guard left.isFinite, right.isFinite else { return -.infinity }
        dot += left * right
        lhsMagnitude += left * left
        rhsMagnitude += right * right
    }
    guard lhsMagnitude > 0, rhsMagnitude > 0 else { return -.infinity }
    return dot / (lhsMagnitude.squareRoot() * rhsMagnitude.squareRoot())
}

public enum VoicePipelineError: Error, Equatable {
    case invalidProfile
    case speakerProfileMissing
}
