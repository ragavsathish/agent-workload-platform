import Foundation

public struct BrokerConfiguration: Sendable, Equatable {
    public let host: String
    public let port: Int
    public let brokerToken: String
    public let ollamaModel: String
    public let ollamaBaseURL: URL
    public let piServiceURL: URL
    public let maximumAudioBytes: Int
    public let maximumAudioSeconds: Int
    public let maximumChatBytes: Int
    public let maximumTTSCharacters: Int
    public let maximumQueuedRequests: Int
    public let piVoiceEnabled: Bool

    public init(environment: [String: String]) throws {
        host = environment["BROKER_HOST"] ?? "127.0.0.1"
        guard host == "127.0.0.1" || host == "::1" else {
            throw ConfigurationError.nonLoopbackBinding
        }

        port = try Self.integer(
            "BROKER_PORT", environment: environment, default: 9443, range: 1...65_535)
        brokerToken = environment["INFERENCE_BROKER_TOKEN"] ?? ""
        guard brokerToken.utf8.count >= 32 else { throw ConfigurationError.weakBrokerToken }

        ollamaModel = environment["OLLAMA_MODEL"] ?? ""
        guard !ollamaModel.isEmpty else { throw ConfigurationError.missingOllamaModel }

        ollamaBaseURL = try Self.loopbackURL(
            environment["OLLAMA_BASE_URL"] ?? "http://127.0.0.1:11434/v1",
            variable: "OLLAMA_BASE_URL"
        )
        piServiceURL = try Self.loopbackURL(
            environment["PI_VOICE_SERVICE_URL"] ?? "http://127.0.0.1:9446",
            variable: "PI_VOICE_SERVICE_URL"
        )
        maximumAudioBytes = try Self.integer(
            "BROKER_MAX_AUDIO_BYTES", environment: environment, default: 4_194_304,
            range: 44...4_194_304
        )
        maximumAudioSeconds = try Self.integer(
            "BROKER_MAX_AUDIO_SECONDS", environment: environment, default: 45, range: 1...45
        )
        maximumChatBytes = try Self.integer(
            "BROKER_MAX_CHAT_BYTES", environment: environment, default: 131_072,
            range: 1_024...131_072
        )
        maximumTTSCharacters = try Self.integer(
            "BROKER_MAX_TTS_CHARS", environment: environment, default: 2_000, range: 1...2_000
        )
        maximumQueuedRequests = try Self.integer(
            "BROKER_MAX_QUEUED_REQUESTS", environment: environment, default: 2, range: 0...8
        )
        let allowedUsers = (environment["ORCHESTRATOR_ALLOWED_USERS"] ?? "")
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        piVoiceEnabled =
            allowedUsers.count == 1
            && (environment["AGENT_GATEWAY_TOKEN"] ?? "").utf8.count >= 32
    }

    private static func integer(
        _ name: String,
        environment: [String: String],
        default defaultValue: Int,
        range: ClosedRange<Int>
    ) throws -> Int {
        guard let raw = environment[name] else { return defaultValue }
        guard let value = Int(raw), range.contains(value) else {
            throw ConfigurationError.invalidValue(name)
        }
        return value
    }

    private static func loopbackURL(_ raw: String, variable: String) throws -> URL {
        guard
            let components = URLComponents(string: raw), components.scheme == "http",
            components.user == nil, components.password == nil, components.query == nil,
            components.fragment == nil,
            let host = components.host?.lowercased(), host == "127.0.0.1" || host == "::1",
            let url = components.url
        else {
            throw ConfigurationError.unsafeUpstream(variable)
        }
        return url
    }
}

public enum ConfigurationError: Error, Equatable, CustomStringConvertible {
    case invalidValue(String)
    case missingOllamaModel
    case nonLoopbackBinding
    case unsafeUpstream(String)
    case weakBrokerToken

    public var description: String {
        switch self {
        case .invalidValue(let name): "Invalid value for \(name)"
        case .missingOllamaModel: "OLLAMA_MODEL is required"
        case .nonLoopbackBinding: "BROKER_HOST must be a loopback address"
        case .unsafeUpstream(let name): "\(name) must be an HTTP loopback URL"
        case .weakBrokerToken: "INFERENCE_BROKER_TOKEN must contain at least 32 UTF-8 bytes"
        }
    }
}
