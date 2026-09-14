import XCTest

/// Actual native screens against disposable, local-only accounts and support delivery.
nonisolated final class ExpeditionUITests: XCTestCase {
    @MainActor func testCancelledTrailChoiceDoesNotReturnAfterPickerDone() throws {
        let app = try launch()
        open(app, "Walks & expeditions", tab: "Passport")
        let choose = app.buttons["Choose trail"]
        XCTAssertTrue(choose.waitForExistence(timeout: 5))
        let progress = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS ' / ' AND label ENDSWITH ' miles'")
        ).firstMatch
        let before = progress.label
        choose.tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Angels Landing'")).firstMatch.tap()
        let confirm = app.buttons["Start new trail"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Start a new trail?"].exists)
        XCTAssertTrue(
            app.staticTexts[
                "Start Angels Landing? Your walk history is preserved; current trail progress resets."
            ].exists)
        capture(app, "Trail replacement names the trail and explains the reset")
        // An outside dismissal must cancel the pending choice, just like the explicit Cancel action.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.6)).tap()
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 3))
        choose.tap()
        app.navigationBars["Choose a trail"].buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Choose a trail"].waitForNonExistence(timeout: 3))
        XCTAssertFalse(confirm.waitForExistence(timeout: 2))
        XCTAssertEqual(progress.label, before)
        capture(app, "Done after a cancelled choice leaves the expedition unchanged")

        choose.tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Angels Landing'")).firstMatch.tap()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Angels Landing"].waitForExistence(timeout: 5))
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 3))
    }

    @MainActor func testManualWalkValidationStaysWithTheInputAndOutOfHistory() throws {
        let app = try launch()
        open(app, "Walks & expeditions", tab: "Passport")
        let miles = app.textFields["Miles"]
        reveal(app, miles)
        miles.tap()
        miles.typeText("16")
        app.buttons["Add miles"].tap()
        let error = app.staticTexts["Enter more than zero and up to 15 miles per entry."]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.isHittable, "Validation must be visible without another scroll")
        XCTAssertLessThan(error.frame.minY - miles.frame.maxY, 30)
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        capture(app, "Invalid mileage stays beside its field")
        let history = app.buttons["Walk history"]
        reveal(app, history)
        history.tap()
        XCTAssertTrue(app.navigationBars["Walk history"].waitForExistence(timeout: 5))
        XCTAssertFalse(error.exists, "History must not inherit another form's validation")
        capture(app, "Walk history has no unrelated entry error")
    }

    @MainActor func testManualWalkHistoryAndTrailMapUseSharedAccount() throws {
        let app = try launch()
        open(app, "Walks & expeditions", tab: "Passport")
        XCTAssertTrue(app.navigationBars["Expeditions"].waitForExistence(timeout: 5))
        let choose = app.buttons["Choose trail"]
        XCTAssertTrue(choose.waitForExistence(timeout: 5))
        choose.tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Angels Landing'")).firstMatch.tap()
        if app.buttons["Start new trail"].waitForExistence(timeout: 2) {
            app.buttons["Start new trail"].tap()
        }
        XCTAssertTrue(app.staticTexts["Angels Landing"].waitForExistence(timeout: 5))
        capture(app, "Expedition and walk controls")
        let miles = app.textFields["Miles"]
        reveal(app, miles)
        miles.tap()
        miles.typeText("1.25")
        app.buttons["Add miles"].tap()
        XCTAssertTrue(app.staticTexts["expedition-notice"].waitForExistence(timeout: 5))
        app.swipeUp()
        let history = app.buttons["Walk history"]
        reveal(app, history)
        history.tap()
        XCTAssertTrue(app.staticTexts["1.25 miles"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Manual Entry"].exists)
        capture(app, "Walk history")
        app.navigationBars.buttons["Expeditions"].tap()
        let map = app.buttons["Show trail on Map"]
        for _ in 0..<5 where !map.isHittable { app.swipeDown() }
        map.tap()
        XCTAssertTrue(app.tabBars.buttons["Map"].isSelected)
        XCTAssertTrue(app.buttons["Hide expedition trail"].waitForExistence(timeout: 5))
        capture(app, "Trail in existing Map")
    }
    @MainActor func testFeedbackDraftSurvivesRelaunchAndFilesWithFakeProvider() throws {
        let app = try launch()
        open(app, "Help & feedback")
        let message = app.textViews["Report details"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("Synthetic Phase 5 feedback. Local test only.")
        let saved = app.staticTexts["feedback-status"]
        reveal(app, saved)
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        app.navigationBars["Help & feedback"].buttons["Done"].tap()
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 10))
        open(app, "Help & feedback")
        XCTAssertEqual(message.value as? String, "Synthetic Phase 5 feedback. Local test only.")
        let submit = app.buttons["File report"]
        reveal(app, submit)
        submit.tap()
        let filed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS 'Report filed.'"), object: saved)
        XCTAssertEqual(XCTWaiter.wait(for: [filed], timeout: 15), .completed)
        capture(app, "Feedback filed with local test provider")
        app.navigationBars["Help & feedback"].buttons["Done"].tap()
        open(app, "Share & export")
        XCTAssertTrue(app.buttons["Choose photo"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Passport card"].exists)
        capture(app, "Sharing matches existing section cards")
    }
    @MainActor func testExpeditionControlsRemainReachableAtLargestText() throws {
        let app = try launch()
        app.terminate()
        app.launchArguments += [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 10))
        open(app, "Walks & expeditions", tab: "Passport")
        XCTAssertTrue(app.navigationBars["Expeditions"].waitForExistence(timeout: 5))
        capture(app, "Expedition at largest text")
        reveal(app, app.buttons["Start GPS walk"])
        reveal(app, app.buttons["Walk history"])
        app.buttons["Walk history"].tap()
        XCTAssertTrue(app.navigationBars["Walk history"].waitForExistence(timeout: 5))
        capture(app, "Walk history at largest text")
    }
    @MainActor private func launch() throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires the explicit local account emulator workflow.")
        }
        let app = XCUIApplication()
        app.launchEnvironment = [
            "BARK_TEST_SCOPE": UUID().uuidString, "BARK_ACCOUNT_EMULATORS": "1",
            "BARK_EMULATOR_HOST": "127.0.0.1",
            "BARK_CATALOG_URL": "http://127.0.0.1:8787/unchanged/manifest.json",
        ]
        app.launchArguments += ["-AppleInterfaceStyle", "Dark"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("ranger-a@example.test")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("BarkTest123!")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.textFields["New display name"].waitForExistence(timeout: 10))
        let prompt = app.sheets["Save Password?"]
        if prompt.waitForExistence(timeout: 2) { prompt.buttons["Not Now"].tap() }
        app.tabBars.buttons["Home"].tap()
        return app
    }
    @MainActor private func open(_ app: XCUIApplication, _ name: String, tab: String = "Home") {
        app.tabBars.buttons[tab].tap()
        let button = app.buttons[name]
        reveal(app, button)
        button.tap()
    }
    @MainActor private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<6 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
