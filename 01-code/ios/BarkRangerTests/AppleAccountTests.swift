import AuthenticationServices
import FirebaseAuth
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AppleAccountTests {
    @Test func unavailableAppleSignInHasActionableNontechnicalMessage() {
        let message = AccountModel.message(ASAuthorizationError(.unknown))
        #expect(message.contains("Settings") && message.contains("try again"))
        #expect(!message.contains("AuthorizationError") && !message.contains("1000"))
    }

    @Test func adapterUsesFreshNonceStateAndConsumesEachReplyOnce() throws {
        let adapter = AppleSignInAdapter()
        let first = ASAuthorizationAppleIDProvider().createRequest()
        let second = ASAuthorizationAppleIDProvider().createRequest()
        let oldID = UUID()
        let id = UUID()
        try adapter.prepare(first, id: oldID)
        try adapter.prepare(second, id: id)
        #expect(first.nonce?.count == 64 && second.nonce?.count == 64)
        #expect(first.nonce != second.nonce)
        #expect(first.state == oldID.uuidString && second.state == id.uuidString)
        #expect(second.requestedScopes == [.fullName, .email])
        #expect(throws: AccountFailure.cancelled) {
            try adapter.consume(
                id: oldID, state: first.state, token: Data("test-only".utf8), code: nil, name: nil)
        }
        let result = try adapter.consume(
            id: id, state: second.state, token: Data("test-only".utf8),
            code: Data("ephemeral-code".utf8), name: PersonNameComponents())
        #expect(result.credential.provider == "apple.com")
        #expect(result.authorizationCode == "ephemeral-code")
        #expect(throws: AccountFailure.cancelled) {
            try adapter.consume(
                id: id, state: second.state, token: Data("test-only".utf8), code: nil, name: nil)
        }
    }

    @Test(arguments: ["wrong-state", "missing-token", "empty-token", "invalid-utf8", "cancelled"])
    func adapterRejectsInvalidOrCancelledReplies(_ scenario: String) throws {
        let adapter = AppleSignInAdapter()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        let id = UUID()
        try adapter.prepare(request, id: id)
        if scenario == "cancelled" { adapter.cancel() }
        let token: Data? =
            scenario == "missing-token"
            ? nil
            : scenario == "empty-token"
                ? Data()
                : scenario == "invalid-utf8" ? Data([0xFF]) : Data("test-only".utf8)
        #expect(throws: AccountFailure.self) {
            try adapter.consume(
                id: id, state: scenario == "wrong-state" ? "wrong" : request.state,
                token: token, code: nil, name: nil)
        }
    }

    @Test(arguments: [AppleAccountAction.signIn, .link, .reauthenticate])
    func ordinaryActionsUseTheExistingAuthenticationBoundary(_ intent: AppleAccountAction) async throws {
        let f = try await fixture(signIn: intent != .signIn)
        let apple = SyntheticAppleCredential()
        let model = AccountModel(session: f.session, apple: apple)
        let id = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: intent))
        #expect(model.busy)
        model.finishApple(.failure(AccountFailure.configuration), id: id)
        await model.action?.value
        #expect(f.auth.credentialUses == [intent.credentialUse])
        #expect(f.auth.revokedAppleUIDs.isEmpty && !model.busy)
        try await f.close()
    }

    @Test func cancelledOldCallbackCannotConsumeANewerRequest() async throws {
        let f = try await fixture()
        let apple = SyntheticAppleCredential()
        let model = AccountModel(session: f.session, apple: apple)
        let oldID = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .link))
        model.cancel()
        let current = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .link))
        model.finishApple(.failure(AccountFailure.configuration), id: oldID)
        #expect(model.busy && apple.consumed.isEmpty && f.auth.credentialUses.isEmpty)
        model.finishApple(.failure(AccountFailure.configuration), id: current)
        await model.action?.value
        #expect(apple.consumed == [current] && f.auth.credentialUses == [.link])
        try await f.close()
    }

    @Test func cancellationFromAppleIsQuietAndOtherActionsCannotRunBehindItsSheet() async throws {
        let f = try await fixture()
        let apple = SyntheticAppleCredential()
        apple.failure = ASAuthorizationError(.canceled)
        let model = AccountModel(session: f.session, apple: apple)
        let id = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .link))
        model.signOut()
        #expect(model.action == nil && f.session.identity?.uid == "a")
        model.finishApple(.failure(AccountFailure.configuration), id: id)
        #expect(!model.busy && model.notice == nil && f.auth.credentialUses.isEmpty)
        try await f.close()
    }

    @Test func accountSwitchDiscardsTheAppleReply() async throws {
        let f = try await fixture()
        let apple = SyntheticAppleCredential()
        let model = AccountModel(session: f.session, apple: apple)
        let id = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .link))
        f.auth.select("b")
        try await eventually { f.session.identity?.uid == "b" }
        model.finishApple(.failure(AccountFailure.configuration), id: id)
        #expect(!model.busy && apple.consumed.isEmpty && f.auth.credentialUses.isEmpty)
        try await f.close()
    }

    @Test func deletionReauthenticatesThenRevokesThenUsesTheNativeDeletionLifecycle() async throws {
        var events: [String] = []
        let f = try await fixture(deleteAccount: { events.append("delete:\($0)") })
        f.auth.select("a", providers: ["password", "apple.com"])
        try await eventually { f.session.identity?.providers.contains("apple.com") == true }
        f.auth.credentialWork = { events.append("reauthenticate") }
        f.auth.revocationWork = { events.append("revoke") }
        let model = AccountModel(session: f.session, apple: SyntheticAppleCredential())
        model.deleteAccount()
        #expect(events.isEmpty && model.notice?.contains("Confirm with Apple") == true)
        let id = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .deleteAccount))
        model.finishApple(.failure(AccountFailure.configuration), id: id)
        await model.action?.value
        #expect(events == ["reauthenticate", "revoke", "delete:a"])
        #expect(f.auth.revokedAppleUIDs == ["a"])
        #expect(f.session.identity == nil)
        try await f.close()
    }

    @Test(arguments: [
        "missing-code", "reauthentication", "revocation", "account-switch", "cancel-reauth", "cancel-revoke",
        "switch-revoke",
    ])
    func failedAppleDeletionPreservesDataAndDoesNotSubmitDeletion(_ failure: String) async throws {
        var deleted: [String] = []
        let f = try await fixture(deleteAccount: { deleted.append($0) })
        let apple = SyntheticAppleCredential()
        if failure == "missing-code" { apple.code = nil }
        if failure == "reauthentication" { f.auth.credentialWork = { throw AccountFailure.configuration } }
        if failure == "revocation" { f.auth.revocationWork = { throw AccountFailure.configuration } }
        if failure == "account-switch" {
            f.auth.credentialWork = {
                f.auth.select("b")
                try await eventually { f.session.identity?.uid == "b" }
            }
        }
        let model = AccountModel(session: f.session, apple: apple)
        if failure == "cancel-reauth" { f.auth.credentialWork = { model.cancel() } }
        if failure == "cancel-revoke" { f.auth.revocationWork = { model.cancel() } }
        if failure == "switch-revoke" {
            f.auth.revocationWork = {
                f.auth.select("b")
                try await eventually { f.session.identity?.uid == "b" }
            }
        }
        let id = try #require(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .deleteAccount))
        model.finishApple(.failure(AccountFailure.configuration), id: id)
        await model.action?.value
        #expect(deleted.isEmpty)
        // An already-started network revocation can finish after cancellation;
        // cancellation must still prevent submitting the deletion request.
        #expect(f.auth.revokedAppleUIDs == (failure == "cancel-revoke" ? ["a"] : []))
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)
        #expect(
            FileManager.default.fileExists(
                atPath:
                    try NativeStore.scopeDirectory(
                        directory: f.directory, project: "demo-bark-native", uid: "a"
                    ).path))
        f.auth.credentialWork = nil
        f.auth.revocationWork = nil
        try await f.close()
    }

    private func fixture(
        signIn: Bool = true,
        deleteAccount: (@MainActor @Sendable (String) async throws -> Void)? = nil
    ) async throws -> NativeOfflineAccountFixture {
        try await .make(
            capabilities: .init(
                profileWrites: true, authenticationChanges: true, accountManagement: true, appleSignIn: true),
            signIn: signIn, deleteAccount: deleteAccount)
    }
}

/// Only replaces the external Apple sheet. It does not validate real Apple tokens;
/// that acceptance remains a separate device/Firebase gate.
@MainActor private final class SyntheticAppleCredential: AppleCredentialProviding {
    var code: String? = "synthetic-one-use-code"
    var failure: (any Error)?
    private(set) var consumed: [UUID] = []
    func prepare(_ request: ASAuthorizationAppleIDRequest, id: UUID) throws {}
    func credential(_ result: Result<ASAuthorization, any Error>, id: UUID) throws -> AppleAccountCredential {
        if let failure { throw failure }
        consumed.append(id)
        return .init(
            credential: EmailAuthProvider.credential(
                withEmail: "synthetic@example.test", password: "SyntheticOnly123!"), authorizationCode: code)
    }
    func cancel() {}
}
