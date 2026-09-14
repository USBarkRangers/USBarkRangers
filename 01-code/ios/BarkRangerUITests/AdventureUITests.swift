import XCTest

// Current guest/visual checks. Retired web-account workflows are covered by the native UI suites.
nonisolated final class AdventureUITests: XCTestCase {
    @MainActor func testGuestTripNotesAndParkStopSurviveRelaunch() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = "http://127.0.0.1:8787/unchanged/manifest.json"
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        let newTrip = app.buttons["New trip"]
        XCTAssertTrue(newTrip.waitForExistence(timeout: 5))
        newTrip.tap()
        XCTAssertTrue(app.textFields["trip-name"].waitForExistence(timeout: 5))
        app.buttons["route-day-title"].tap()
        app.buttons["Add Day Note"].tap()
        let notes = app.textViews["Day notes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        notes.tap()
        notes.typeText("Remember water and a leash")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Remember water and a leash"].waitForExistence(timeout: 5))
        app.buttons["route-day-title"].tap()
        app.buttons["Add Stop"].tap()
        addSearchedStop("Acadia", app: app)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.textFields["trip-name"].waitForExistence(timeout: 5))
        let retainedNote = app.staticTexts["Remember water and a leash"]
        for _ in 0..<6 where !retainedNote.isHittable { app.tables["route-stop-list"].swipeUp() }
        XCTAssertTrue(retainedNote.isHittable)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Phase 4 retained itinerary"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
