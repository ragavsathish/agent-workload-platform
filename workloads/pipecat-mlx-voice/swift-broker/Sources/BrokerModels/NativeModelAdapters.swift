import BrokerCore
import Crypto
import Foundation

#if os(macOS)
    import CoreML
    import FluidAudio
    import KokoroCoreML
    import WhisperKit
#endif

public struct NativeModelConfiguration: Sendable, Equatable {
    public let modelRoot: URL
    public let whisperModelDirectory: URL
    public let vadModelDirectory: URL
    public let diarizerSegmentationModel: URL
    public let diarizerEmbeddingModel: URL
    public let kokoroModelDirectory: URL
    public let speakerModelIdentifier: String
    public let speakerModelHash: String
    public let language: String
    public let voice: String
    public let minimumSpeechSeconds: Double

    public init(environment: [String: String]) throws {
        let root = try Self.requiredPath(
            "SWIFT_MODEL_ROOT", environment: environment, kind: .directory)
        modelRoot = root
        whisperModelDirectory = try Self.requiredPath(
            "SWIFT_WHISPER_MODEL_DIRECTORY", environment: environment, kind: .directory,
            beneath: root)
        vadModelDirectory = try Self.requiredPath(
            "SWIFT_VAD_MODEL_DIRECTORY", environment: environment, kind: .directory, beneath: root)
        diarizerSegmentationModel = try Self.requiredPath(
            "SWIFT_DIARIZER_SEGMENTATION_MODEL", environment: environment, kind: .item,
            beneath: root)
        diarizerEmbeddingModel = try Self.requiredPath(
            "SWIFT_DIARIZER_EMBEDDING_MODEL", environment: environment, kind: .item, beneath: root)
        kokoroModelDirectory = try Self.requiredPath(
            "SWIFT_KOKORO_MODEL_DIRECTORY", environment: environment, kind: .directory,
            beneath: root)

        speakerModelIdentifier = environment["SWIFT_SPEAKER_MODEL_ID"] ?? "FluidAudio-CAM++"
        speakerModelHash = environment["SWIFT_SPEAKER_MODEL_HASH"] ?? ""
        language = environment["STT_LANGUAGE"] ?? "en"
        voice = environment["SWIFT_TTS_VOICE"] ?? environment["MLX_TTS_VOICE"] ?? "af_heart"
        guard !speakerModelIdentifier.isEmpty, Self.isSHA256(speakerModelHash),
            !language.isEmpty, language.utf8.count <= 16, !voice.isEmpty, voice.utf8.count <= 64
        else { throw NativeModelConfigurationError.invalidMetadata }
        try Self.verifyArtifact(
            whisperModelDirectory, expected: environment["SWIFT_WHISPER_MODEL_HASH"],
            variable: "SWIFT_WHISPER_MODEL_HASH")
        try Self.verifyArtifact(
            vadModelDirectory, expected: environment["SWIFT_VAD_MODEL_HASH"],
            variable: "SWIFT_VAD_MODEL_HASH")
        try Self.verifyArtifact(
            diarizerSegmentationModel,
            expected: environment["SWIFT_DIARIZER_SEGMENTATION_HASH"],
            variable: "SWIFT_DIARIZER_SEGMENTATION_HASH")
        try Self.verifyArtifact(
            diarizerEmbeddingModel, expected: speakerModelHash,
            variable: "SWIFT_SPEAKER_MODEL_HASH")
        try Self.verifyArtifact(
            kokoroModelDirectory, expected: environment["SWIFT_KOKORO_MODEL_HASH"],
            variable: "SWIFT_KOKORO_MODEL_HASH")

        let speech = Double(environment["SWIFT_MINIMUM_SPEECH_SECONDS"] ?? "0.4")
        guard let speech, (0.2...3.0).contains(speech) else {
            throw NativeModelConfigurationError.invalidMinimumSpeechDuration
        }
        minimumSpeechSeconds = speech
    }

