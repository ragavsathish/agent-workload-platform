import Foundation

public actor AdmissionController {
    private var running = false
    private var waiters: [(UUID, CheckedContinuation<Void, any Error>)] = []
    private let maximumWaiting: Int

    public init(maximumWaiting: Int) {
        self.maximumWaiting = max(0, maximumWaiting)
    }

    public func run<T: Sendable>(
        _ operation: @Sendable () async throws -> T
    ) async throws -> T {
        try await acquire()
        do {
            try Task.checkCancellation()
            let result = try await operation()
            release()
            return result
        } catch {
            release()
            throw error
        }
    }

    private func acquire() async throws {
        if !running {
            running = true
            return
        }
        guard waiters.count < maximumWaiting else { throw AdmissionError.saturated }

        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                waiters.append((id, continuation))
            }
        } onCancel: {
            Task { await self.cancelWaiter(id) }
        }
    }

    private func release() {
        if waiters.isEmpty {
            running = false
        } else {
            let (_, continuation) = waiters.removeFirst()
            continuation.resume()
        }
    }

    private func cancelWaiter(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.0 == id }) else { return }
        let (_, continuation) = waiters.remove(at: index)
        continuation.resume(throwing: CancellationError())
    }
}

public enum AdmissionError: Error, Equatable {
    case saturated
}
