// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "PipecatVoiceBroker",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "pipecat-swift-broker", targets: ["VoiceInferenceBroker"]),
        .library(name: "BrokerCore", targets: ["BrokerCore"]),
        .library(name: "BrokerModels", targets: ["BrokerModels"]),
        .library(name: "BrokerSecurity", targets: ["BrokerSecurity"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", exact: "2.27.1"),
        .package(url: "https://github.com/swift-server/async-http-client.git", exact: "1.36.2"),
        .package(url: "https://github.com/apple/swift-crypto.git", exact: "4.5.2"),
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            exact: "0.17.7",
            traits: []
        ),
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", exact: "1.1.1"),
        .package(url: "https://github.com/Jud/kokoro-coreml.git", exact: "0.11.2"),
    ],
    targets: [
        .target(name: "BrokerCore"),
        .target(
            name: "BrokerModels",
            dependencies: [
                "BrokerCore",
                .product(name: "Crypto", package: "swift-crypto"),
                .product(
                    name: "FluidAudio", package: "fluidaudio", condition: .when(platforms: [.macOS])
                ),
                .product(
                    name: "WhisperKit", package: "whisperkit", condition: .when(platforms: [.macOS])
                ),
                .product(
                    name: "KokoroCoreML", package: "kokoro-coreml",
                    condition: .when(platforms: [.macOS])),
            ]
        ),
        .target(
            name: "BrokerSecurity",
            dependencies: [
                "BrokerCore",
                .product(name: "Crypto", package: "swift-crypto"),
            ],
            linkerSettings: [.linkedFramework("Security", .when(platforms: [.macOS]))]
        ),
        .target(
            name: "BrokerHTTP",
            dependencies: [
                "BrokerCore",
                "BrokerSecurity",
                .product(name: "AsyncHTTPClient", package: "async-http-client"),
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "HummingbirdCore", package: "hummingbird"),
            ]
        ),
        .executableTarget(
            name: "VoiceInferenceBroker",
            dependencies: ["BrokerCore", "BrokerHTTP", "BrokerModels", "BrokerSecurity"]
        ),
        .testTarget(name: "BrokerCoreTests", dependencies: ["BrokerCore"]),
        .testTarget(name: "BrokerModelsTests", dependencies: ["BrokerModels"]),
        .testTarget(
            name: "BrokerHTTPTests",
            dependencies: [
                "BrokerCore", "BrokerHTTP", "BrokerSecurity",
                .product(name: "HummingbirdTesting", package: "hummingbird"),
            ]
        ),
        .testTarget(name: "BrokerSecurityTests", dependencies: ["BrokerCore", "BrokerSecurity"]),
    ],
    swiftLanguageModes: [.v6]
)
