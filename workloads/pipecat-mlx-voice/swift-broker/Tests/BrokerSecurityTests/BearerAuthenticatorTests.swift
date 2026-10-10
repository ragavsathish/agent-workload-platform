import Testing

@testable import BrokerSecurity

@Test func bearerAuthenticationRequiresExactCredential() {
    let token = String(repeating: "correct", count: 8)
    let authenticator = BearerAuthenticator(token: token)
    #expect(authenticator.accepts(authorizationHeader: "Bearer \(token)"))
    #expect(!authenticator.accepts(authorizationHeader: "Bearer wrong"))
    #expect(!authenticator.accepts(authorizationHeader: token))
    #expect(!authenticator.accepts(authorizationHeader: nil))
}
