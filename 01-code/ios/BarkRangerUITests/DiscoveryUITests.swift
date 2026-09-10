import XCTest

nonisolated final class DiscoveryUITests: XCTestCase {
    @MainActor
    func testOfflineDiscoverySearchFiltersDetailsAndPreferences() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
        app.buttons["Settings"].tap()
        app.swipeUp()
        app.swipeUp()
        app.buttons["Reset device preferences"].tap()
        app.buttons["Done"].tap()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.staticTexts["393 of 393 parks"].waitForExistence(timeout: 5))
        let map = XCTAttachment(screenshot: app.screenshot())
        map.name = "393-park native map"
        map.lifetime = .keepAlways
        add(map)
        app.buttons["Filters"].tap()
        app.switches["National"].coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        app.switches["Tag"].coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertEqual(app.switches["National"].value as? String, "1")
        XCTAssertEqual(app.switches["Tag"].value as? String, "1")
        app.buttons["Done"].tap()
        app.buttons["Search parks"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap()
        search.typeText("hulls cove")
        let acadia = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Acadia National Park"))
            .firstMatch
        XCTAssertTrue(acadia.waitForExistence(timeout: 3))
        acadia.tap()
        XCTAssertTrue(app.navigationBars["Park details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].exists)
        let detail = XCTAttachment(screenshot: app.screenshot())
        detail.name = "Offline park details"
        detail.lifetime = .keepAlways
        add(detail)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["1 of 393 parks"].exists)
        app.terminate()
        app.launch()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.staticTexts["1 of 393 parks"].waitForExistence(timeout: 5))
        app.buttons["Clear"].tap()
        app.buttons["Search parks"].tap()
        search.tap()
        search.typeText("zzzzzzzzzzzz")
        XCTAssertTrue(app.staticTexts["0 of 393 parks"].waitForExistence(timeout: 3))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["No matching parks"].exists)
        app.buttons["Clear filters"].tap()
        XCTAssertTrue(app.staticTexts["393 of 393 parks"].exists)
        app.tabBars.buttons["Home"].tap()
        app.buttons["Settings"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Map appearance,")).firstMatch.tap()
        app.buttons["Offline overview"].tap()
        app.buttons["Done"].tap()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(
            app.staticTexts["Offline geographic overview · Natural Earth"].waitForExistence(timeout: 3))
        let overview = XCTAttachment(screenshot: app.screenshot())
        overview.name = "Bundled offline overview"
        overview.lifetime = .keepAlways
        add(overview)
    }

    @MainActor
    func testFiltersAndDetailsRemainUsableAtLargestTextSize() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launchArguments = [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        app.tabBars.buttons["Map"].tap()
        app.buttons["Filters"].tap()
        XCTAssertTrue(app.switches["National"].waitForExistence(timeout: 3))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Filters at largest text size"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["Done"].tap()
        app.segmentedControls.buttons["Results list"].tap()
        XCTAssertTrue(app.cells.firstMatch.waitForExistence(timeout: 3))
        app.cells.firstMatch.tap()
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Done"].isHittable)
        app.buttons["Done"].tap()
    }
    @MainActor
    func testLocationDenialAndAppleMapsReturnKeepDiscoveryUsable() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.resetAuthorizationStatus(for: .location)
        app.launch()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.tabBars.buttons["Map"].tap()
        let interruption = addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            if alert.buttons["Don’t Allow"].exists {
                alert.buttons["Don’t Allow"].tap()
                return true
            }
            if alert.buttons["Don't Allow"].exists {
                alert.buttons["Don't Allow"].tap()
                return true
            }
            return false
        }
        defer { removeUIInterruptionMonitor(interruption) }
        app.buttons["Locate me"].tap()
        app.tap()
        XCTAssertTrue(app.alerts["Location unavailable"].waitForExistence(timeout: 5))
        app.alerts["Location unavailable"].buttons["OK"].tap()
        app.segmentedControls.buttons["Results list"].tap()
        app.cells.firstMatch.tap()
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].waitForExistence(timeout: 5))
        app.buttons["Directions in Apple Maps"].tap()
        let maps = XCUIApplication(bundleIdentifier: "com.apple.Maps")
        XCTAssertTrue(maps.wait(for: .runningForeground, timeout: 10))
        app.activate()
        XCTAssertTrue(app.navigationBars["Park details"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Map"].exists)
    }

}
