import XCTest

nonisolated final class SettingsUITests: XCTestCase {
    @MainActor
    func testMapPreferencesPersistAcrossRelaunchAndResetTogether() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        app.buttons["Settings"].tap()
        choose("Offline overview", in: "Map appearance", app: app)
        XCTAssertFalse(app.buttons["Distance units, Miles"].isEnabled)
        for label in ["Group nearby pins", "Remember map position"] {
            app.switches[label].coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            XCTAssertEqual(app.switches[label].value as? String, "0")
        }
        app.buttons["Done"].tap()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(
            app.staticTexts["Offline geographic overview · Natural Earth"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["park-count"].label, "393 of 393 parks")
        app.terminate()
        app.launch()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["Map appearance, Offline overview"].exists)
        XCTAssertTrue(app.buttons["Distance units, Miles"].exists)
        XCTAssertEqual(app.switches["Group nearby pins"].value as? String, "0")
        XCTAssertEqual(app.switches["Remember map position"].value as? String, "0")
        let reset = app.buttons["Reset device preferences"]
        for _ in 0..<4 where !reset.isHittable { app.swipeUp() }
        reset.tap()
        for _ in 0..<4 where !app.switches["Group nearby pins"].isHittable { app.swipeDown() }
        XCTAssertTrue(app.buttons["Map appearance, Standard"].exists)
        XCTAssertTrue(app.buttons["Distance units, Miles"].exists)
        XCTAssertEqual(app.switches["Group nearby pins"].value as? String, "1")
        XCTAssertEqual(app.switches["Remember map position"].value as? String, "1")
        app.buttons["Done"].tap()
        app.tabBars.buttons["Map"].tap()
        XCTAssertEqual(app.staticTexts["park-count"].label, "393 of 393 parks")
    }

    @MainActor
    private func choose(_ value: String, in label: String, app: XCUIApplication) {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(label),")).firstMatch.tap()
        app.buttons[value].tap()
    }
}
