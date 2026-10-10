import Testing

@testable import BrokerCore

@Test func enrollmentRequiresMultipleConsistentUtterances() {
    let enrollment = SpeakerEnrollment()
    #expect(throws: SpeakerEnrollmentError.insufficientOrInconsistentSamples) {
        try enrollment.makeProfile(
            embeddings: [[1, 0], [1, 0]], modelIdentifier: "cam++",
            modelHash: "sha256:test", threshold: 0.75)
    }
}

@Test func enrollmentStoresOnlyNormalizedAverage() throws {
    let enrollment = SpeakerEnrollment()
    let profile = try enrollment.makeProfile(
        embeddings: [[2, 0], [1, 0], [0.9, 0.1]], modelIdentifier: "cam++",
        modelHash: "sha256:test", threshold: 0.75)
    let magnitude = profile.embedding.reduce(0) { $0 + $1 * $1 }.squareRoot()
    #expect(abs(magnitude - 1) < 0.0001)
    #expect(profile.embedding.count == 2)
}
