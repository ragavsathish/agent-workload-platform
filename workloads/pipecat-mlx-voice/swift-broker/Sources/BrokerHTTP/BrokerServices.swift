import AsyncHTTPClient
import BrokerCore
import Foundation
import Hummingbird

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

public struct BrokerServices: Sendable {
    public let voicePipeline: VoicePipeline
    public let synthesizer: any SpeechSynthesizing
    public let upstream: any UpstreamTransport
    public let admission: AdmissionController

    public init(
        voicePipeline: VoicePipeline,
        synthesizer: any SpeechSynthesizing,
        upstream: any UpstreamTransport = URLSessionUpstreamTransport(),
        admission: AdmissionController
    ) {
        self.voicePipeline = voicePipeline
        self.synthesizer = synthesizer
        self.upstream = upstream
        self.admission = admission
    }
}

public struct UpstreamResponse: Sendable {
    public let status: Int
    public let contentType: String?
    public let body: Data

    public init(status: Int, contentType: String?, body: Data) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }
}

public struct UpstreamStreamingResponse: Sendable {
    public let status: Int
    public let contentType: String?
    public let body: AsyncThrowingStream<Data, any Error>

    public init(
        status: Int,
        contentType: String?,
        body: AsyncThrowingStream<Data, any Error>
    ) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }
}

public protocol UpstreamTransport: Sendable {
    func post(url: URL, body: Data, authorization: String, timeout: TimeInterval) async throws
        -> UpstreamResponse
    func postStreaming(
        url: URL, body: Data, authorization: String, timeout: TimeInterval
    ) async throws -> UpstreamStreamingResponse
}

public extension UpstreamTransport {
    func postStreaming(
        url: URL, body: Data, authorization: String, timeout: TimeInterval
    ) async throws -> UpstreamStreamingResponse {
        let response = try await post(
            url: url, body: body, authorization: authorization, timeout: timeout)
        let stream = AsyncThrowingStream<Data, any Error> { continuation in
            continuation.yield(response.body)
            continuation.finish()
        }
        return UpstreamStreamingResponse(
            status: response.status, contentType: response.contentType, body: stream)
    }
}

public struct URLSessionUpstreamTransport: UpstreamTransport {
    public init() {}

    public func post(url: URL, body: Data, authorization: String, timeout: TimeInterval)
        async throws
        -> UpstreamResponse
    {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw UpstreamError.invalidResponse
        }
        guard data.count <= 16_777_216 else { throw UpstreamError.responseTooLarge }
        return UpstreamResponse(
            status: response.statusCode,
            contentType: response.value(forHTTPHeaderField: "Content-Type"),
            body: data)
    }

    public func postStreaming(
        url: URL, body: Data, authorization: String, timeout: TimeInterval
    ) async throws -> UpstreamStreamingResponse {
        var request = HTTPClientRequest(url: url.absoluteString)
        request.method = .POST
        request.headers.add(name: "Content-Type", value: "application/json")
        request.headers.add(name: "Authorization", value: authorization)
        request.body = .bytes(ByteBuffer(bytes: body))
        let response = try await HTTPClient.shared.execute(
            request, timeout: .seconds(Int64(timeout.rounded(.up))))
        let upstreamBody = response.body
        let stream = AsyncThrowingStream<Data, any Error> { continuation in
            Task {
                var received = 0
                do {
                    for try await chunk in upstreamBody {
                        received += chunk.readableBytes
                        guard received <= 16_777_216 else {
                            throw UpstreamError.responseTooLarge
                        }
                        continuation.yield(Data(chunk.readableBytesView))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
        return UpstreamStreamingResponse(
            status: Int(response.status.code),
            contentType: response.headers.first(name: "Content-Type"),
            body: stream)
    }
}

public enum UpstreamError: Error { case invalidResponse, responseTooLarge }

enum MultipartAudioParser {
    static func parse(body: Data, contentType: String?, maximumAudioBytes: Int) throws -> Data {
        guard let contentType, let boundary = boundary(from: contentType) else {
            throw HTTPContractError.invalidMultipart
        }
        let marker = Data("--\(boundary)".utf8)
        let separator = Data("\r\n\r\n".utf8)
        let nextMarker = Data("\r\n--\(boundary)".utf8)
        guard body.starts(with: marker) else { throw HTTPContractError.invalidMultipart }

        var cursor = marker.count
        var file: Data?
        while true {
            if body[cursor...].starts(with: Data("--".utf8)) {
                cursor += 2
                if body.count - cursor == 2 { cursor += 2 }
                guard cursor == body.count else { throw HTTPContractError.invalidMultipart }
                break
            }
            guard body[cursor...].starts(with: Data("\r\n".utf8)) else {
                throw HTTPContractError.invalidMultipart
            }
            cursor += 2
            guard let headerRange = body.range(of: separator, in: cursor..<body.count),
                headerRange.lowerBound - cursor <= 8_192,
                let headers = String(data: body[cursor..<headerRange.lowerBound], encoding: .utf8)
            else { throw HTTPContractError.invalidMultipart }
            let contentStart = headerRange.upperBound
            guard let boundaryRange = body.range(of: nextMarker, in: contentStart..<body.count)
            else {
                throw HTTPContractError.invalidMultipart
            }
            guard isFilePart(headers), file == nil else { throw HTTPContractError.invalidMultipart }
            let value = Data(body[contentStart..<boundaryRange.lowerBound])
            guard value.count <= maximumAudioBytes else { throw HTTPContractError.payloadTooLarge }
            file = value
            cursor = boundaryRange.lowerBound + 2 + marker.count
        }
        guard let file else { throw HTTPContractError.invalidMultipart }
        return file
    }

    private static func boundary(from contentType: String) -> String? {
        let pieces = contentType.split(separator: ";", omittingEmptySubsequences: false)
        guard
            pieces.first?.trimmingCharacters(in: .whitespaces).lowercased()
                == "multipart/form-data"
        else { return nil }
        for piece in pieces.dropFirst() {
            let pair = piece.split(separator: "=", maxSplits: 1).map {
                $0.trimmingCharacters(in: .whitespaces)
            }
            guard pair.count == 2, pair[0].lowercased() == "boundary" else { continue }
            let value = pair[1].trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            guard (1...70).contains(value.utf8.count),
                value.utf8.allSatisfy({ $0 >= 33 && $0 <= 126 && $0 != 34 })
            else { return nil }
            return value
        }
        return nil
    }

    private static func isFilePart(_ headers: String) -> Bool {
        let lines = headers.components(separatedBy: "\r\n")
        guard lines.count <= 16 else { return false }
        let dispositions = lines.filter { $0.lowercased().hasPrefix("content-disposition:") }
        guard dispositions.count == 1 else { return false }
        let value = dispositions[0].lowercased()
        return value.contains("form-data") && value.contains("name=\"file\"")
    }
}

enum HTTPContractError: Error {
    case invalidJSON
    case invalidMultipart
    case invalidRequest(String)
    case payloadTooLarge
    case upstreamUnavailable
}