    private enum PathKind { case directory, item }

    private static func requiredPath(
        _ variable: String,
        environment: [String: String],
        kind: PathKind,
        beneath root: URL? = nil
    ) throws -> URL {
        guard let raw = environment[variable], raw.hasPrefix("/") else {
            throw NativeModelConfigurationError.missingOrRelativePath(variable)
        }
        let original = URL(fileURLWithPath: raw).standardizedFileURL
        let resolved = original.resolvingSymlinksInPath().standardizedFileURL
        guard original.path == resolved.path else {
            throw NativeModelConfigurationError.symbolicLinkNotAllowed(variable)
        }
        if let root {
            let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
            guard resolved.path.hasPrefix(prefix) else {
                throw NativeModelConfigurationError.pathOutsideModelRoot(variable)
            }
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
            kind == .item || isDirectory.boolValue
        else { throw NativeModelConfigurationError.pathNotFound(variable) }
        if isDirectory.boolValue {
            let keys: [URLResourceKey] = [.isSymbolicLinkKey]
            guard
                let enumerator = FileManager.default.enumerator(
                    at: resolved, includingPropertiesForKeys: keys, options: [])
            else { throw NativeModelConfigurationError.pathNotFound(variable) }
            for case let child as URL in enumerator {
                if try child.resourceValues(forKeys: Set(keys)).isSymbolicLink == true {
                    throw NativeModelConfigurationError.symbolicLinkNotAllowed(variable)
                }
            }
        }
        return resolved
    }

    private static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64
            && value.utf8.allSatisfy {
                (48...57).contains($0) || (97...102).contains($0)
            }
    }

    private static func verifyArtifact(
        _ url: URL, expected: String?, variable: String
    ) throws {
        guard let expected, isSHA256(expected) else {
            throw NativeModelConfigurationError.invalidArtifactHash(variable)
        }
        guard try sha256Tree(url) == expected else {
            throw NativeModelConfigurationError.artifactHashMismatch(variable)
        }
    }

    /// Hashes a file, or a directory as sorted relative-path bytes followed by file bytes.
    /// Symbolic links anywhere in the artifact are rejected.
    private static func sha256Tree(_ root: URL) throws -> String {
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]
        let rootValues = try root.resourceValues(forKeys: keys)
        let urls: [URL]
        if rootValues.isDirectory == true {
            guard
                let enumerator = FileManager.default.enumerator(
                    at: root, includingPropertiesForKeys: Array(keys),
                    options: [])
            else { throw NativeModelConfigurationError.pathNotFound(root.path) }
            urls = enumerator.compactMap { $0 as? URL }.sorted { $0.path < $1.path }
        } else {
            urls = [root]
        }

        var hasher = SHA256()
        for url in urls {
            let values = try url.resourceValues(forKeys: keys)
            guard values.isSymbolicLink != true else {
                throw NativeModelConfigurationError.symbolicLinkNotAllowed(url.path)
            }
            guard values.isRegularFile == true else { continue }
            let relative = url.path.dropFirst(root.deletingLastPathComponent().path.count)
            hasher.update(data: Data(relative.utf8))
            hasher.update(data: Data([0]))
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
                hasher.update(data: chunk)
            }
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

public enum NativeModelConfigurationError: Error, Equatable {
    case artifactHashMismatch(String)
    case invalidArtifactHash(String)
    case invalidMetadata
    case invalidMinimumSpeechDuration
    case missingOrRelativePath(String)
    case pathNotFound(String)
    case pathOutsideModelRoot(String)
    case symbolicLinkNotAllowed(String)
    case unsupportedPlatform
}

public struct NativeModelRuntime: Sendable {
    public let voicePipeline: VoicePipeline
    public let synthesizer: any SpeechSynthesizing

