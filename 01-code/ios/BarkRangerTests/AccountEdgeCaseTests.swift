import AuthenticationServices
import FirebaseAuth
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountEdgeCaseTests {
    @Test func authenticationErrorsDoNotExposeTokensOrAccountIdentifiers() {
        for code in [
            AuthErrorCode.credentialAlreadyInUse, .emailAlreadyInUse, .accountExistsWithDifferentCredential,
            .providerAlreadyLinked, .invalidCredential, .wrongPassword, .networkError, .userMismatch,
            .requiresRecentLogin, .tooManyRequests, .internalError,
        ] {
            let text = AccountModel.message(
                NSError(
                    domain: AuthErrors.domain, code: code.rawValue,
                    userInfo: [NSLocalizedDescriptionKey: "private-token-other-account-email"]))
            #expect(!text.contains("private-token") && !text.isEmpty)
        }
        #expect(
            AccountModel.message(
                NSError(
                    domain: AuthErrors.domain,
                    code: AuthErrorCode.credentialAlreadyInUse.rawValue)
            ).contains("Nothing was moved"))
    }

    @Test func emailTrimmingNeverChangesAPasswordOrCreatesAnAccountWhileSignedIn() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let model = AccountModel(session: f.session)
        model.resetPassword("  Address+tag@example.test \n")
        await model.action?.value
        #expect(f.auth.resetAddresses == ["Address+tag@example.test"])
        model.linkEmail("  Address+tag@example.test \n", password: "  Native password  ")
        await model.action?.value
        #expect(f.auth.passwordInputs.last?.email == "Address+tag@example.test")
        #expect(f.auth.passwordInputs.last?.password == "  Native password  ")
        model.email("other@example.test", password: "NativeOnly123!", create: true)
        #expect(model.action == nil && f.session.identity?.uid == "a")
        try await f.close()
    }

    @Test func newAccountWhoseSetupWasRefusedIsToldWhyItLooksEmpty() async throws {
        let f = try await NativeOfflineAccountFixture.make(signIn: false)
        let store = try await NativeStore.open(directory: f.directory, project: "demo-bark-native", uid: "new")
        try await store.stageBootstrap(replacingRefused: false)
        let sealed = try #require(try await store.nextProfileSubmission())
        try await store.rejectProfileOperation(sealed.id, code: "invalid")
        await store.close()
        f.auth.select("new")
        try await eventually { f.session.message?.contains("could not finish setting up") == true }
        #expect(f.session.profileState?.confirmed == nil && f.session.profileState?.conflict == false)
        try await f.close()
    }

    @Test func alreadyLinkedAppleDoesNotStartAnotherRequest() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        f.auth.select("a", providers: ["password", "apple.com"])
        try await eventually { f.session.identity?.providers.count == 2 }
        let model = AccountModel(session: f.session)
        #expect(model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .link) == nil)
        #expect(!model.busy && model.notice?.contains("already connected") == true)
        model.unlinkApple(password: "NativeOnly123!")
        await model.action?.value
        #expect(f.auth.removals.count == 1)
        #expect(f.auth.removals.first?.provider == "apple.com")
        #expect(f.auth.removals.first?.confirmation == "password" && f.auth.removals.first?.uid == "a")
        try await f.close()
    }

    @Test func lastMethodAndAccountSwitchCannotRemoveCredentials() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let model = AccountModel(session: f.session)
        model.unlinkApple(password: "NativeOnly123!")
        #expect(model.notice?.contains("at least one") == true && f.auth.removals.isEmpty)
        #expect(
            model.prepareApple(ASAuthorizationAppleIDProvider().createRequest(), intent: .unlinkPassword)
                == nil)
        f.auth.select("a", providers: ["password", "apple.com"])
        try await eventually { f.session.identity?.providers.count == 2 }
        f.auth.removalWork = {
            f.auth.select("b")
            try await eventually { f.session.identity?.uid == "b" }
        }
        model.unlinkApple(password: "NativeOnly123!")
        await model.action?.value
        #expect(f.auth.removals.isEmpty && f.session.identity?.uid == "b")
        f.auth.removalWork = nil
        try await f.close()
    }
}
