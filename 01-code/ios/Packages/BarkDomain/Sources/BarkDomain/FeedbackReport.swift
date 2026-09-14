import Foundation

public struct FeedbackReport: Codable, Equatable, Sendable, Identifiable {
    public enum Category: String, CaseIterable, Codable, Sendable { case bug, correction, idea, support }
    public struct Attachment: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let data: Data
        public init(data: Data) {
            id = UUID().uuidString.lowercased()
            self.data = data
        }
    }
    public let id: String
    public var category: Category = .bug
    public var message = ""
    public var parkID = ""
    public var location = ""
    public var contactEmail = ""
    public var attachments: [Attachment] = []
    public var attempted = false
    public init(id: String = UUID().uuidString.lowercased()) { self.id = id }
    public var validationMessage: String? {
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Describe what happened or what should change."
        }
        if message.utf16.count > 2_000 { return "Keep your report within 2,000 characters." }
        if parkID.utf16.count > 128 || location.utf16.count > 300 || contactEmail.utf16.count > 254 {
            return "Shorten the park, location or contact information."
        }
        if attachments.count > 3
            || attachments.contains(where: { $0.data.isEmpty || $0.data.count > 1_500_000 })
            || attachments.reduce(0, { $0 + $1.data.count }) > 4_000_000
        {
            return "Attach up to 3 images, 1.5 MB each and 4 MB in total."
        }
        return nil
    }
    public var mailBody: String {
        "Report: \(id)\nCategory: \(category.rawValue)\nPark: \(parkID)\nLocation: \(location)\n\n\(message)"
    }
}