    public init(voicePipeline: VoicePipeline, synthesizer: any SpeechSynthesizing) {
        self.voicePipeline = voicePipeline
        self.synthesizer = synthesizer
    }
}

public enum NativeModelFactory {
    public static func build(
        configuration: NativeModelConfiguration,
        profileStore: any SpeakerProfileStore
    ) async throws -> NativeModelRuntime {
        #if os(macOS)
            ModelHub.offlineMode = true
            let detector = try await FluidVADAdapter(
                modelDirectory: configuration.vadModelDirectory,
                minimumSpeechSeconds: configuration.minimumSpeechSeconds)
            let encoder = try FluidSpeakerEncoder(
                segmentationModel: configuration.diarizerSegmentationModel,
                embeddingModel: configuration.diarizerEmbeddingModel,
                modelIdentifier: configuration.speakerModelIdentifier,
                modelHash: configuration.speakerModelHash)
            let transcriber = try await WhisperKitTranscriber(
                modelDirectory: configuration.whisperModelDirectory,
                language: configuration.language)
            let synthesizer = try KokoroSynthesizer(
                modelDirectory: configuration.kokoroModelDirectory,
                voice: configuration.voice)
            return NativeModelRuntime(
                voicePipeline: VoicePipeline(
                    activityDetector: detector,
                    speakerEncoder: encoder,
                    transcriber: transcriber,
                    profileStore: profileStore),
                synthesizer: synthesizer)
        #else
            throw NativeModelConfigurationError.unsupportedPlatform
        #endif
    }

    public static func enrollOwner(
        configuration: NativeModelConfiguration,
        profileStore: any SpeakerProfileStore,
        waveFiles: [URL],
        threshold: Float
    ) async throws {
        #if os(macOS)
            ModelHub.offlineMode = true
            guard waveFiles.count >= 3, (0.5...0.99).contains(threshold) else {
                throw NativeInferenceError.invalidEnrollment
            }
            let detector = try await FluidVADAdapter(
                modelDirectory: configuration.vadModelDirectory,
                minimumSpeechSeconds: configuration.minimumSpeechSeconds)
            let encoder = try FluidSpeakerEncoder(
                segmentationModel: configuration.diarizerSegmentationModel,
                embeddingModel: configuration.diarizerEmbeddingModel,
                modelIdentifier: configuration.speakerModelIdentifier,
                modelHash: configuration.speakerModelHash)
            var embeddings: [[Float]] = []
            for url in waveFiles {
                let data = try Data(contentsOf: url, options: [.mappedIfSafe])
                let wave = try PCM16Wave.decode(data)
                guard
                    try await detector.containsSufficientSpeech(
                        wave.samples, sampleRate: wave.sampleRate)
                else { throw NativeInferenceError.invalidEnrollment }
                embeddings.append(
                    try await encoder.embedding(for: wave.samples, sampleRate: wave.sampleRate))
            }
            let profile = try SpeakerEnrollment().makeProfile(
                embeddings: embeddings,
                modelIdentifier: configuration.speakerModelIdentifier,
                modelHash: configuration.speakerModelHash,
                threshold: threshold)
            try await profileStore.save(profile)
        #else
            throw NativeModelConfigurationError.unsupportedPlatform
        #endif
    }
}

#if os(macOS)
    public actor FluidVADAdapter: VoiceActivityDetecting {
        private let manager: VadManager
        private let minimumSpeechSeconds: Double

        public init(modelDirectory: URL, minimumSpeechSeconds: Double) async throws {
            let modelConfiguration = MLModelConfiguration()
            modelConfiguration.computeUnits = .cpuAndNeuralEngine
            let model = try MLModel(contentsOf: modelDirectory, configuration: modelConfiguration)
            manager = VadManager(config: .default, vadModel: model)
            self.minimumSpeechSeconds = minimumSpeechSeconds
        }

        public func containsSufficientSpeech(_ samples: [Float], sampleRate: Int) async throws
            -> Bool
        {
            guard sampleRate == VadManager.sampleRate, samples.allSatisfy(\.isFinite) else {
                return false
            }
            let segments = try await manager.segmentSpeech(samples)
            return segments.reduce(0) { $0 + max(0, $1.endTime - $1.startTime) }
                >= minimumSpeechSeconds
        }
    }

