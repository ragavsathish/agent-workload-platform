import BrokerCore
import BrokerHTTP
import BrokerSecurity
import Foundation
import Hummingbird
import HummingbirdTesting
import Testing

@Test func healthRequiresTheExactBearerCredential() async throws {
    let token = String(repeating: "secure-token-", count: 3)
    let configuration = try BrokerConfiguration(environment: [
        "INFERENCE_BROKER_TOKEN": token,
        "OLLAMA_MODEL": "fixed-model",
        "ORCHESTRATOR_ALLOWED_USERS": "owner",
        "AGENT_GATEWAY_TOKEN": String(repeating: "g", count: 32),
    ])
    let application = BrokerApplication.build(
        configuration: configuration,
        authenticator: BearerAuthenticator(token: token)
    )

    try await application.test(.router) { client in
        try await client.execute(uri: "/health", method: .get) { response in
            #expect(response.status == .unauthorized)
        }
        try await client.execute(
            uri: "/health", method: .get, headers: [.authorization: "Bearer \(token)"]
        ) { response in
            #expect(response.status == .ok)
            #expect(String(buffer: response.body) == #"{"status":"ok"}"#)
        }
    }
}

@Test func unprovisionedModelRoutesFailClosed() async throws {
    let token = String(repeating: "secure-token-", count: 3)
    let configuration = try BrokerConfiguration(environment: [
        "INFERENCE_BROKER_TOKEN": token,
        "OLLAMA_MODEL": "fixed-model",
    ])
    let application = BrokerApplication.build(
        configuration: configuration,
        authenticator: BearerAuthenticator(token: token)
    )

    try await application.test(.router) { client in
        try await client.execute(
            uri: "/v1/audio/transcriptions", method: .post,
            headers: [.authorization: "Bearer \(token)"]
        ) { response in
            #expect(response.status == .serviceUnavailable)
        }
    }
}

@Test func provisionedRoutesPerformOwnerGatedSTTAndPCMOutput() async throws {
    let (application, token, _) = try makeProvisionedApplication()
    let boundary = "broker-test-boundary"
    var multipartData = Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
            .utf8)
    multipartData.append(makeWave())
    multipartData.append(Data("\r\n--\(boundary)--\r\n".utf8))
    let multipart = multipartData

    try await application.test(.router) { client in
        try await client.execute(
            uri: "/v1/audio/transcriptions", method: .post,
            headers: [
                .authorization: "Bearer \(token)",
                .contentType: "multipart/form-data; boundary=\(boundary)",
            ],
            body: .init(data: multipart)
        ) { response in
            #expect(response.status == .ok)
            #expect(String(buffer: response.body) == #"{"text":"owner speech"}"#)
        }
        let speech =
            #"{"model":"kokoro","input":"Precise.","voice":"fixed","response_format":"pcm","speed":1}"#
        try await client.execute(
            uri: "/v1/audio/speech", method: .post,
            headers: [.authorization: "Bearer \(token)", .contentType: "application/json"],
            body: .init(string: speech)
        ) { response in
            #expect(response.status == .ok)
            #expect(response.headers[.contentType] == "application/octet-stream")
            #expect(Data(response.body.readableBytesView) == Data([0, 1, 2, 3]))
        }
    }
}

