import Foundation

/// Built once per accepted catalog revision; local search never sends a query to a server.
public struct ParkSearchIndex: Sendable {
    private struct Entry: Sendable {
        let id: ParkID
        let name: String
        let text: String
        let words: [String]
    }
    private let entries: [Entry]
    private static let abbreviations = [
        "ft": "fort", "mt": "mount", "st": "saint", "natl": "national", "np": "national park",
        "sp": "state park", "nf": "national forest", "nwr": "national wildlife refuge", "mem": "memorial",
        "rec": "recreation", "hist": "historic",
        "nm": "national monument", "nhs": "national historic site", "nra": "national recreation area",
    ]
    public init(parks: [Park]) {
        entries = parks.filter { !$0.isRetired }.map { park in
            let name = Self.normalize(park.name)
            let text = Self.normalize(
                ([park.name, park.state, park.sourceType] + park.stateCodes + park.aliases.map(\.rawValue))
                    .joined(separator: " "))
            return Entry(
                id: park.id, name: name, text: text, words: text.split(separator: " ").map(String.init))
        }
    }
    public static func normalize(_ text: String) -> String {
        let folded = text.folding(
            options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        return folded.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
            .map { abbreviations[$0] ?? $0 }.joined(separator: " ")
    }
    public func search(_ query: String, limit: Int = .max) -> [ParkID] {
        let normalized = Self.normalize(String(query.prefix(200)))
        guard !normalized.isEmpty else { return Array(entries.prefix(max(0, limit))).map(\.id) }
        let tokens = normalized.split(separator: " ").map(String.init)
        return entries.compactMap { entry -> (Entry, Int)? in
            if entry.name == normalized { return (entry, 0) }
            if entry.name.hasPrefix(normalized) { return (entry, 1) }
            if tokens.allSatisfy({ entry.text.contains($0) }) { return (entry, 2) }
            guard
                tokens.allSatisfy({ token in
                    entry.words.contains { word in
                        word.hasPrefix(token)
                            || (token.count >= 4 && token.allSatisfy(\.isLetter)
                                && Self.withinOneEdit(token, word))
                    }
                })
            else { return nil }
            return (entry, 3)
        }.sorted { lhs, rhs in
            if lhs.1 != rhs.1 { return lhs.1 < rhs.1 }
            return lhs.0.name == rhs.0.name ? lhs.0.id.rawValue < rhs.0.id.rawValue : lhs.0.name < rhs.0.name
        }.prefix(max(0, limit)).map { $0.0.id }
    }
    /// Bounded linear comparison: enough typo tolerance without an unbounded distance matrix.
    private static func withinOneEdit(_ lhs: String, _ rhs: String) -> Bool {
        let a = Array(lhs)
        let b = Array(rhs)
        guard abs(a.count - b.count) <= 1 else { return false }
        var i = 0
        var j = 0
        var edits = 0
        while i < a.count && j < b.count {
            if a[i] == b[j] {
                i += 1
                j += 1
                continue
            }
            edits += 1
            if edits > 1 { return false }
            if a.count <= b.count { j += 1 }
            if a.count >= b.count { i += 1 }
        }
        return edits + (a.count - i) + (b.count - j) <= 1
    }
}
