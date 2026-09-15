import AuthenticationServices
import CryptoKit
import FirebaseAuth
import Foundation
import Security

struct AppleAccountCredential {
    let credential: AuthCredential
    let authorizationCode: String?
}

@MainActor protocol AppleCredentialProviding {
    func prepare(_ request: ASAuthorizationAppleIDRequest, id: UUID) throws
    func credential(_ result: Result<ASAuthorization, any Error>, id: UUID) throws -> AppleAccountCredential
    func cancel()
}

/// Nonce ownership lasts for one request. Tokens/codes are returned to that action only,
/// never cached for later deletion, logged or persisted. Firebase verifies the signed token.
@MainActor final class AppleSignInAdapter: AppleCredentialProviding {
    private var pending: (id: UUID, nonce: String)?
    func prepare(_ request: ASAuthorizationAppleIDRequest, id: UUID) throws {
        pending = nil
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw AccountFailure.configuration
        }
        // Firebase sends this through a form-encoded OAuth body. Base64 '+' can
        // become a space there; hex preserves all 256 random bits without escaping.
        let raw = bytes.map { String(format: "%02x", $0) }.joined()
        pending = (id, raw)
        request.state = id.uuidString
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    func credential(_ result: Result<ASAuthorization, any Error>, id: UUID) throws -> AppleAccountCredential {
        guard pending?.id == id else { throw AccountFailure.cancelled }
        do {
            let authorization = try result.get()
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                throw AccountFailure.configuration
            }
            return try consume(
                id: id, state: credential.state, token: credential.identityToken,
                code: credential.authorizationCode, name: credential.fullName)
        } catch {
            pending = nil
            throw error
        }
    }
    /// The real callback and boundary tests use the same one-use decoder.
    func consume(id: UUID, state: String?, token: Data?, code: Data?, name: PersonNameComponents?) throws
        -> AppleAccountCredential
    {
        guard let pending, pending.id == id else { throw AccountFailure.cancelled }
        defer { self.pending = nil }
        guard state == id.uuidString, let token, let text = String(data: token, encoding: .utf8),
            !text.isEmpty
        else {
            throw AccountFailure.configuration
        }
        return AppleAccountCredential(
            // Apple supplies the name only on first consent. Let Firebase retain
            // it on the identity; do not copy it into the public leaderboard name.
            credential: OAuthProvider.appleCredential(
                withIDToken: text, rawNonce: pending.nonce, fullName: name),
            authorizationCode: code.flatMap { String(data: $0, encoding: .utf8) })
    }
    func cancel() {
        pending = nil
    }
}
