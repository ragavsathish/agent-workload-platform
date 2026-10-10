import CoreML
import Foundation

@main
enum CoreMLModelValidator {
    static func main() throws {
        let paths = Array(CommandLine.arguments.dropFirst())
        guard !paths.isEmpty else {
            FileHandle.standardError.write(Data("usage: validate-coreml-models MODEL...\n".utf8))
            throw ValidationError.missingArguments
        }

        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuOnly
        for path in paths {
            let url = URL(fileURLWithPath: path).standardizedFileURL
            guard url.pathExtension == "mlmodelc" else {
                throw ValidationError.notCompiledModel(url.lastPathComponent)
            }
            let model = try MLModel(contentsOf: url, configuration: configuration)
            let description = model.modelDescription
            let inputs = description.inputDescriptionsByName.keys.sorted().map { name in
                guard let shape = description.inputDescriptionsByName[name]?.multiArrayConstraint?.shape
                else { return name }
                return "\(name):\(shape)"
            }.joined(separator: ",")
            let outputs = description.outputDescriptionsByName.keys.sorted().map { name in
                guard let shape = description.outputDescriptionsByName[name]?.multiArrayConstraint?.shape
                else { return name }
                return "\(name):\(shape)"
            }.joined(separator: ",")
            print("\(url.lastPathComponent) inputs=[\(inputs)] outputs=[\(outputs)]")
        }
    }
}

enum ValidationError: Error {
    case missingArguments
    case notCompiledModel(String)
}
