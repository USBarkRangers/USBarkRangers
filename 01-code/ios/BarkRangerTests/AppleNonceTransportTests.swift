import AuthenticationServices
import CryptoKit
import FirebaseAuth
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AppleNonceTransportTests {
    @Test func actualAppleCredentialKeepsItsNonceThroughFirebaseFormEncoding() throws {
        for _ in 0..<64 {
            let adapter = AppleSignInAdapter()
            let request = ASAuthorizationAppleIDProvider().createRequest()
            let id = UUID()
            try adapter.prepare(request, id: id)
            let value = try adapter.consume(
                id: id, state: request.state, token: Data("synthetic-token".utf8), code: nil, name: nil)
            let credential = try #require(value.credential as? OAuthCredential)
            let capture = NonceCapture()
            credential.encode(with: capture)
            let raw = try #require(capture.raw)
            // 32 secure random bytes are represented losslessly as 64 hex characters.
            try #require(raw.count == 64 && raw.allSatisfy { "0123456789abcdef".contains($0) })
            let received = try formRoundTrip(raw)
            #expect(received == raw)
            let digest = SHA256.hash(data: Data(received.utf8)).map { String(format: "%02x", $0) }.joined()
            #expect(request.nonce == digest)
        }
    }

    @Test func base64PlusReproducesTheReportedTransportMismatch() throws {
        // Same URLComponents.query transport as Firebase's VerifyAssertionRequest.
        // The form decoder treats an unescaped plus as a space, not the original byte.
        #expect(try formRoundTrip("synthetic+nonce/=") == "synthetic nonce/=")
    }

    private func formRoundTrip(_ nonce: String) throws -> String {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "nonce", value: nonce)]
        let body = try #require(components.query)
        let encodedValue = String(body.dropFirst("nonce=".count))
        return try #require(encodedValue.replacingOccurrences(of: "+", with: " ").removingPercentEncoding)
    }
}

/// Reads only synthetic credentials through Firebase's public secure-coding boundary.
nonisolated private final class NonceCapture: NSCoder {
    var raw: String?
    override var allowsKeyedCoding: Bool { true }
    override func encode(_ objv: Any?, forKey key: String) {
        if key == "rawNonce" { raw = objv as? String }
    }
}
