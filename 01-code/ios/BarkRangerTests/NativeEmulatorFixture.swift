import FirebaseCore
import Foundation
import Testing

/// Test-target-only access fixture. There is no grant endpoint or owner token in the application.
@MainActor enum NativeEmulatorFixture {
    static func seedAccess(uid: String, app: FirebaseApp, premium: Bool = true, revision: Int = 2)
        async throws
    {
        guard app.options.projectID == "demo-bark-native", !uid.contains("/") else { throw URLError(.badURL) }
        let url = try #require(
            URL(
                string:
                    "http://127.0.0.1:8188/v1/projects/demo-bark-native/databases/(default)/documents/users/\(uid)/state/entitlement"
            ))
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "fields": [
                "schemaVersion": ["integerValue": "1"], "revision": ["integerValue": String(revision)],
                "premium": ["booleanValue": premium], "source": ["stringValue": "app-store-production"],
                "validUntil": [
                    "timestampValue": ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
                ],
            ]
        ])
        let (_, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
    }
}
