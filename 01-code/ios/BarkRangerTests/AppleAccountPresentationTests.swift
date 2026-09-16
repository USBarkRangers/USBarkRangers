import AuthenticationServices
import SwiftUI
import XCTest

@testable import BarkRanger

nonisolated final class AppleAccountPresentationTests: XCTestCase {
    @MainActor func testLinkedAppleAccountDoesNotOfferAnotherAppleButton() async throws {
        let fixture = try await NativeOfflineAccountFixture.make(
            capabilities: .init(
                profileWrites: true, authenticationChanges: true, accountManagement: true))
        // The account and its data remain synthetic/isolated. Only expose the real
        // provider controls; no button is pressed and no Apple request is made.
        fixture.auth.isTest = false
        let model = AccountModel(session: fixture.session)
        let host = UIHostingController(
            rootView: VStack {
                AccountSecurity(model: model)
                AccountDeletionSection(model: model)
            }.padding())
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 430, height: 1100)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            previous?.makeKeyAndVisible()
        }
        for providers in [["password"], ["apple.com"], ["password", "apple.com"]] {
            fixture.auth.select("a", providers: providers)
            try await eventually { fixture.session.identity?.providers == providers }
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(200))
            host.view.layoutIfNeeded()
            let expected = providers.contains("apple.com") ? 0 : 1
            // The password-only case proves this finds an actual native Apple
            // control. Apple-linked cases must have none before a protected action.
            XCTAssertEqual(appleButtons(in: host.view).count, expected, "Providers: \(providers)")
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "Account security — \(providers.joined(separator: ", "))"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertTrue(fixture.auth.credentialUses.isEmpty)
        XCTAssertTrue(fixture.auth.revokedAppleUIDs.isEmpty)
        try await fixture.close()
    }

    @MainActor private func appleButtons(in view: UIView) -> [ASAuthorizationAppleIDButton] {
        (view as? ASAuthorizationAppleIDButton).map { [$0] }
            ?? view.subviews.flatMap { appleButtons(in: $0) }
    }
}
