import BarkDomain
import CryptoKit
import Foundation

/// Whole-snapshot acceptance. No consumer can accidentally publish partially decoded rows.
nonisolated struct CatalogValidator: Sendable {
    static let maximumBytes = 12 * 1024 * 1024
    var minimumParks = 300
    enum Rejection: Error { case metadata, hash, identity, fields, links, removedIdentity, revision }

    func validateManifest(_ manifest: CatalogManifest) throws {
        guard manifest.schemaVersion == 1, manifest.revision > 0, manifest.count >= minimumParks,
            (1...Self.maximumBytes).contains(manifest.bytes), isHash(manifest.sha256),
            isHash(manifest.sourceRevision),
            manifest.path == "revisions/\(manifest.revision)-\(manifest.sha256).json",
            ISO8601DateFormatter().date(
                from: manifest.publishedAt.replacingOccurrences(of: ".000Z", with: "Z")) != nil
                || fractionalDate(manifest.publishedAt) != nil
        else { throw Rejection.metadata }
    }

    func decodeAndValidate(bytes: Data, manifest: CatalogManifest, baseline: CatalogSnapshot? = nil) throws
        -> CatalogSnapshot
    {
        try validateManifest(manifest)
        guard bytes.count == manifest.bytes, Self.hash(bytes) == manifest.sha256 else { throw Rejection.hash }
        let snapshot = try JSONDecoder().decode(CatalogSnapshot.self, from: bytes)
        guard snapshot.schemaVersion == manifest.schemaVersion, snapshot.revision == manifest.revision,
            snapshot.sourceRevision == manifest.sourceRevision, snapshot.publishedAt == manifest.publishedAt,
            snapshot.parks.count == manifest.count
        else { throw Rejection.metadata }
        var ids = Set<ParkID>()
        var aliases = Set<ParkID>()
        var sites: [String: SiteID] = [:]
        for park in snapshot.parks {
            guard validID(park.id.rawValue), ids.insert(park.id).inserted,
                !park.siteID.rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { throw Rejection.identity }
            guard !park.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                !park.stateCodes.isEmpty,
                park.stateCodes.allSatisfy({ Self.stateCodes.contains($0) })
            else { throw Rejection.fields }
            let fields = [
                park.name, park.state, park.sourceType, park.swagCost, park.info, park.entranceFees,
                park.swagLocation, park.approvedTrails, park.restrictions, park.hazards, park.extraSwag,
            ]
            guard fields.allSatisfy({ $0.utf16.count <= 100_000 }) else { throw Rejection.fields }
            guard (park.websites + park.pictures + park.videos).allSatisfy(Self.safeLink) else {
                throw Rejection.links
            }
            for alias in park.aliases {
                guard !alias.rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    aliases.insert(alias).inserted
                else { throw Rejection.identity }
            }
            let name = park.name.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
            let physical = String(
                format: "%@|%.5f,%.5f", locale: Locale(identifier: "en_US_POSIX"), name,
                park.coordinate.latitude, park.coordinate.longitude)
            guard sites[physical] == nil || sites[physical] == park.siteID else { throw Rejection.identity }
            sites[physical] = park.siteID
        }
        let retired = Set(snapshot.retiredParkIDs)
        guard ids.isDisjoint(with: aliases), retired.count == snapshot.retiredParkIDs.count,
            retired.allSatisfy({ !$0.rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
            retired.isDisjoint(with: ids), retired.isDisjoint(with: aliases)
        else { throw Rejection.identity }
        if let baseline {
            guard snapshot.revision > baseline.revision else { throw Rejection.revision }
            for park in baseline.parks {
                guard ids.contains(park.id) || aliases.contains(park.id) || retired.contains(park.id) else {
                    throw Rejection.removedIdentity
                }
                guard park.aliases.allSatisfy({ aliases.contains($0) || retired.contains($0) }) else {
                    throw Rejection.removedIdentity
                }
            }
            guard Set(baseline.retiredParkIDs).isSubset(of: retired) else { throw Rejection.removedIdentity }
        }
        return snapshot
    }
    static func hash(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
    static func safeLink(_ url: URL) -> Bool {
        ["https", "http"].contains(url.scheme?.lowercased() ?? "") && url.host?.isEmpty == false
            && url.user == nil && url.password == nil
    }
    private func validID(_ id: String) -> Bool {
        !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && id.lowercased() != "unknown"
            && id.range(of: #"^-?\d+\.\d{2}_-?\d+\.\d{2}$"#, options: .regularExpression) == nil
    }
    private func isHash(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy { "0123456789abcdef".contains($0) }
    }
    private func fractionalDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
    private static let stateCodes = Set(
        "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC GU PR AS MP VI"
            .split(separator: " ").map(String.init))
}
