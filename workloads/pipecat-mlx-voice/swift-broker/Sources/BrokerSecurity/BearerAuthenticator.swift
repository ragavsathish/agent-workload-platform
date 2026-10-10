import Foundation

#if canImport(CryptoKit)
    import CryptoKit
#else
    import Crypto
#endif

public struct BearerAuthenticator: Sendable {
    private let key: SymmetricKey
    private let expectedCode: Data

    public init(token: String) {
        key = SymmetricKey(size: .bits256)
        expectedCode = Data(HMAC<SHA256>.authenticationCode(for: Data(token.utf8), using: key))
    }

    public func accepts(authorizationHeader: String?) -> Bool {
        guard let authorizationHeader, authorizationHeader.hasPrefix("Bearer ") else {
            return false
        }
        let token = authorizationHeader.dropFirst("Bearer ".count)
        guard !token.isEmpty, !token.contains(where: \Character.isWhitespace) else { return false }
        return HMAC<SHA256>.isValidAuthenticationCode(
            expectedCode, authenticating: Data(token.utf8), using: key)
    }
}
