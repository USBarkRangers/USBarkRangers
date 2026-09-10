import XCTest

nonisolated final class DiscoveryUITests: XCTestCase {
    @MainActor
    private func launch(largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        if largeText {
            app.launchArguments = [
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            ]
        }
        app.launch()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.textFields["park-search"].waitForExistence(timeout: 5))
        return app
    }

    @MainActor
    private func expectPins(_ count: Int, in app: XCUIApplication) {
        let map = app.descendants(matching: .any).matching(identifier: "park-map").firstMatch
        let matching = NSPredicate(format: "value == %@", "\(count) matching parks")
        expectation(for: matching, evaluatedWith: map)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(app.staticTexts["park-count"].label, "\(count) of 393 parks")
    }

    @MainActor
    private func capture(_ name: String, app: XCUIApplication) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    func testInlineSearchKeepsKeyboardAndMapResultsInSync() {
        let app = launch()
        let search = app.textFields["park-search"]
        XCTAssertFalse(app.navigationBars["Map"].exists)
        XCTAssertFalse(app.segmentedControls.firstMatch.exists)
        let count = app.staticTexts["park-count"]
        XCTAssertTrue(count.exists)
        XCTAssertGreaterThanOrEqual(count.frame.minX, search.frame.maxX)
        XCTAssertLessThanOrEqual(count.frame.maxX, app.buttons["Filters"].frame.minX)
        expectPins(393, in: app)
        capture("Map fills discovery", app: app)
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        search.typeText("hulls")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-")).firstMatch
                .waitForExistence(timeout: 3))
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        search.typeText(" cove")
        expectPins(1, in: app)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.label.contains("Acadia"))
        XCTAssertGreaterThan(result.frame.minY, search.frame.maxY)
        capture("Live search, keyboard and matching pin", app: app)
        search.typeText("zzzzzz")
        expectPins(0, in: app)
        XCTAssertTrue(app.staticTexts["No matching parks"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        app.buttons["Clear search"].tap()
        expectPins(393, in: app)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        search.typeText("hulls cove")
        result.tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        app.buttons["Close park details"].tap()
        expectPins(1, in: app)
    }

    @MainActor
    func testFiltersRemoveIndividuallyAndPersistWithOfflineDiscovery() {
        let app = launch()
        app.buttons["Filters"].tap()
        for value in ["National", "Tag"] {
            app.switches[value].coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            XCTAssertEqual(app.switches[value].value as? String, "1")
        }
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Remove National category filter"].exists)
        XCTAssertTrue(app.buttons["Remove Tag swag filter"].exists)
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("hulls cove")
        expectPins(1, in: app)
        app.buttons["Remove National category filter"].tap()
        XCTAssertFalse(app.buttons["Remove National category filter"].exists)
        XCTAssertTrue(app.buttons["Remove Tag swag filter"].exists)
        XCTAssertEqual(search.value as? String, "hulls cove")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        capture("Removable filter chips", app: app)
        app.terminate()
        app.launch()
        app.tabBars.buttons["Map"].tap()
        expectPins(1, in: app)
        XCTAssertTrue(app.buttons["Remove Tag swag filter"].exists)
        app.buttons["Remove search filter"].tap()
        app.buttons["Remove Tag swag filter"].tap()
        expectPins(393, in: app)
        app.tabBars.buttons["Home"].tap()
        app.buttons["Settings"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Map appearance,")).firstMatch.tap()
        app.buttons["Offline overview"].tap()
        app.buttons["Done"].tap()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(
            app.staticTexts["Offline geographic overview · Natural Earth"].waitForExistence(timeout: 3))
        capture("Map-first offline overview", app: app)
    }

    @MainActor
    func testFiltersAndSearchRemainUsableAtLargestTextSize() {
        let app = launch(largeText: true)
        app.buttons["Filters"].tap()
        XCTAssertTrue(app.switches["National"].waitForExistence(timeout: 3))
        app.buttons["Done"].tap()
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("hulls cove")
        XCTAssertEqual(search.value as? String, "hulls cove")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        expectPins(1, in: app)
        capture("Search at largest text size", app: app)
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 3))
        result.tap()
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].waitForExistence(timeout: 3))
        capture("Park sheet at largest text size", app: app)
        XCTAssertTrue(app.buttons["Close park details"].isHittable)
        app.buttons["Close park details"].tap()
    }

    @MainActor
    func testLocationDenialAndAppleMapsReturnKeepDiscoveryUsable() {
        let app = launch()
        app.resetAuthorizationStatus(for: .location)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        let interruption = addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            for title in ["Don’t Allow", "Don't Allow"] where alert.buttons[title].exists {
                alert.buttons[title].tap()
                return true
            }
            return false
        }
        defer { removeUIInterruptionMonitor(interruption) }
        app.buttons["Locate me"].tap()
        app.tap()
        XCTAssertTrue(app.alerts["Location unavailable"].waitForExistence(timeout: 5))
        app.alerts["Location unavailable"].buttons["OK"].tap()
        app.textFields["park-search"].tap()
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-")).firstMatch.tap()
        app.buttons["Directions in Apple Maps"].tap()
        XCTAssertTrue(
            XCUIApplication(bundleIdentifier: "com.apple.Maps").wait(for: .runningForeground, timeout: 10))
        app.activate()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForExistence(timeout: 5))
        app.buttons["Close park details"].tap()
        XCTAssertTrue(app.textFields["park-search"].exists)
    }
}
