import XCTest

nonisolated final class NativeAccountUITests: XCTestCase {
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
        email.tap(); email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("NativeOnly123!")
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        dismissPasswordPrompt(app)
        XCTAssertTrue(app.textFields["New display name"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.buttons["New trip"].waitForExistence(timeout: 10))
        app.buttons["New trip"].tap()
        let field = app.textFields["trip-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let title = "Native screen trip"
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count) + title + "\n")
        app.buttons["Add day"].tap()
        app.alerts.buttons["Add Day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.buttons["Save to account"].tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Saved on this iPhone'"),
            object: app.staticTexts["trip-save-status"])
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 10), .completed)
        attach(app, name: "Native trip saved through Planner")
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.buttons["map-displayed-trip"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["map-displayed-trip"].label, title)
        app.terminate(); app.launch()
        app.tabBars.buttons["Trips"].tap()
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", title), object: field)
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
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText(address)
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText(password)
        app.keyboards.buttons["Done"].tap()
        let create = app.switches["Create a new account"]
        create.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertEqual(create.value as? String, "1")
        app.buttons["Create account"].tap()
        dismissPasswordPrompt(app)
        XCTAssertTrue(app.staticTexts["Ranger"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.textFields["New display name"].exists)
        XCTAssertFalse(app.buttons["Manage existing subscription"].exists)
        XCTAssertFalse(app.buttons["Recover existing membership"].exists)

        signOut(app)
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText(password)
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        dismissPasswordPrompt(app)
        let name = "Ranger \(UUID().uuidString.prefix(8))"
        let field = app.textFields["New display name"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        field.typeText(name)
        app.buttons["Save display name"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 10))
        app.swipeDown()
        app.swipeDown()
        attach(app, name: "Native account saved profile")

        openSettings(app)
        // The emulator account survives reruns. Exercise a real change from its
        // current setting instead of assuming the preceding run left Standard.
        let appearance = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Map appearance, '")).firstMatch
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
        let button = app.buttons["Sign out"]
        for _ in 0..<12 where !button.isHittable { app.swipeUp() }
        XCTAssertTrue(button.isHittable)
        button.tap()
    }
    @MainActor private func dismissPasswordPrompt(_ app: XCUIApplication) {
        guard app.buttons["Not Now"].waitForExistence(timeout: 5) else { return }
        // iOS 26 embeds a remote credential service. Tapping its mirrored button
        // through the host app sends an event to the wrong process and does nothing.
        for bundle in [
            "com.apple.AuthenticationServicesUI", "com.apple.SafariViewService", "com.apple.springboard",
        ] {
            let service = XCUIApplication(bundleIdentifier: bundle)
            let button = service.buttons["Not Now"]
            if button.exists {
                button.tap()
                XCTAssertTrue(app.buttons["Not Now"].waitForNonExistence(timeout: 5))
                return
            }
        }
        XCTFail("Cannot address the system password prompt; no synthetic password was saved.")
    }
}
