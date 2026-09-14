import XCTest

nonisolated final class ReadOnlyAccessUITests: XCTestCase {
    @MainActor func testGuestTripSurvivesFreeSignInAndReadOnlyScreensRemainBrowsable() throws {
        guard ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires the explicit local account emulator workflow.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        XCTAssertTrue(app.textFields["trip-name"].waitForExistence(timeout: 5))
        app.buttons["route-day-title"].tap()
        app.buttons["Add Day Note"].tap()
        let notes = app.textViews["Day notes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        notes.tap()
        notes.typeText("Guest note retained after sign-in")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Guest note retained after sign-in"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Account"].tap()
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("ranger-b@example.test")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("BarkTest123!")
        app.keyboards.buttons["Done"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.buttons["Recover existing membership"].waitForExistence(timeout: 15))
        let passwordPrompt = app.sheets["Save Password?"]
        if passwordPrompt.waitForExistence(timeout: 3) { passwordPrompt.buttons["Not Now"].tap() }
        XCTAssertFalse(app.textFields["New display name"].exists)
        let tripsTab = app.tabBars.buttons["Trips"]
        // Password-sheet dismissal can finish before UIKit restores tab hit testing.
        let tabReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hittable == true"), object: tripsTab)
        XCTAssertEqual(XCTWaiter.wait(for: [tabReady], timeout: 5), .completed)
        tripsTab.tap()
        XCTAssertTrue(tripsTab.isSelected)
        XCTAssertTrue(app.staticTexts["trip-name"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["trip-name"].exists)
        XCTAssertFalse(app.buttons["route-day-title"].isEnabled)
        XCTAssertTrue(app.staticTexts["Guest note retained after sign-in"].exists)
        app.buttons["Trip options"].tap()
        XCTAssertTrue(app.buttons["Switch trip"].exists)
        for title in ["New trip", "Rename trip", "Duplicate trip", "Delete trip", "Save to account"] {
            XCTAssertFalse(app.buttons[title].exists)
        }
        app.buttons["Switch trip"].tap()
        XCTAssertTrue(app.navigationBars["Switch trip"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["New trip"].exists)
        app.buttons["Done"].tap()
        app.segmentedControls["trip-view-picker"].buttons["Overview"].tap()
        XCTAssertTrue(app.scrollViews["trip-overview"].exists)
        app.tabBars.buttons["Map"].tap()
        let search = app.textFields["park-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Acadia")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Add to Trip"].exists)
        XCTAssertFalse(app.buttons["Record visit"].exists)
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.staticTexts["trip-name"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Free account retains guest trip in read-only Overview"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
