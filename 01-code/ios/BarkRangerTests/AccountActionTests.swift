import FirebaseAuth
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountActionTests {
    @Test func normalAccountConfigurationEnablesNativeAccountActionsAndConfiguredApple() {
        let capabilities = AccountAssembly.capabilities
        #expect(capabilities.profileWrites && capabilities.authenticationChanges)
        #expect(capabilities.accountManagement && !capabilities.isReadOnly)
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
