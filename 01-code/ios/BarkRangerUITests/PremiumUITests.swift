import XCTest

nonisolated final class PremiumUITests: XCTestCase {
    /// This isolated UI check never contacts Apple or Firebase. Real StoreKit is
    /// covered separately; this checks the shared entry point and unavailable state.
    @MainActor func testPremiumEntryUnavailableOfferLegalAndSignInAtBothTextSizes() throws {
        continueAfterFailure = false
        for size in ["UICTContentSizeCategoryL", "UICTContentSizeCategoryAccessibilityXXXL"] {
            let app = XCUIApplication()
            app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
            app.launchArguments = ["-UIPreferredContentSizeCategoryName", size]
            app.launch()
            let trips = app.tabBars.buttons["Trips"]
            XCTAssertTrue(trips.waitForExistence(timeout: 10))
            trips.tap()
            let premium = app.buttons["premium.open"].firstMatch
            XCTAssertTrue(premium.waitForExistence(timeout: 10))
            for _ in 0..<6 where !premium.isHittable { app.swipeUp() }
            premium.tap()
            XCTAssertTrue(app.navigationBars["Premium"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["premium.subscribe"].exists)
            XCTAssertTrue(app.buttons["Done"].isHittable)
            try app.performAccessibilityAudit(for: [
                .contrast, .textClipped, .hitRegion, .sufficientElementDescription,
            ])
            let privacy = app.buttons["Privacy policy"]
            for _ in 0..<8 where !privacy.isHittable { app.swipeUp() }
            XCTAssertTrue(privacy.isHittable)
            privacy.tap()
            XCTAssertTrue(app.navigationBars["Privacy policy"].waitForExistence(timeout: 5))
            app.navigationBars.buttons["Premium"].tap()
            let signIn = app.buttons["Sign in to your Bark account"]
            for _ in 0..<8 where !signIn.isHittable { app.swipeDown() }
            XCTAssertTrue(signIn.isHittable)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "Premium unavailable offer — \(size)"
            shot.lifetime = .keepAlways
            add(shot)
            signIn.tap()
            XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.navigationBars["Premium"].exists)
            app.terminate()
        }
    }
}
