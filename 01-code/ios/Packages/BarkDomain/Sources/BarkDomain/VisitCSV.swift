import Foundation

public enum VisitCSV {
    public static let header = "Park ID,Park,Visited,Type\r\n"
    public static func row(_ visit: NativeVisitDraft, parkName: String? = nil) -> Data {
        Data(([visit.officialPlaceID, parkName ?? visit.name,
            ISO8601DateFormatter().string(from: visit.happenedAt), visit.verified ? "verified" : "manual"]
            .map(field).joined(separator: ",") + "\r\n").utf8)
    }
    public static func field(_ text: String) -> String {
        let first = text.trimmingCharacters(in: .whitespacesAndNewlines).first
        let safe = first.map { "=+-@".contains($0) } == true ? "'" + text : text
        return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
    public static func data(visits: [Visit], parks: [Park]) -> Data {
        let names = Dictionary(
            parks.map { ($0.id.rawValue, $0.name) }, uniquingKeysWith: { first, _ in first })
        let rows = visits.map { visit in
            [
                visit.parkID ?? "",
                names[visit.parkID ?? ""] ?? visit.fields["name"]?.string ?? "Unresolved park",
                visit.visitedAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
                visit.fields["tier"]?.string ?? "manual",
            ].map(field).joined(separator: ",")
        }
        return Data((["Park ID,Park,Visited,Type"] + rows).joined(separator: "\r\n").appending("\r\n").utf8)
    }
}
