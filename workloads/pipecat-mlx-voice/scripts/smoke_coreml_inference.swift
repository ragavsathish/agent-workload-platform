import CoreML
import Foundation

@main
enum CoreMLInferenceSmokeTest {
    static func main() throws {
        let paths = Array(CommandLine.arguments.dropFirst())
        guard !paths.isEmpty else { throw SmokeError.missingArguments }
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuOnly

        for path in paths {
            try autoreleasepool {
                let url = URL(fileURLWithPath: path).standardizedFileURL
                let model = try MLModel(contentsOf: url, configuration: configuration)
                var features: [String: MLFeatureValue] = [:]
                for (name, description) in model.modelDescription.inputDescriptionsByName {
                    guard let constraint = description.multiArrayConstraint else {
                        throw SmokeError.unsupportedInput(name)
                    }
                    let array = try MLMultiArray(shape: constraint.shape, dataType: constraint.dataType)
                    let fill: Double = name.contains("mask") || name == "speed" ? 1 : 0
                    for index in 0..<array.count { array[index] = NSNumber(value: fill) }
                    features[name] = MLFeatureValue(multiArray: array)
                }

                let started = ContinuousClock.now
                let output = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: features))
                let elapsed = ContinuousClock.now - started
                for name in output.featureNames {
                    guard let array = output.featureValue(for: name)?.multiArrayValue else { continue }
                    for index in 0..<array.count {
                        guard array[index].doubleValue.isFinite else {
                            throw SmokeError.nonFiniteOutput("\(url.lastPathComponent):\(name)")
                        }
                    }
                }
                print("\(url.lastPathComponent) zero-input-inference=ok elapsed=\(elapsed)")
            }
        }
    }
}

enum SmokeError: Error {
    case missingArguments
    case nonFiniteOutput(String)
    case unsupportedInput(String)
}
