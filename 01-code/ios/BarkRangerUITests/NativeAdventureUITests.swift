import XCTest

nonisolated final class NativeAdventureUITests: XCTestCase {
    @MainActor func testMapVisitHistoryDateDialogRemovalAndNativeLeaderboard() throws {
        let app = try launch()
        app.tabBars.buttons["Map"].tap()
        let search = app.textFields["park-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("Cedar Hill")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'park-result-'"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        let visit = app.buttons.matching(NSPredicate(format: "label == 'Record visit' OR label == 'Visited'"))
            .firstMatch
        for _ in 0..<5 where !visit.isHittable { app.buttons["Directions in Apple Maps"].swipeLeft() }
        XCTAssertTrue(visit.isHittable)
        visit.tap()
        app.buttons["Mark visited"].tap()
        app.tabBars.buttons["Passport"].tap()
        let history = app.buttons["passport-stat-Sites Visited"]
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        history.tap()
        let park = app.staticTexts["Cedar Hill State Park"]
        XCTAssertTrue(park.waitForExistence(timeout: 15))
        app.buttons.matching(identifier: "Edit date").firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Visit date"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Changing the date keeps the visit's original evidence tier."].exists)
        app.buttons["Cancel"].tap()
        app.navigationBars["Visit history"].buttons["Edit"].tap()
        park.tap()
        let remove = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Remove selected ('"))
            .firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        remove.tap()
        app.buttons["Remove visits"].tap()
        XCTAssertTrue(park.waitForNonExistence(timeout: 10))
        capture(app, "Native visit history after reviewed removal")
        app.navigationBars.buttons["Passport"].tap()
        let leaderboard = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Leaderboard'")).firstMatch
        reveal(app, leaderboard)
        leaderboard.tap()
        XCTAssertTrue(app.staticTexts["Top 5 Rangers"].waitForExistence(timeout: 10))
        let rows = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'leaderboard-row-'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15))
        XCTAssertLessThanOrEqual(rows.count, 6)
        XCTAssertFalse(app.staticTexts["Leaderboard is unavailable in this build."].exists)
        capture(app, "Native top five and separate personal standing")
        app.terminate()
    }

    @MainActor func testWalkAssignmentManualCorrectionRelaunchAndRemoval() throws {
        let app = try launch()
        openWalks(app)
        app.buttons["Choose trail"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Angels Landing'")).firstMatch.tap()
        if app.buttons["Start new trail"].waitForExistence(timeout: 2) {
            app.buttons["Start new trail"].tap()
        }
        let miles = app.textFields["Miles"]
        reveal(app, miles)
        miles.tap()
        miles.typeText("2.5")
        app.buttons["Add miles"].tap()
        XCTAssertTrue(app.staticTexts["Saved on this iPhone"].waitForExistence(timeout: 10))
        let history = app.buttons["Walk history"]
        reveal(app, history)
        history.tap()
        let actions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'walk-actions-'"))
            .firstMatch
        XCTAssertTrue(actions.waitForExistence(timeout: 10))
        actions.tap()
        app.buttons["Edit walk"].tap()
        XCTAssertTrue(app.navigationBars["Edit walk"].waitForExistence(timeout: 5))
        replace(app.textFields["Miles"], with: "1.25")
        let name = "Native UI walk \(UUID().uuidString.prefix(8))"
        replace(app.textFields["Trail name"], with: name)
        app.navigationBars["Edit walk"].buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 10))
        capture(app, "Typed walk correction through the native history screen")
        app.terminate()
        app.launch()
        openWalks(app)
        reveal(app, history)
        history.tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 15))
        app.buttons["Actions for \(name)"].tap()
        app.buttons["Remove walk"].tap()
        app.buttons["Remove walk"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForNonExistence(timeout: 10))
        capture(app, "Native walk removal after relaunch")
        app.terminate()
    }

    @MainActor private func launch() throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires isolated demo-bark-native emulators and the native UI fixture.")
        }
        let app = XCUIApplication()
        app.launchEnvironment = [
            "BARK_TEST_SCOPE": UUID().uuidString, "BARK_NATIVE_ACCOUNT_EMULATORS": "1",
            "BARK_EMULATOR_HOST": "127.0.0.1",
            "BARK_CATALOG_URL": "http://127.0.0.1:8787/unchanged/manifest.json",
        ]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Account"].tap()
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("profile-ui@native.invalid")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("NativeOnly123!")
        app.keyboards.buttons["Done"].tap()
        app.buttons["Sign in"].tap()
        if app.buttons["Not Now"].waitForExistence(timeout: 5) {
            for bundle in [
                "com.apple.AuthenticationServicesUI", "com.apple.SafariViewService", "com.apple.springboard",
            ] {
                let service = XCUIApplication(bundleIdentifier: bundle)
                if service.buttons["Not Now"].exists {
                    service.buttons["Not Now"].tap()
                    break
                }
            }
        }
        XCTAssertTrue(app.textFields["New display name"].waitForExistence(timeout: 15))
        return app
    }
    @MainActor private func openWalks(_ app: XCUIApplication) {
        XCTAssertTrue(app.tabBars.buttons["Passport"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Passport"].tap()
        let button = app.buttons["Walks & expeditions"]
        reveal(app, button)
        button.tap()
        XCTAssertTrue(app.buttons["Choose trail"].waitForExistence(timeout: 10))
    }
    @MainActor private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<8 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    @MainActor private func replace(_ field: XCUIElement, with text: String) {
        field.tap()
        field.typeText(
            String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count)
                + text)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ title: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = title
        image.lifetime = .keepAlways
        add(image)
    }
}
