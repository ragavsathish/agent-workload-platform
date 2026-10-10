import BrokerCore
import BrokerSecurity
import Foundation
import Hummingbird
import HummingbirdCore

public enum BrokerApplication {
    public static func build(
        configuration: BrokerConfiguration,
        authenticator: BearerAuthenticator,
        services: BrokerServices? = nil
    ) -> Application<RouterResponder<BasicRequestContext>> {
        let router = Router(context: BasicRequestContext.self)
        router.middlewares.add(BrokerAuthenticationMiddleware(authenticator: authenticator))
        router.get("/health") { _, _ -> HealthResponse in HealthResponse(status: "ok") }

        router.post("/v1/audio/transcriptions") { request, _ -> Response in
            guard let services else { return unavailableResponse() }
            do {
                var request = request
                let buffer = try await request.collectBody(
                    upTo: configuration.maximumAudioBytes + 16_384)
                let waveData = try MultipartAudioParser.parse(
                    body: Data(buffer.readableBytesView),
                    contentType: request.headers[.contentType],
                    maximumAudioBytes: configuration.maximumAudioBytes)
                let wave = try PCM16Wave.decode(
                    waveData, maximumBytes: configuration.maximumAudioBytes,
                    maximumSeconds: configuration.maximumAudioSeconds)
                let text = try await services.admission.run {
                    try await services.voicePipeline.transcribeOwner(wave)
                }
                return jsonResponse(["text": text])
            } catch { return contractErrorResponse(error) }
        }

        router.post("/v1/audio/speech") { request, _ -> Response in
            guard let services else { return unavailableResponse() }
            do {
                var request = request
                let buffer = try await request.collectBody(upTo: configuration.maximumChatBytes)
                let speech = try JSONDecoder().decode(
                    SpeechRequest.self, from: Data(buffer.readableBytesView))
                guard speech.responseFormat == "pcm", !speech.input.isEmpty,
                    speech.input.count <= configuration.maximumTTSCharacters,
                    speech.model.utf8.count <= 64, speech.voice.utf8.count <= 64,
                    (0.5...2).contains(speech.speed ?? 1)
                else { throw HTTPContractError.invalidRequest("invalid speech request") }
                let output = try await services.admission.run {
                    try await services.synthesizer.synthesize(
                        text: speech.input, speed: speech.speed ?? 1)
                }
                guard output.sampleRate == 24_000 else {
                    return errorResponse(.badGateway, "unexpected TTS sample rate")
                }
                return Response(
                    status: .ok, headers: [.contentType: "application/octet-stream"],
                    body: .init(byteBuffer: .init(data: output.bytes)))
            } catch { return contractErrorResponse(error) }
        }

        router.post("/v1/chat/completions") { request, _ -> Response in
            guard let services else { return unavailableResponse() }
            do {
                var request = request
                let buffer = try await request.collectBody(upTo: configuration.maximumChatBytes)
                let body = Data(buffer.readableBytesView)
                let streaming = try validateChat(body, requiredModel: configuration.ollamaModel)
                if streaming {
                    let response = try await services.upstream.postStreaming(
                        url: configuration.ollamaBaseURL.appendingPathComponent("chat/completions"),
                        body: body, authorization: "Bearer ollama", timeout: 300)
                    return upstreamStreamingResponse(response)
                }
                let response = try await services.upstream.post(
                    url: configuration.ollamaBaseURL.appendingPathComponent("chat/completions"),
                    body: body, authorization: "Bearer ollama", timeout: 300)
                return upstreamResponse(response)
            } catch { return contractErrorResponse(error) }
        }

        router.post("/v1/pi/chat/completions") { request, _ -> Response in
            guard let services else { return unavailableResponse() }
            guard configuration.piVoiceEnabled else {
                return errorResponse(.serviceUnavailable, "Pi voice is not configured")
            }
            do {
                var request = request
                let buffer = try await request.collectBody(upTo: configuration.maximumChatBytes)
                let validated = try validatePi(Data(buffer.readableBytesView))
                let response = try await services.upstream.post(
                    url: configuration.piServiceURL.appendingPathComponent("v1/turn"),
                    body: validated.upstreamBody,
                    authorization: "Bearer \(configuration.brokerToken)", timeout: 125)
                guard response.status == 200,
                    let object = try JSONSerialization.jsonObject(with: response.body)
                        as? [String: Any],
                    let text = object["text"] as? String,
                    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                else { return errorResponse(.badGateway, "Pi voice returned an invalid response") }
                return try piCompletion(text: text, streaming: validated.streaming)
            } catch { return contractErrorResponse(error) }
        }

        return Application(
            router: router,
            configuration: .init(
                address: .hostname(configuration.host, port: configuration.port),
                serverName: "pipecat-swift-broker", backlog: 16, reuseAddress: false,
                availableConnectionsDelegate: MaximumAvailableConnections(16)))
    }
}

