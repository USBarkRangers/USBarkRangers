import Foundation

public enum VisitCSV {
    public static let header = "Park ID,Park,Visited,Type\r\n"
    public static func row(_ visit: NativeVisitDraft, parkName: String? = nil) -> Data {
        Data(
            ([
                visit.officialPlaceID, parkName ?? visit.name,
                ISO8601DateFormatter().string(from: visit.happenedAt), visit.verified ? "verified" : "manual",
            ]
            .map(field).joined(separator: ",") + "\r\n").utf8)
    }
    public static func field(_ text: String) -> String {
        let first = text.trimmingCharacters(in: .whitespacesAndNewlines).first
        let safe = first.map { "=+-@".contains($0) } == true ? "'" + text : text
        return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
