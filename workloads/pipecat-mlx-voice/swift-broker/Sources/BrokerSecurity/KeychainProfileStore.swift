#if canImport(Security)
    import BrokerCore
    import Foundation
    import Security

    public actor KeychainProfileStore: SpeakerProfileStore {
        private let service: String
        private let account: String

        public init(
            service: String = "dev.agent-workload-platform.pipecat-swift-broker",
            account: String = "owner-speaker-profile"
        ) {
            self.service = service
            self.account = account
        }

        public func load() throws -> SpeakerProfile? {
            var result: CFTypeRef?
            var query = identityQuery()
            query[kSecReturnData] = true
            query[kSecMatchLimit] = kSecMatchLimitOne
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess, let data = result as? Data else {
                throw KeychainError.operationFailed(status)
            }
            do {
                return try JSONDecoder().decode(SpeakerProfile.self, from: data)
            } catch {
                throw KeychainError.invalidStoredProfile
            }
        }

        public func save(_ profile: SpeakerProfile) throws {
            let data = try JSONEncoder().encode(profile)
            let attributes: [CFString: Any] = [kSecValueData: data]
            let updateStatus = SecItemUpdate(
                identityQuery() as CFDictionary, attributes as CFDictionary)
            if updateStatus == errSecSuccess { return }
            guard updateStatus == errSecItemNotFound else {
                throw KeychainError.operationFailed(updateStatus)
            }

            var query = identityQuery()
            query[kSecValueData] = data
            query[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(query as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.operationFailed(addStatus) }
        }

        public func delete() throws {
            let status = SecItemDelete(identityQuery() as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw KeychainError.operationFailed(status)
            }
        }

        private func identityQuery() -> [CFString: Any] {
            [
                kSecClass: kSecClassGenericPassword,
                kSecAttrService: service,
                kSecAttrAccount: account,
                kSecUseDataProtectionKeychain: true,
            ]
        }
    }

    public enum KeychainError: Error, Equatable {
        case invalidStoredProfile
        case operationFailed(OSStatus)
    }
#endif
