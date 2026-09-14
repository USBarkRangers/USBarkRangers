import XCTest

/// Exercises the real summary and navigation with synthetic accounts, never production credentials.
nonisolated final class PassportUITests: XCTestCase {
    @MainActor func testWatermarkHasItsOwnCardImmediatelyBelowLeaderboard() throws {
        let app = try launchPassport()
        let leaderboard = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Leaderboard'")).firstMatch
        let watermark = app.buttons["passport-watermark"]
        for _ in 0..<5 where !watermark.isHittable { app.swipeUp() }
        XCTAssertTrue(leaderboard.isHittable && watermark.isHittable)
        XCTAssertEqual(watermark.frame.minY - leaderboard.frame.maxY, 16, accuracy: 2)
        XCTAssertEqual(watermark.frame.width, leaderboard.frame.width, accuracy: 1)
        capture(app, "Separate watermark card directly below Leaderboard")
        watermark.tap()
        XCTAssertTrue(app.navigationBars["Photo watermark"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Choose photo"].exists)
        app.navigationBars.buttons["Passport"].tap()
        XCTAssertTrue(watermark.exists)
    }

    @MainActor func testLocalWatermarkDefaultsAndSnapsToFourCorners() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchArguments += ["-AppleInterfaceStyle", "Dark"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Passport"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Passport"].tap()
        let watermark = app.buttons["passport-watermark"]
        for _ in 0..<4 where !watermark.isHittable { app.swipeUp() }
        watermark.tap()
        XCTAssertTrue(app.navigationBars["Photo watermark"].waitForExistence(timeout: 5))
        app.buttons["Choose photo"].tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 5), "Seed a synthetic photo with simctl addmedia first")
        // Photos exposes grid images without an accessibility hit point on iOS 26.
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let logo = app.images["watermark-logo"]
        XCTAssertTrue(logo.waitForExistence(timeout: 10))
        XCTAssertEqual(logo.value as? String, "Bottom right")
        let preview = app.descendants(matching: .any)["watermark-preview"]
        let frame = preview.frame
        for (point, corner) in [
            (CGVector(dx: 0.2, dy: 0.2), "Top left"),
            (CGVector(dx: 0.8, dy: 0.2), "Top right"),
            (CGVector(dx: 0.2, dy: 0.8), "Bottom left"),
            (CGVector(dx: 0.8, dy: 0.8), "Bottom right"),
        ] {
            let target = app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: frame.minX + frame.width * point.dx, dy: frame.minY + frame.height * point.dy))
            logo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.15, thenDragTo: target)
            let landed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", corner), object: logo)
            XCTAssertEqual(XCTWaiter.wait(for: [landed], timeout: 3), .completed)
            let bounds = logo.frame
            XCTAssertEqual(
                corner.contains("left") ? bounds.minX - frame.minX : frame.maxX - bounds.maxX,
                frame.width * 0.02, accuracy: 2)
            XCTAssertEqual(
                corner.contains("Top") ? bounds.minY - frame.minY : frame.maxY - bounds.maxY,
                frame.width * 0.02, accuracy: 2)
            capture(app, "Watermark snapped to \(corner)")
        }
        app.sliders["watermark-size"].adjust(toNormalizedSliderPosition: 0.9)
        XCTAssertEqual(logo.value as? String, "Bottom right")
        XCTAssertEqual(frame.maxX - logo.frame.maxX, frame.width * 0.02, accuracy: 2)
        XCTAssertEqual(frame.maxY - logo.frame.maxY, frame.width * 0.02, accuracy: 2)
        app.buttons["Share photo"].tap()
        XCTAssertTrue(app.otherElements["ShareSheet.RemoteContainerView"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.cells.matching(NSPredicate(format: "label == 'Save to Files'")).firstMatch.exists)
        XCTAssertTrue(app.otherElements["LP.CaptionBar.BottomCaption"].label.contains("JPEG Image"))
        capture(app, "Corner watermark ready in native share sheet")
    }

    @MainActor func testPublishedTopFiveAndPersonalRowUseRealRankWithoutPaging() throws {
        let app = try launchPassport(email: "ranger-b@example.test")
        let leaderboard = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Leaderboard'")).firstMatch
        for _ in 0..<5 where !leaderboard.isHittable { app.swipeUp() }
        leaderboard.tap()
        XCTAssertTrue(app.navigationBars["Leaderboard"].waitForExistence(timeout: 5))
        let own = app.descendants(matching: .any)["leaderboard-row-native-test-b"]
        XCTAssertTrue(own.waitForExistence(timeout: 10))
        XCTAssertTrue(own.label.contains("Rank 7") && own.label.contains("50 points"))
        let rows = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "leaderboard-row-"))
        XCTAssertEqual(rows.count, 6)
        XCTAssertTrue(app.staticTexts["Leading the pack"].exists)
        XCTAssertFalse(app.buttons["Load more"].exists)
        XCTAssertFalse(app.staticTexts["No standings yet"].exists)
        capture(app, "Five published leaders and your actual rank")
        app.navigationBars.buttons["Passport"].tap()
        leaderboard.tap()
        XCTAssertTrue(own.waitForExistence(timeout: 5))
        XCTAssertEqual(rows.count, 6)
        app.buttons["Refresh"].tap()
        XCTAssertTrue(own.waitForExistence(timeout: 10))
    }

    @MainActor func testHeaderAchievementShelvesAndHistoryNavigation() throws {
        let app = try launchPassport()
        let points = app.descendants(matching: .any)["passport-stat-Total Points"]
        let loaded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == '50'"), object: points)
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 10), .completed)
        XCTAssertEqual(app.staticTexts["passport-name"].label, "Ranger PASSPORT")
        for (label, expected) in [("Sites Visited", "2"), ("States", "0"), ("Verified", "1")] {
            XCTAssertEqual(
                app.descendants(matching: .any)["passport-stat-\(label)"].value as? String, expected)
        }
        XCTAssertTrue(app.staticTexts["Level 4"].exists)
        XCTAssertTrue(app.staticTexts["B.A.R.K. Master"].exists)
        assertAlignedCards(app)
        capture(app, "Passport welcome and stats")
        XCTAssertFalse(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Visit history'")).firstMatch.exists)
        app.buttons["passport-stat-States"].tap()
        XCTAssertTrue(app.navigationBars["State progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Alabama"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Passport"].tap()

        let categories = app.segmentedControls["achievement-categories"]
        if !categories.isHittable { app.swipeUp() }
        XCTAssertTrue(categories.buttons["Rare Feats"].isSelected)
        categories.buttons["Paws"].tap()
        let paws = app.scrollViews["achievement-shelf-paws"]
        XCTAssertTrue(paws.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["achievement-bronzePaw"].exists)
        paws.swipeLeft()
        XCTAssertTrue(app.descendants(matching: .any)["achievement-silverPaw"].exists)
        categories.buttons["States"].tap()
        XCTAssertTrue(app.scrollViews["achievement-shelf-states"].waitForExistence(timeout: 5))
        capture(app, "Passport state achievements")
        categories.buttons["Rare Feats"].tap()

        let history = app.buttons["passport-stat-Sites Visited"]
        for _ in 0..<5 where !history.isHittable { app.swipeDown() }
        history.tap()
        XCTAssertTrue(app.staticTexts["Retired test park"].waitForExistence(timeout: 5))
        // The unresolved legacy visit intentionally cannot be edited; use the retained identified visit.
        app.buttons.matching(NSPredicate(format: "label == 'Edit date' AND enabled == true")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Visit date"].waitForExistence(timeout: 5))
        app.navigationBars["Visit date"].buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Visit date"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Retired test park"].exists)
        app.navigationBars["Visit history"].buttons["Edit"].tap()
        app.staticTexts["Retired test park"].tap()
        app.buttons["Remove selected (1)"].tap()
        app.buttons["Remove visits"].tap()
        XCTAssertTrue(app.staticTexts["Retired test park"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Unresolved historical visit"].exists)
        app.navigationBars.buttons["Passport"].tap()
        let leaderboard = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Leaderboard'")).firstMatch
        for _ in 0..<5 where !leaderboard.isHittable { app.swipeUp() }
        leaderboard.tap()
        XCTAssertTrue(app.navigationBars["Leaderboard"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Passport"].tap()
        XCTAssertTrue(app.segmentedControls["achievement-categories"].exists)
    }

    @MainActor func testLargeTextPassportRemainsScrollable() throws {
        let app = try launchPassport(largeText: true)
        XCTAssertTrue(app.staticTexts["Welcome!"].waitForExistence(timeout: 10))
        assertAlignedCards(app)
        capture(app, "Passport at largest text size")
        let categories = app.segmentedControls["achievement-categories"]
        for _ in 0..<8 where !categories.isHittable { app.swipeUp() }
        XCTAssertTrue(categories.isHittable)
        categories.buttons["States"].tap()
        XCTAssertTrue(app.scrollViews["achievement-shelf-states"].waitForExistence(timeout: 5))
        capture(app, "Passport achievements at largest text size")
    }

    @MainActor private func launchPassport(
        largeText: Bool = false, email: String = "ranger-passport@example.test"
    ) throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires the explicit local account emulator workflow.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launchEnvironment["BARK_CATALOG_URL"] = "http://127.0.0.1:8787/unchanged/manifest.json"
        app.launchArguments += ["-AppleInterfaceStyle", "Dark"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText(email)
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("BarkTest123!")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.staticTexts["Saved name"].waitForExistence(timeout: 10))
        let passwordPrompt = app.sheets["Save Password?"]
        if passwordPrompt.waitForExistence(timeout: 3) { passwordPrompt.buttons["Not Now"].tap() }
        if largeText {
            // Reopen the retained test account at larger text; this test targets Passport, not the sign-in form.
            app.terminate()
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            ]
            app.launch()
            XCTAssertTrue(app.tabBars.buttons["Passport"].waitForExistence(timeout: 10))
        }
        let tab = app.tabBars.buttons["Passport"]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"), object: tab)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        tab.tap()
        XCTAssertTrue(app.staticTexts["Welcome!"].waitForExistence(timeout: 5))
        return app
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func assertAlignedCards(_ app: XCUIApplication) {
        for (left, right) in [("Sites Visited", "States"), ("Total Points", "Verified")] {
            let first = app.descendants(matching: .any)["passport-stat-\(left)"].frame
            let second = app.descendants(matching: .any)["passport-stat-\(right)"].frame
            XCTAssertEqual(first.minY, second.minY, accuracy: 1)
            XCTAssertEqual(first.maxY, second.maxY, accuracy: 1)
        }
    }
}
