import FirebaseAuth
import GoogleSignIn
import UIKit

/// A credential boundary permits controlled late completion tests without opening provider UI.
@MainActor protocol GoogleCredentialProviding {
    var isConfigured: Bool { get }
    func credential() async throws -> AuthCredential
    func handle(_ url: URL) -> Bool
}

/// Native provider UI; the owning account model decides sign-in, linking or reauthentication.
@MainActor struct GoogleSignInAdapter: GoogleCredentialProviding {
    let clientID: String?
    let serverClientID: String?
    var isConfigured: Bool { clientID?.isEmpty == false }
    func credential() async throws -> AuthCredential {
        guard let clientID, !clientID.isEmpty,
            let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
            var presenter = scene.keyWindow?.rootViewController
        else { throw AccountFailure.configuration }
        while let next = presenter.presentedViewController { presenter = next }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: clientID, serverClientID: serverClientID)
        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        guard let token = result.user.idToken?.tokenString else { throw AccountFailure.configuration }
        return GoogleAuthProvider.credential(
            withIDToken: token, accessToken: result.user.accessToken.tokenString)
    }
    func handle(_ url: URL) -> Bool { GIDSignIn.sharedInstance.handle(url) }
}
