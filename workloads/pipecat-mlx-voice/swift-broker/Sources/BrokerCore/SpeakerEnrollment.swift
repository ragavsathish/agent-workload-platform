public struct SpeakerEnrollment: Sendable {
    public let minimumUtterances: Int

    public init(minimumUtterances: Int = 3) {
        self.minimumUtterances = max(3, minimumUtterances)
    }

    public func makeProfile(
        embeddings: [[Float]],
        modelIdentifier: String,
        modelHash: String,
        threshold: Float
    ) throws -> SpeakerProfile {
        guard embeddings.count >= minimumUtterances, let dimension = embeddings.first?.count,
            dimension > 0, dimension <= 4_096,
            embeddings.allSatisfy({ $0.count == dimension })
        else { throw SpeakerEnrollmentError.insufficientOrInconsistentSamples }

        let normalized = try embeddings.map(Self.normalize)
        var average = [Float](repeating: 0, count: dimension)
        for embedding in normalized {
            for index in average.indices { average[index] += embedding[index] }
        }
        average = try Self.normalize(average)
        return try SpeakerProfile(
            modelIdentifier: modelIdentifier,
            modelHash: modelHash,
            threshold: threshold,
            embedding: average
        )
    }

    private static func normalize(_ values: [Float]) throws -> [Float] {
        guard values.allSatisfy(\.isFinite) else { throw SpeakerEnrollmentError.invalidEmbedding }
        let magnitude = values.reduce(0) { $0 + $1 * $1 }.squareRoot()
        guard magnitude > 0 else { throw SpeakerEnrollmentError.invalidEmbedding }
        return values.map { $0 / magnitude }
    }
}

public enum SpeakerEnrollmentError: Error, Equatable {
    case insufficientOrInconsistentSamples
    case invalidEmbedding
}
