import XCTest

/// Real screen workflows run in unique local scopes; never sign in to a production account.
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
    @MainActor private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    @MainActor private func tapTab(_ title: String, in app: XCUIApplication) {
        let button = app.tabBars.buttons[title]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        button.tap()
    }
    @MainActor func testSignedInVisitAppearsInPassportAndTrip() throws {
        guard ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires local account emulators.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launchEnvironment["BARK_CATALOG_URL"] = "http://127.0.0.1:8787/unchanged/manifest.json"
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("ranger-a@example.test")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("BarkTest123!")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.textFields["New display name"].waitForExistence(timeout: 10))
        let passwordPrompt = app.sheets["Save Password?"]
        if passwordPrompt.waitForExistence(timeout: 5) { passwordPrompt.buttons["Not Now"].tap() }
        capture(app, name: "Account before switching tabs")
        tapTab("Map", in: app)
        capture(app, name: "After tapping Map")
        let search = app.textFields["park-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Acadia")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        let addTrip = app.buttons["Add to Trip"]
        for _ in 0..<4 where !addTrip.isHittable { app.buttons["Park Info"].swipeLeft() }
        XCTAssertTrue(addTrip.exists)
        addTrip.tap()
        let visit = app.buttons["Record visit"]
        for _ in 0..<4 where !visit.isHittable { addTrip.swipeLeft() }
        XCTAssertTrue(visit.exists)
        visit.tap()
        app.buttons["Mark visited"].tap()
        tapTab("Passport", in: app)
        XCTAssertTrue(
            app.descendants(matching: .any)["passport-stat-Sites Visited"].waitForExistence(timeout: 8))
        let history = app.buttons["passport-stat-Sites Visited"]
        for _ in 0..<5 where !history.isHittable { app.swipeDown() }
        history.tap()
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Acadia")).firstMatch
                .waitForExistence(timeout: 5))
        app.navigationBars.buttons["Passport"].tap()
        capture(app, name: "Phase 4 passport after recording a visit")
        let leaderboard = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Leaderboard'")).firstMatch
        for _ in 0..<5 where !leaderboard.isHittable { app.swipeUp() }
        leaderboard.tap()
        XCTAssertTrue(app.staticTexts["Your rank"].waitForExistence(timeout: 10))
        capture(app, name: "Phase 4 confirmed leaderboard")
        let back = app.navigationBars.buttons["Passport"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["passport-stat-Sites Visited"].waitForExistence(timeout: 5))
    }
}
