import XCTest

nonisolated final class NativeAccountUITests: XCTestCase {
    @MainActor func testCreateAndPasswordResetAreExplicitAndNeverCarryAPasswordBetweenModes() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators.")
        }
        let app = XCUIApplication()
        app.launchEnvironment = [
            "BARK_TEST_SCOPE": UUID().uuidString,
            "BARK_NATIVE_ACCOUNT_EMULATORS": "1", "BARK_EMULATOR_HOST": "127.0.0.1",
        ]
        app.launch()
        openAccount(app)
        XCTAssertFalse(app.buttons["Continue with Google"].exists)
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("NotRetained123!")
        app.keyboards.buttons["Done"].tap()
        app.buttons["account.create-mode"].tap()
        XCTAssertTrue(app.buttons["Create account"].exists)
        XCTAssertEqual(app.secureTextFields["Password"].value as? String, "Password")
        XCTAssertEqual(email.value as? String, "profile-ui@native.invalid")
        app.buttons["Back to sign in"].tap()
        app.buttons["Forgot password?"].tap()
        XCTAssertFalse(app.secureTextFields["Password"].exists)
        app.buttons["Send reset email"].tap()
        let sent = app.staticTexts[
            "If an account uses that email, password reset instructions are available."]
        XCTAssertTrue(sent.waitForExistence(timeout: 10))
        attach(app, name: "Explicit password reset — no retained password")
        app.terminate()
    }

    @MainActor func testAccountCardsInBothAppearancesAndLargeTextKeepActionsReachable() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators.")
        }
        let originalAppearance = XCUIDevice.shared.appearance
        defer { XCUIDevice.shared.appearance = originalAppearance }
        for (appearance, premium, size) in [
            (XCUIDevice.Appearance.light, false, "UICTContentSizeCategoryL"),
            (.dark, false, "UICTContentSizeCategoryL"),
            (.light, true, "UICTContentSizeCategoryAccessibilityXXXL"),
            (.dark, true, "UICTContentSizeCategoryAccessibilityXXXL"),
        ] {
            XCUIDevice.shared.appearance = appearance
            let app = XCUIApplication()
            app.launchEnvironment = [
                "BARK_TEST_SCOPE": UUID().uuidString, "BARK_NATIVE_ACCOUNT_EMULATORS": "1",
                "BARK_EMULATOR_HOST": "127.0.0.1",
            ]
            app.launchArguments = ["-UIPreferredContentSizeCategoryName", size]
            app.launch()
            openAccount(app)
            if !premium {
                let create = app.buttons["account.create-mode"]
                reveal(create, in: app)
                create.tap()
            }
            let email = app.textFields["Email"]
            reveal(email, in: app)
            email.tap()
            email.typeText(
                premium ? "profile-ui@native.invalid" : "cards-\(UUID().uuidString)@native.invalid")
            enterPassword("NativeOnly123!", creating: !premium, in: app)
            let authenticate = app.buttons[premium ? "Sign in" : "Create account"]
            reveal(authenticate, in: app)
            authenticate.tap()
            XCTAssertTrue(
                app.staticTexts[premium ? "Premium Plan" : "Free Plan"].waitForExistence(timeout: 15))
            dismissPasswordPrompt(in: app)
            attach(app, name: "Account cards \(appearance.rawValue) \(size)")
            XCTAssertFalse(app.textFields["New display name"].exists)
            XCTAssertFalse(app.buttons["account.delete"].exists)
            let edit = app.buttons["account.edit-profile"]
            reveal(edit, in: app)
            edit.tap()
            XCTAssertTrue(app.navigationBars["Edit Profile"].waitForExistence(timeout: 5))
            if premium {
                reveal(app.textFields["New display name"], in: app)
            } else {
                XCTAssertFalse(app.textFields["New display name"].exists)
                XCTAssertTrue(app.buttons["premium.open"].exists)
            }
            app.navigationBars.buttons["Account"].tap()
            reveal(app.buttons["account.sync"], in: app)
            attach(app, name: "Account settings rows \(appearance.rawValue) \(size)")
            app.buttons["account.sync"].tap()
            XCTAssertTrue(app.navigationBars["Pending changes"].waitForExistence(timeout: 5))
            XCTAssertEqual(app.buttons.matching(identifier: "Sync now").count, 1)
            app.navigationBars.buttons["Account"].tap()
            if !premium {
                reveal(app.buttons["account.privacy"], in: app)
                app.buttons["account.privacy"].tap()
                XCTAssertTrue(app.navigationBars["Data & Privacy"].waitForExistence(timeout: 5))
                app.buttons["Privacy policy"].tap()
                XCTAssertTrue(app.navigationBars["Privacy policy"].waitForExistence(timeout: 5))
                app.navigationBars.buttons["Data & Privacy"].tap()
                app.navigationBars.buttons["Account"].tap()
                reveal(app.buttons["account.subscription"], in: app)
                app.buttons["account.subscription"].tap()
                XCTAssertTrue(app.navigationBars["Premium"].waitForExistence(timeout: 5))
                app.buttons["Done"].tap()
                app.buttons["account.settings"].tap()
                XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
                app.buttons["Done"].tap()
                reveal(app.buttons["account.support"], in: app)
                app.buttons["account.support"].tap()
                XCTAssertTrue(app.navigationBars["Help & feedback"].waitForExistence(timeout: 5))
                app.buttons["Done"].tap()
            }
            signOut(app)
            XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 5))
            // At accessibility XXXL, the welcome copy fills the first viewport;
            // SwiftUI's lazy form does not instantiate the email cell until scrolled.
            reveal(email, in: app)
            XCTAssertTrue(email.waitForExistence(timeout: 10))
            XCTAssertFalse(app.staticTexts["account.profile-name"].exists)
            app.terminate()
        }
    }

    @MainActor func testPendingChangesOpensWithOneSyncActionAndNoPerItemNavigation() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_NATIVE_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        openAccount(app)
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("NativeOnly123!")
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.staticTexts["Premium Plan"].waitForExistence(timeout: 15))
        dismissPasswordPrompt(in: app)
        let pending = app.buttons["account.sync"]
        reveal(pending, in: app, maximumSwipes: 10)
        pending.tap()
        XCTAssertTrue(app.navigationBars["Pending changes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["No pending changes"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(identifier: "Sync now").count, 1)
        XCTAssertFalse(app.buttons["Open"].exists)
        XCTAssertFalse(app.buttons["Retry"].exists)
        app.buttons["Sync now"].tap()
        XCTAssertTrue(app.staticTexts["No pending changes"].exists)
        attach(app, name: "Native local pending list")
        app.terminate()
    }

    @MainActor func testTappingFormBackgroundDismissesKeyboardAndInputsCanRefocus() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_NATIVE_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        openAccount(app)
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("keyboard@native.invalid")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        email.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(email.value as? String, "keyboard@native.invalid")
        app.terminate()
    }

    @MainActor func testNativeTripSaveMapAndRelaunchThroughCurrentScreens() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_NATIVE_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        openAccount(app)
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("NativeOnly123!")
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.staticTexts["Premium Plan"].waitForExistence(timeout: 15))
        dismissPasswordPrompt(in: app)
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.buttons["New trip"].waitForExistence(timeout: 10))
        app.buttons["New trip"].tap()
        let field = app.textFields["trip-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let title = "Native screen trip"
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(
            String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count)
                + title + "\n")
        app.buttons["Add day"].tap()
        app.alerts.buttons["Add Day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.buttons["Save to account"].tap()
        let saved = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS 'Saved on this iPhone'"),
            object: app.staticTexts["trip-save-status"])
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 10), .completed)
        attach(app, name: "Native trip saved through Planner")
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.buttons["map-displayed-trip"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["map-displayed-trip"].label, title)
        app.terminate()
        app.launch()
        app.tabBars.buttons["Trips"].tap()
        let restored = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", title), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 15), .completed)
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        attach(app, name: "Native trip and device day restored")
        app.terminate()
    }
    @MainActor func testCreateEditAppearanceRelaunchAndSignOutThroughNativeScreens() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_NATIVE_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        openAccount(app)
        let address = "ui-\(UUID().uuidString.lowercased())@native.invalid"
        let password = "NativeOnly123!"
        app.buttons["account.create-mode"].tap()
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText(address)
        enterPassword(password, creating: true, in: app)
        app.buttons["Create account"].tap()
        XCTAssertTrue(app.staticTexts["Ranger"].waitForExistence(timeout: 15))
        // Exercise late sheet handling in reveal(), not just immediate dismissal
        // here. Apple's remote password UI can finish loading after this profile.
        let editProfile = app.buttons["account.edit-profile"]
        reveal(editProfile, in: app)
        editProfile.tap()
        XCTAssertFalse(app.textFields["New display name"].exists)
        XCTAssertFalse(app.buttons["Manage existing subscription"].exists)
        XCTAssertFalse(app.buttons["Recover existing membership"].exists)
        app.navigationBars.buttons["Account"].tap()

        signOut(app)
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText(password)
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        let name = "Ranger \(UUID().uuidString.prefix(8))"
        XCTAssertTrue(app.staticTexts["Premium Plan"].waitForExistence(timeout: 15))
        reveal(app.buttons["account.edit-profile"], in: app)
        app.buttons["account.edit-profile"].tap()
        let field = app.textFields["New display name"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        dismissPasswordPrompt(in: app)
        field.tap()
        field.typeText(name)
        app.buttons["Save display name"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 10))
        app.navigationBars.buttons["Account"].tap()
        attach(app, name: "Native account saved profile")

        openSettings(app)
        // The emulator account survives reruns. Exercise a real change from its
        // current setting instead of assuming the preceding run left Standard.
        let appearance = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Map appearance, '"))
            .firstMatch
        XCTAssertTrue(appearance.waitForExistence(timeout: 10))
        let nextAppearance = appearance.label == "Map appearance, Standard" ? "Satellite" : "Standard"
        XCTAssertTrue(["Map appearance, Standard", "Map appearance, Satellite"].contains(appearance.label))
        appearance.tap()
        app.buttons[nextAppearance].tap()
        app.terminate()
        app.launch()
        openAccount(app)
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 15))
        openSettings(app)
        XCTAssertTrue(app.buttons["Map appearance, \(nextAppearance)"].waitForExistence(timeout: 10))
        app.buttons["Done"].tap()
        openAccount(app)
        signOut(app)
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts[name].exists)
        XCTAssertEqual(email.value as? String, "Email")
        openSettings(app)
        XCTAssertTrue(app.buttons["Map appearance, Standard"].waitForExistence(timeout: 10))
        attach(app, name: "Signed-out device appearance remains separate")
        app.terminate()
    }

    @MainActor func testDisposableNativeAccountDeletionRequiresConfirmationAndReturnsToSignIn() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_NATIVE_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        openAccount(app)
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        app.buttons["account.create-mode"].tap()
        email.tap()
        email.typeText("ui-delete-\(UUID().uuidString.lowercased())@native.invalid")
        enterPassword("NativeOnly123!", creating: true, in: app)
        app.buttons["Create account"].tap()
        XCTAssertTrue(app.staticTexts["Ranger"].waitForExistence(timeout: 15))
        dismissPasswordPrompt(in: app)
        reveal(app.buttons["account.privacy"], in: app)
        app.buttons["account.privacy"].tap()
        let remove = app.buttons["account.delete"]
        reveal(remove, in: app)
        remove.tap()
        app.buttons["Cancel"].tap()
        XCTAssertTrue(remove.exists)
        remove.tap()
        app.buttons["Permanently delete account"].tap()
        XCTAssertTrue(email.waitForExistence(timeout: 20))
        XCTAssertTrue(
            app.staticTexts[
                "Account deletion requested. Device data removed; cloud cleanup continues automatically."
            ].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["account.retry-cleanup"].exists)
        // Do not relaunch yet: deletion must preserve the foreground sync lifecycle
        // so a different account can load its server profile in the same open app.
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("NativeOnly123!")
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.staticTexts["Premium Plan"].waitForExistence(timeout: 15))
        dismissPasswordPrompt(in: app)
        signOut(app)
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        openAccount(app)
        XCTAssertTrue(email.waitForExistence(timeout: 10))
    }

    @MainActor private func openAccount(_ app: XCUIApplication) {
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Account"].tap()
    }
    @MainActor private func openSettings(_ app: XCUIApplication) {
        app.tabBars.buttons["Home"].tap()
        let settings = app.buttons["Settings"]
        for _ in 0..<8 where !settings.isHittable { app.swipeUp() }
        XCTAssertTrue(settings.isHittable)
        settings.tap()
    }
    @MainActor private func attach(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    @MainActor private func signOut(_ app: XCUIApplication) {
        let security = app.buttons["account.security"]
        reveal(security, in: app)
        security.tap()
        let button = app.buttons["Sign out"]
        reveal(button, in: app)
        button.tap()
    }
    @MainActor private func reveal(
        _ element: XCUIElement, in app: XCUIApplication, maximumSwipes: Int = 12
    ) {
        // CI's embedded password sheet did not trigger XCTest interruption
        // monitors. Check it during navigation, not only once after sign-in.
        for _ in 0..<maximumSwipes {
            dismissPasswordPrompt(in: app)
            if element.isHittable { break }
            if app.scrollViews.firstMatch.exists {
                app.scrollViews.firstMatch.swipeUp()
            } else {
                app.collectionViews.firstMatch.swipeUp()
            }
        }
        XCTAssertTrue(element.isHittable)
    }
    @MainActor private func dismissPasswordPrompt(in app: XCUIApplication) {
        // Only query a credential service while its prompt is hosted in this app.
        // CI can time out querying SpringBoard after the sheet has gone away.
        guard app.buttons["Not Now"].exists && app.buttons["Save"].exists else { return }
        // iOS 26 embeds a remote credential service. Tapping its mirrored button
        // through the host app sends an event to the wrong process and does nothing.
        for bundle in [
            "com.apple.AuthenticationServicesUI", "com.apple.SafariViewService", "com.apple.springboard",
        ] {
            let service = XCUIApplication(bundleIdentifier: bundle)
            guard service.state != .notRunning else { continue }
            let button = service.buttons["Not Now"]
            if button.exists && service.buttons["Save"].exists {
                button.tap()
                // The service can retain its detached accessibility tree. What
                // matters is that the prompt no longer covers the tested app.
                XCTAssertTrue(app.buttons["Not Now"].waitForNonExistence(timeout: 5))
                return
            }
        }
    }
    @MainActor private func enterPassword(_ value: String, creating: Bool, in app: XCUIApplication) {
        let field = app.secureTextFields["Password"]
        field.tap()
        // Keep password generation enabled in production. Decline the real iOS
        // suggestion only in this test so the synthetic fixture password is used.
        if creating && app.buttons["GenerateStrongPasswordButton"].waitForExistence(timeout: 3) {
            for bundle in [
                "com.apple.AuthenticationServicesUI", "com.apple.SafariViewService", "com.apple.springboard",
            ] {
                let service = XCUIApplication(bundleIdentifier: bundle)
                guard service.state != .notRunning,
                    service.buttons["GenerateStrongPasswordButton"].exists
                else { continue }
                service.buttons["Close"].tap()
                break
            }
            XCTAssertTrue(app.buttons["GenerateStrongPasswordButton"].waitForNonExistence(timeout: 5))
            field.tap()
        }
        field.typeText(value)
        app.keyboards.buttons["Done"].tap()
    }
}
