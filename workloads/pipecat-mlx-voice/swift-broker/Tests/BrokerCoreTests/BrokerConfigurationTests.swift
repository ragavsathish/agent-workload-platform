import Foundation
import Testing

@testable import BrokerCore

private let validEnvironment = [
    "INFERENCE_BROKER_TOKEN": String(repeating: "a", count: 32),
    "OLLAMA_MODEL": "fixed-model",
]

@Test func configurationUsesSecureDefaults() throws {
    let configuration = try BrokerConfiguration(environment: validEnvironment)
    #expect(configuration.host == "127.0.0.1")
    #expect(configuration.port == 9443)
    #expect(configuration.maximumAudioBytes == 4_194_304)
}

@Test func configurationRejectsNetworkExposure() {
    var environment = validEnvironment
    environment["BROKER_HOST"] = "0.0.0.0"
    #expect(throws: ConfigurationError.nonLoopbackBinding) {
        try BrokerConfiguration(environment: environment)
    }
}

@Test func configurationRejectsNonLoopbackUpstream() {
    var environment = validEnvironment
    environment["OLLAMA_BASE_URL"] = "https://example.com/v1"
    #expect(throws: ConfigurationError.unsafeUpstream("OLLAMA_BASE_URL")) {
        try BrokerConfiguration(environment: environment)
    }
}

@Test func configurationRejectsShortToken() {
    var environment = validEnvironment
    environment["INFERENCE_BROKER_TOKEN"] = "short"
    #expect(throws: ConfigurationError.weakBrokerToken) {
        try BrokerConfiguration(environment: environment)
    }
}
