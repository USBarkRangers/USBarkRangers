import BarkDomain
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFunctions
import Foundation

nonisolated struct FeedbackReceipt: Codable, Equatable, Sendable {
    let reportID: String
    let filed: Bool
    let delivery: String
    let screenshotCount: Int
}
nonisolated protocol FeedbackSending: Sendable {
    func submit(_ report: FeedbackReport, uid: String?) async throws -> FeedbackReceipt
}

/// Native-only stable report IDs. No entitlement required for support, and no direct database writes from UI.
actor FeedbackService: FeedbackSending {
    private let auth: Auth
    private let functions: Functions
    init(auth: Auth, functions: Functions) {
        self.auth = auth
        self.functions = functions
    }
    func submit(_ report: FeedbackReport, uid: String?) async throws -> FeedbackReceipt {
        try Task.checkCancellation()
        guard auth.currentUser?.uid == uid, report.validationMessage == nil else {
            throw AccountFailure.configuration
        }
        let payload: [String: Any] = [
            "id": report.id, "type": report.category.rawValue,
            "message": report.message, "parkId": report.parkID, "location": report.location,
            "contactEmail": report.contactEmail,
            "screenshots": report.attachments.map {
                ["name": "screenshot-\($0.id).jpg", "dataBase64": $0.data.base64EncodedString()]
            },
        ]
        let response = try await functions.httpsCallable("submitNativeFeedback").call(payload)
        try Task.checkCancellation()
        guard auth.currentUser?.uid == uid else { throw AccountFailure.configuration }
        let data = try JSONSerialization.data(withJSONObject: response.data)
        let receipt = try JSONDecoder().decode(FeedbackReceipt.self, from: data)
        guard receipt.reportID == report.id, receipt.filed else { throw AccountFailure.configuration }
        return receipt
    }
}