private struct SpeechRequest: Decodable {
    let model: String
    let input: String
    let voice: String
    let responseFormat: String
    let speed: Float?

    enum CodingKeys: String, CodingKey {
        case model, input, voice, speed
        case responseFormat = "response_format"
    }
}

private struct PiValidation {
    let upstreamBody: Data
    let streaming: Bool
}

private func validateChat(_ data: Data, requiredModel: String) throws -> Bool {
    guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        payload["model"] as? String == requiredModel,
        let messages = payload["messages"] as? [[String: Any]], messages.count <= 64,
        let tools = (payload["tools"] ?? []) as? [[String: Any]], tools.count <= 4
    else { throw HTTPContractError.invalidRequest("invalid chat request") }
    let roles = Set(["system", "developer", "user", "assistant", "tool"])
    var characters = 0
    for message in messages {
        guard let role = message["role"] as? String, roles.contains(role) else {
            throw HTTPContractError.invalidRequest("invalid message")
        }
        characters += String(describing: message["content"] ?? "").count
    }
    guard characters <= 64_000 else { throw HTTPContractError.payloadTooLarge }
    let allowed = Set([
        "propose_agent_task", "approve_agent_task", "get_agent_task", "cancel_agent_task",
    ])
    for tool in tools {
        guard tool["type"] as? String == "function",
            let function = tool["function"] as? [String: Any],
            let name = function["name"] as? String, allowed.contains(name)
        else { throw HTTPContractError.invalidRequest("unapproved tool declaration") }
    }
    return payload["stream"] as? Bool ?? false
}

private func validatePi(_ data: Data) throws -> PiValidation {
    guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        payload["model"] as? String == "pi-agent",
        let messages = payload["messages"] as? [[String: Any]], !messages.isEmpty,
        messages.count <= 64,
        payload["tools"] == nil || (payload["tools"] as? [Any])?.isEmpty == true
    else { throw HTTPContractError.invalidRequest("invalid Pi chat request") }
    let roles = Set(["system", "developer", "user", "assistant"])
    var characters = 0
    for message in messages {
        guard let role = message["role"] as? String, roles.contains(role) else {
            throw HTTPContractError.invalidRequest("invalid Pi message")
        }
        characters += String(describing: message["content"] ?? "").count
    }
    guard characters <= 64_000 else { throw HTTPContractError.payloadTooLarge }
    return PiValidation(
        upstreamBody: try JSONSerialization.data(withJSONObject: ["messages": messages]),
        streaming: payload["stream"] as? Bool ?? false)
}