@Test func chatContractsPinModelsAndPiTools() async throws {
    let (application, token, upstream) = try makeProvisionedApplication()
    try await application.test(.router) { client in
        let invalid = #"{"model":"other","messages":[]}"#
        try await client.execute(
            uri: "/v1/chat/completions", method: .post,
            headers: [.authorization: "Bearer \(token)", .contentType: "application/json"],
            body: .init(string: invalid)
        ) { response in #expect(response.status == .badRequest) }

        let chat =
            #"{"model":"fixed-model","messages":[{"role":"user","content":"Hi"}],"stream":true}"#
        try await client.execute(
            uri: "/v1/chat/completions", method: .post,
            headers: [.authorization: "Bearer \(token)", .contentType: "application/json"],
            body: .init(string: chat)
        ) { response in
            #expect(response.status == .ok)
            #expect(String(buffer: response.body) == "ollama-response")
        }

        let pi = #"{"model":"pi-agent","messages":[{"role":"user","content":"Hi"}],"stream":true}"#
        try await client.execute(
            uri: "/v1/pi/chat/completions", method: .post,
            headers: [.authorization: "Bearer \(token)", .contentType: "application/json"],
            body: .init(string: pi)
        ) { response in
            #expect(response.status == .ok)
            #expect(String(buffer: response.body).contains("data: [DONE]"))
        }

        let piWithTools =
            #"{"model":"pi-agent","messages":[{"role":"user","content":"Hi"}],"tools":[{"type":"function"}]}"#
        try await client.execute(
            uri: "/v1/pi/chat/completions", method: .post,
            headers: [.authorization: "Bearer \(token)", .contentType: "application/json"],
            body: .init(string: piWithTools)
        ) { response in #expect(response.status == .badRequest) }
    }
    #expect(await upstream.calls == 1)
    #expect(await upstream.streamingCalls == 1)
}

@Test func oversizedChatPayloadReturns413() async throws {
    let (application, token, _) = try makeProvisionedApplication()
    let oversized = String(repeating: "x", count: 131_073)
    try await application.test(.router) { client in
        try await client.execute(
            uri: "/v1/chat/completions", method: .post,
            headers: [.authorization: "Bearer \(token)", .contentType: "application/json"],
            body: .init(string: oversized)
        ) { response in #expect(response.status == .contentTooLarge) }
    }
}

private func makeProvisionedApplication() throws -> (
    Application<RouterResponder<BasicRequestContext>>, String, FakeUpstream
) {
    let token = String(repeating: "secure-token-", count: 3)
    let configuration = try BrokerConfiguration(environment: [
        "INFERENCE_BROKER_TOKEN": token,
        "OLLAMA_MODEL": "fixed-model",
        "ORCHESTRATOR_ALLOWED_USERS": "owner",
        "AGENT_GATEWAY_TOKEN": String(repeating: "g", count: 32),
    ])
    let profile = try SpeakerProfile(
        modelIdentifier: "cam++", modelHash: "test-hash", threshold: 0.8, embedding: [1, 0])
    let pipeline = VoicePipeline(
        activityDetector: HTTPFakeVAD(), speakerEncoder: HTTPFakeEncoder(),
        transcriber: HTTPFakeTranscriber(), profileStore: HTTPMemoryStore(profile))
    let upstream = FakeUpstream()
    let services = BrokerServices(
        voicePipeline: pipeline, synthesizer: HTTPFakeSynthesizer(), upstream: upstream,
        admission: AdmissionController(maximumWaiting: 2))
    return (
        BrokerApplication.build(
            configuration: configuration, authenticator: BearerAuthenticator(token: token),
            services: services), token, upstream
    )
}

private struct HTTPFakeVAD: VoiceActivityDetecting {
    func containsSufficientSpeech(_ samples: [Float], sampleRate: Int) async throws -> Bool { true }
}

private struct HTTPFakeEncoder: SpeakerEmbedding {
    let modelIdentifier = "cam++"
    let modelHash = "test-hash"
    func embedding(for samples: [Float], sampleRate: Int) async throws -> [Float] { [1, 0] }
}

private struct HTTPFakeTranscriber: SpeechTranscribing {
    func transcribe(samples: [Float], sampleRate: Int) async throws -> String { "owner speech" }
}

private struct HTTPFakeSynthesizer: SpeechSynthesizing {
    func synthesize(text: String, speed: Float) async throws -> PCMOutput {
        PCMOutput(bytes: Data([0, 1, 2, 3]), sampleRate: 24_000)
    }
}

private actor HTTPMemoryStore: SpeakerProfileStore {
    private var profile: SpeakerProfile?
    init(_ profile: SpeakerProfile?) { self.profile = profile }
    func load() -> SpeakerProfile? { profile }
    func save(_ profile: SpeakerProfile) { self.profile = profile }
    func delete() { profile = nil }
}

private actor FakeUpstream: UpstreamTransport {
    private(set) var calls = 0
    private(set) var streamingCalls = 0
    func post(url: URL, body: Data, authorization: String, timeout: TimeInterval) async throws
        -> UpstreamResponse
    {
        calls += 1
        if url.path.hasSuffix("/v1/turn") {
            return UpstreamResponse(
                status: 200, contentType: "application/json",
                body: Data(#"{"text":"Pi response"}"#.utf8))
        }
        return UpstreamResponse(
            status: 200, contentType: "text/event-stream", body: Data("ollama-response".utf8))
    }

    func postStreaming(
        url: URL, body: Data, authorization: String, timeout: TimeInterval
    ) async throws -> UpstreamStreamingResponse {
        streamingCalls += 1
        let stream = AsyncThrowingStream<Data, any Error> { continuation in
            continuation.yield(Data("ollama-".utf8))
            continuation.yield(Data("response".utf8))
            continuation.finish()
        }
        return UpstreamStreamingResponse(
            status: 200, contentType: "text/event-stream", body: stream)
    }
}

private func makeWave() -> Data {
    let samples: [Int16] = [0, 1_000, -1_000]
    var pcm = Data()
    for sample in samples {
        let bits = UInt16(bitPattern: sample)
        pcm.append(UInt8(truncatingIfNeeded: bits))
        pcm.append(UInt8(truncatingIfNeeded: bits >> 8))
    }
    var data = Data("RIFF".utf8)
    data.appendLE(UInt32(36 + pcm.count))
    data.append(Data("WAVEfmt ".utf8))
    data.appendLE(UInt32(16))
    data.appendLE(UInt16(1))
    data.appendLE(UInt16(1))
    data.appendLE(UInt32(16_000))
    data.appendLE(UInt32(32_000))
    data.appendLE(UInt16(2))
    data.appendLE(UInt16(16))
    data.append(Data("data".utf8))
    data.appendLE(UInt32(pcm.count))
    data.append(pcm)
    return data
}

private extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var value = value.littleEndian
        Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
    }
}
