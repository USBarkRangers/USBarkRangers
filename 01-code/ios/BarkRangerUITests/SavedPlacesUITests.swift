import XCTest

nonisolated final class SavedPlacesUITests: XCTestCase {
    @MainActor func testSaveStarRelaunchFilterAndRemoveWithoutCreatingATrip() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        openMap(app)
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("41.24, -81.75")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'place-result-'"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertEqual(app.otherElements["park-sheet-handle"].value as? String, "Low")
        XCTAssertTrue(app.buttons["save-place"].waitForExistence(timeout: 5))
        app.buttons["save-place"].tap()
        XCTAssertTrue(app.buttons["saved-place-menu"].waitForExistence(timeout: 5))
        capture(app, "Saved place — star action in the existing low popup")
        app.buttons["Close place details"].tap()
        let pin = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH 'place-pin-' AND value CONTAINS 'Saved place'")
        ).firstMatch
        XCTAssertTrue(pin.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["map-displayed-trip"].exists)
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.buttons["New trip"].waitForExistence(timeout: 5))
        openMap(app)
        app.buttons["Filters"].tap()
        app.switches["show-saved-pins"].coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertEqual(app.switches["show-saved-pins"].value as? String, "0")
        app.buttons["Done"].tap()
        XCTAssertTrue(pin.waitForNonExistence(timeout: 5))
        app.terminate()
        app.launch()
        openMap(app)
        XCTAssertFalse(pin.exists)
        app.buttons["Filters"].tap()
        XCTAssertEqual(app.switches["show-saved-pins"].value as? String, "0")
        app.switches["show-saved-pins"].coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        app.buttons["Done"].tap()
        XCTAssertTrue(
            pin.waitForExistence(timeout: 5), "Device bookmark survives force-close and hidden state")
        capture(app, "Saved star restored after relaunch")
        pin.tap()
        XCTAssertTrue(app.buttons["saved-place-menu"].waitForExistence(timeout: 5))
        app.buttons["saved-place-menu"].tap()
        app.buttons["Remove"].tap()
        XCTAssertTrue(app.buttons["Close place details"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(pin.waitForNonExistence(timeout: 5))
        app.terminate()
        app.launch()
        openMap(app)
        XCTAssertFalse(pin.exists)
        // Catalog parks retain their existing actions; bookmarking is limited to searched places.
        if app.buttons["Clear search"].exists { app.buttons["Clear search"].tap() }
        search.tap()
        search.typeText("acadia")
        let park = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'park-result-'"))
            .firstMatch
        XCTAssertTrue(park.waitForExistence(timeout: 5))
        park.tap()
        XCTAssertFalse(app.buttons["save-place"].exists)
        XCTAssertFalse(app.buttons["saved-place-menu"].exists)
    }

    @MainActor private func openMap(_ app: XCUIApplication) {
        XCTAssertTrue(app.tabBars.buttons["Map"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.textFields["park-search"].waitForExistence(timeout: 5))
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