private func piCompletion(text: String, streaming: Bool) throws -> Response {
    let id = "chatcmpl-pi-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
    let created = Int(Date().timeIntervalSince1970)
    if !streaming {
        return jsonResponse([
            "id": id, "object": "chat.completion", "created": created, "model": "pi-agent",
            "choices": [
                [
                    "index": 0, "message": ["role": "assistant", "content": text],
                    "finish_reason": "stop",
                ]
            ],
            "usage": ["prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0],
        ])
    }
    let first: [String: Any] = [
        "id": id, "object": "chat.completion.chunk", "created": created, "model": "pi-agent",
        "choices": [
            [
                "index": 0, "delta": ["role": "assistant", "content": text],
                "finish_reason": NSNull(),
            ]
        ],
    ]
    let last: [String: Any] = [
        "id": id, "object": "chat.completion.chunk", "created": created, "model": "pi-agent",
        "choices": [["index": 0, "delta": [:], "finish_reason": "stop"]],
    ]
    guard
        let firstJSON = String(
            data: try JSONSerialization.data(withJSONObject: first), encoding: .utf8),
        let lastJSON = String(
            data: try JSONSerialization.data(withJSONObject: last), encoding: .utf8)
    else {
        throw HTTPContractError.invalidRequest("unable to encode Pi response")
    }
    let bytes =
        "data: \(firstJSON)\n\n"
        + "data: \(lastJSON)\n\n"
        + "data: [DONE]\n\n"
    return Response(
        status: .ok, headers: [.contentType: "text/event-stream"],
        body: .init(byteBuffer: .init(string: bytes)))
}

private func upstreamResponse(_ response: UpstreamResponse) -> Response {
    let body = response.status == 200 ? response.body : Data(response.body.prefix(8_192))
    return Response(
        status: HTTPResponse.Status(code: response.status),
        headers: [.contentType: response.contentType ?? "application/octet-stream"],
        body: .init(byteBuffer: .init(data: body)))
}

private func upstreamStreamingResponse(_ response: UpstreamStreamingResponse) -> Response {
    let maximumBytes = response.status == 200 ? 16_777_216 : 8_192
    return Response(
        status: HTTPResponse.Status(code: response.status),
        headers: [.contentType: response.contentType ?? "application/octet-stream"],
        body: .init { writer in
            var received = 0
            for try await chunk in response.body {
                received += chunk.count
                guard received <= maximumBytes else { throw UpstreamError.responseTooLarge }
                try await writer.write(ByteBuffer(data: chunk))
            }
            try await writer.finish(nil)
        })
}

private func jsonResponse(_ object: Any) -> Response {
    let data =
        (try? JSONSerialization.data(withJSONObject: object))
        ?? Data(#"{"detail":"encoding failure"}"#.utf8)
    return Response(
        status: .ok, headers: [.contentType: "application/json"],
        body: .init(byteBuffer: .init(data: data)))
}

private func unavailableResponse() -> Response {
    errorResponse(.serviceUnavailable, "model adapters are not provisioned")
}

private func contractErrorResponse(_ error: Error) -> Response {
    if let responseError = error as? any HTTPResponseError,
        responseError.status == .contentTooLarge
    {
        return errorResponse(.contentTooLarge, "payload too large")
    }
    if case HTTPContractError.payloadTooLarge = error {
        return errorResponse(.contentTooLarge, "payload too large")
    }
    if let waveError = error as? WaveError,
        waveError == .payloadTooLarge || waveError == .durationTooLong
    {
        return errorResponse(.contentTooLarge, "audio segment is too large")
    }
    if error is WaveError { return errorResponse(.badRequest, "invalid WAV payload") }
    if case VoicePipelineError.speakerProfileMissing = error {
        return errorResponse(.serviceUnavailable, "speaker profile is not provisioned")
    }
    if error is AdmissionError { return errorResponse(.serviceUnavailable, "inference is busy") }
    if error is UpstreamError || error is URLError {
        return errorResponse(.badGateway, "upstream unavailable")
    }
    if case HTTPContractError.invalidRequest(let detail) = error {
        return errorResponse(.badRequest, detail)
    }
    return errorResponse(.badRequest, "invalid request")
}

private func errorResponse(_ status: HTTPResponse.Status, _ detail: String) -> Response {
    let data = (try? JSONSerialization.data(withJSONObject: ["detail": detail])) ?? Data()
    return Response(
        status: status, headers: [.contentType: "application/json"],
        body: .init(byteBuffer: .init(data: data)))
}

private struct HealthResponse: ResponseCodable { let status: String }

private struct BrokerAuthenticationMiddleware<Context: RequestContext>: RouterMiddleware {
    let authenticator: BearerAuthenticator

    func handle(
        _ request: Request, context: Context,
        next: (Request, Context) async throws -> Response
    ) async throws -> Response {
        guard authenticator.accepts(authorizationHeader: request.headers[.authorization]) else {
            return errorResponse(.unauthorized, "invalid broker credential")
        }
        return try await next(request, context)
    }
}
