import FirebaseAuth
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountActionTests {
    @Test func normalAccountConfigurationEnablesNativeAccountActionsAndConfiguredApple() {
        let capabilities = AccountAssembly.capabilities
        #expect(capabilities.profileWrites && capabilities.authenticationChanges)
        #expect(capabilities.accountManagement && !capabilities.isReadOnly)
        #expect(capabilities.appleSignIn)
    }

    @Test(arguments: ["signIn", "link", "reauthenticate"])
    func cancelledGoogleCompletionCannotAuthenticateOrClearANewerAction(_ operation: String) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let session = AccountSession(auth: auth, directory: folder, capabilities: .editableTest)
        let provider = DelayedGoogleCredential()
        let model = AccountModel(session: session, google: provider)
        let use: CredentialUse =
            operation == "signIn" ? .signIn : operation == "link" ? .link : .reauthenticate
        session.setForeground(true)
        auth.select("a")
        try await eventually { session.identity?.uid == "a" }
        model.useGoogle(use)
        let cancelled = try #require(model.action)
        try await eventually { provider.waiting == 1 }
        model.cancel()
        model.useGoogle(use)
        let current = try #require(model.action)
        try await eventually { provider.waiting == 2 }
        provider.finishFirst()
        await cancelled.value
        #expect(auth.credentialUses.isEmpty)
        #expect(model.busy)
        provider.finishFirst()
        await current.value
        #expect(auth.credentialUses == [use])
        #expect(!model.busy)
        await session.stopAndWait()
        // Authentication-only tests need not create a personal-data directory.
        if FileManager.default.fileExists(atPath: folder.path) {
            try FileManager.default.removeItem(at: folder)
        }
    }

    @Test func authenticationCapabilityDoesNotEnableProfileOrBillingWrites() async throws {
        let auth = SyntheticAuth()
        let session = AccountSession(
            auth: auth, directory: .temporaryDirectory,
            capabilities: .init(authenticationChanges: true))
        let model = AccountModel(session: session)
        model.resetPassword("synthetic@example.test")
        await model.action?.value
        #expect(auth.passwordResets == 1)
        #expect(!model.capabilities.profileWrites && !model.capabilities.accountManagement)
        #expect(!model.capabilities.appleSignIn)
        let management = AccountCapabilities(accountManagement: true)
        #expect(management.allows(.reauthenticate) && !management.allows(.link))
        #expect(!management.authenticationChanges && !management.profileWrites)
        let profileOnly = AccountModel(
            session: AccountSession(
                auth: auth,
                directory: .temporaryDirectory, capabilities: .init(profileWrites: true)))
        profileOnly.resetPassword("synthetic@example.test")
        #expect(profileOnly.action == nil && auth.passwordResets == 1)
    }
}

/// Deliberately ignores cancellation like a late external completion callback.
@MainActor private final class DelayedGoogleCredential: GoogleCredentialProviding {
    let isConfigured = true
    private var completions: [CheckedContinuation<AuthCredential, Never>] = []
    var waiting: Int { completions.count }
    func credential() async throws -> AuthCredential {
        await withCheckedContinuation { completions.append($0) }
    }
    func finishFirst() {
        guard !completions.isEmpty else { return }
        completions.removeFirst().resume(
            returning:
                EmailAuthProvider.credential(
                    withEmail: "synthetic@example.test", password: "SyntheticOnly123!"))
    }
    func handle(_ url: URL) -> Bool { false }
}
