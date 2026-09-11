import AuthenticationServices
import CryptoKit
import FirebaseAuth
import Foundation
import Security

/// Nonce ownership lasts for one Apple request; neither tokens nor nonces enter logs or persistence.
@MainActor final class AppleSignInAdapter {
    private var nonce: String?
    private(set) var authorizationCode: String?
    func prepare(_ request: ASAuthorizationAppleIDRequest) throws {
        authorizationCode = nil
        nonce = nil
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw AccountFailure.configuration
        }
        let raw = Data(bytes).base64EncodedString()
        nonce = raw
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    func credential(_ result: Result<ASAuthorization, any Error>) throws -> AuthCredential {
        defer { nonce = nil }
        guard let nonce else { throw AccountFailure.cancelled }
        let authorization = try result.get()
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let token = credential.identityToken, let text = String(data: token, encoding: .utf8)
        else {
            throw AccountFailure.configuration
        }
        authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        return OAuthProvider.appleCredential(
            withIDToken: text, rawNonce: nonce, fullName: credential.fullName)
    }
    func cancel() {
        nonce = nil
        authorizationCode = nil
    }
}