    public actor FluidSpeakerEncoder: SpeakerEmbedding {
        public nonisolated let modelIdentifier: String
        public nonisolated let modelHash: String
        private let manager: DiarizerManager

        public init(
            segmentationModel: URL,
            embeddingModel: URL,
            modelIdentifier: String,
            modelHash: String
        ) throws {
            self.modelIdentifier = modelIdentifier
            self.modelHash = modelHash
            let models = try DiarizerModels.load(
                localSegmentationModel: segmentationModel,
                localEmbeddingModel: embeddingModel)
            let manager = DiarizerManager()
            manager.initialize(models: models)
            self.manager = manager
        }

        public func embedding(for samples: [Float], sampleRate: Int) throws -> [Float] {
            guard sampleRate == 16_000, samples.allSatisfy(\.isFinite) else {
                throw NativeInferenceError.invalidAudio
            }
            let output = try manager.extractSpeakerEmbedding(from: samples)
            guard output.count == 256, output.allSatisfy(\.isFinite) else {
                throw NativeInferenceError.invalidEmbedding
            }
            return output
        }
    }

    public actor WhisperKitTranscriber: SpeechTranscribing {
        private let whisper: WhisperKit
        private let options: DecodingOptions

        public init(modelDirectory: URL, language: String) async throws {
            whisper = try await WhisperKit(
                WhisperKitConfig(
                    modelFolder: modelDirectory.path,
                    verbose: false,
                    logLevel: .none,
                    prewarm: true,
                    load: true,
                    download: false))
            options = DecodingOptions(
                verbose: false,
                task: .transcribe,
                language: language,
                temperature: 0,
                temperatureFallbackCount: 0,
                noSpeechThreshold: 0.6,
                concurrentWorkerCount: 1,
                chunkingStrategy: .vad)
        }

        public func transcribe(samples: [Float], sampleRate: Int) async throws -> String {
            guard sampleRate == 16_000, samples.allSatisfy(\.isFinite) else {
                throw NativeInferenceError.invalidAudio
            }
            return try await whisper.transcribe(audioArray: samples, decodeOptions: options)
                .map(\.text).joined(separator: " ")
        }
    }

    public actor KokoroSynthesizer: SpeechSynthesizing {
        private let engine: KokoroEngine
        private let voice: String
        private static let maximumSamples = KokoroEngine.sampleRate * 120

        public init(modelDirectory: URL, voice: String) throws {
            engine = try KokoroEngine(modelDirectory: modelDirectory)
            self.voice = voice
        }

        public func synthesize(text: String, speed: Float) throws -> PCMOutput {
            guard !text.isEmpty, text.utf8.count <= 8_000, speed.isFinite, (0.5...2).contains(speed)
            else { throw NativeInferenceError.invalidSynthesisRequest }
            let samples = try engine.synthesize(text: text, voice: voice, speed: speed).samples
            guard samples.count <= Self.maximumSamples, samples.allSatisfy(\.isFinite) else {
                throw NativeInferenceError.invalidModelOutput
            }
            var bytes = Data(capacity: samples.count * 2)
            for sample in samples {
                let scaled = Int16((max(-1, min(1, sample)) * Float(Int16.max)).rounded())
                let bits = UInt16(bitPattern: scaled)
                bytes.append(UInt8(truncatingIfNeeded: bits))
                bytes.append(UInt8(truncatingIfNeeded: bits >> 8))
            }
            return PCMOutput(bytes: bytes, sampleRate: KokoroEngine.sampleRate)
        }
    }
#endif

public enum NativeInferenceError: Error, Equatable {
    case invalidAudio
    case invalidEmbedding
    case invalidEnrollment
    case invalidModelOutput
    case invalidSynthesisRequest
}
