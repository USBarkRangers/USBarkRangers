import XCTest

nonisolated final class AccountUITests: XCTestCase {
    @MainActor func testEmulatedSignInProfileSaveAndRelaunch() throws {
        guard ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1" else {
            throw XCTSkip("Requires the explicit local account emulator workflow.")
        }
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_CATALOG_URL"] = "http://127.0.0.1:8787/unchanged/manifest.json"
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap()
        email.typeText("ranger-a@example.test")
        let password = app.secureTextFields["Password"]
        password.tap()
        password.typeText("BarkTest123!")
        app.buttons["Sign in"].tap()
        let field = app.textFields["New display name"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let name = "UI ranger \(String(UUID().uuidString.prefix(6)))"
        field.tap()
        field.typeText(name)
        app.buttons["Save display name"].tap()
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
                .waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
                .waitForExistence(timeout: 10))
        let normalFieldHeight = app.textFields["New display name"].frame.height
        let normalSaveHeight = app.buttons["Save display name"].frame.height
        // The automatic layout audit cannot track reflowed lazy Form rows across sizes on iOS 26.
        // Exercise the actual largest-size layout below; keep semantic, hit-target and contrast audits.
        try auditVisibleContent(app)
        // Audit again after scrolling: rows initially under the system's bottom fade
        // must also be checked when they are fully visible.
        app.swipeUp()
        try auditVisibleContent(app)
        app.swipeDown()
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Phase 3 synthetic account"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
        app.launchArguments += [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        let largeField = app.textFields["New display name"]
        for _ in 0..<10 where !largeField.isHittable { app.swipeUp() }
        XCTAssertTrue(largeField.isHittable)
        XCTAssertGreaterThan(largeField.frame.height, normalFieldHeight + 8)
        let save = app.buttons["Save display name"]
        for _ in 0..<5 where !save.isHittable { app.swipeUp() }
        XCTAssertGreaterThan(save.frame.height, normalSaveHeight + 8)
        XCTAssertTrue(save.isHittable)
        let largeScreenshot = XCTAttachment(screenshot: app.screenshot())
        largeScreenshot.name = "Account at largest text"
        largeScreenshot.lifetime = .keepAlways
        add(largeScreenshot)
        let signOut = app.buttons["Sign out"]
        for _ in 0..<16 where !signOut.isHittable { app.swipeUp() }
        XCTAssertTrue(signOut.isHittable)
        signOut.tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 5))
    }

    @MainActor private func auditVisibleContent(_ app: XCUIApplication) throws {
        try app.performAccessibilityAudit(for: .all.subtracting([.dynamicType, .textClipped])) { issue in
            guard issue.auditType == .contrast, let element = issue.element, element.exists else {
                return false
            }
            // Inactive controls are contrast-exempt. iOS 26 also audits pixels behind its
            // translucent bars; only the unobscured content area is a meaningful contrast sample.
            if !element.isEnabled { return true }
            let top = app.navigationBars.firstMatch.frame.maxY
            let bottom = app.tabBars.firstMatch.frame.minY - 64
            return element.frame.minY < top || element.frame.maxY > bottom
        }
    }
}
