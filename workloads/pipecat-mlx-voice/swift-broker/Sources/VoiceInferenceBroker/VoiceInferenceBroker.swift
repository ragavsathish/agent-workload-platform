import BrokerCore
import BrokerHTTP
import BrokerModels
import BrokerSecurity
import Foundation
import Hummingbird

@main
enum VoiceInferenceBroker {
    static func main() async throws {
        #if os(macOS)
            if CommandLine.arguments.dropFirst().first == "enroll" {
                let environment = ProcessInfo.processInfo.environment
                let modelConfiguration = try NativeModelConfiguration(environment: environment)
                let files = CommandLine.arguments.dropFirst(2).map {
                    URL(fileURLWithPath: $0).standardizedFileURL
                }
                let threshold = Float(environment["SWIFT_SPEAKER_THRESHOLD"] ?? "0.78") ?? 0
                try await NativeModelFactory.enrollOwner(
                    configuration: modelConfiguration,
                    profileStore: KeychainProfileStore(),
                    waveFiles: files,
                    threshold: threshold)
                FileHandle.standardOutput.write(Data("Owner speaker profile enrolled.\n".utf8))
                return
            }
        #endif

        let configuration: BrokerConfiguration
        do {
            configuration = try BrokerConfiguration(
                environment: ProcessInfo.processInfo.environment)
        } catch {
            FileHandle.standardError.write(Data("Configuration error: \(error)\n".utf8))
            throw error
        }

        #if os(macOS)
            let modelConfiguration = try NativeModelConfiguration(
                environment: ProcessInfo.processInfo.environment)
            let runtime = try await NativeModelFactory.build(
                configuration: modelConfiguration,
                profileStore: KeychainProfileStore())
            let services = BrokerServices(
                voicePipeline: runtime.voicePipeline,
                synthesizer: runtime.synthesizer,
                admission: AdmissionController(maximumWaiting: configuration.maximumQueuedRequests))
            let application = BrokerApplication.build(
                configuration: configuration,
                authenticator: BearerAuthenticator(token: configuration.brokerToken),
                services: services)
            try await application.runService()
        #else
            throw NativeModelConfigurationError.unsupportedPlatform
        #endif
    }
}
