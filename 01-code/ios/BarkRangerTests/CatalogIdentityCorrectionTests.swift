import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

/// Mammoth Cave and Pocahontas once shipped under a relative date pasted into the sheet's Park id
/// cell ("1d ago", "2 days ago"). Those values break the identifier rule every visit command
/// applies, so marking either park visited threw. The sheet now holds real UUIDs. The old values
/// are migration inputs only: aliases of the corrected parks, never a current park or site ID.
@MainActor struct CatalogIdentityCorrectionTests {
    private let mammoth = "0b04a828-a089-49e3-8e97-8613574bfa08"
    private let pocahontas = "417a203f-fd35-4e57-8417-f3a5a705a8eb"
    private var mistaken: [String: String] { [mammoth: "1d ago", pocahontas: "2 days ago"] }

    private func bundled() throws -> [String: Any] {
        let url = try #require(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        return try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    /// Exact bytes plus the manifest a server would publish for them.
    private func published(_ catalog: [String: Any]) throws -> (bytes: Data, manifest: CatalogManifest) {
        let bytes = try JSONSerialization.data(withJSONObject: catalog, options: [.sortedKeys])
        let hash = CatalogValidator.hash(bytes)
        let revision = try #require(
            catalog["revision"] as? Int64 ?? (catalog["revision"] as? NSNumber)?.int64Value)
        let manifest: [String: Any] = [
            "schemaVersion": 1, "revision": revision, "publishedAt": catalog["publishedAt"] as Any,
            "sourceRevision": catalog["sourceRevision"] as Any,
            "count": (catalog["parks"] as? [Any])?.count as Any,
            "bytes": bytes.count, "sha256": hash, "path": "revisions/\(revision)-\(hash).json",
        ]
        return (
            bytes,
            try JSONDecoder().decode(
                CatalogManifest.self, from: JSONSerialization.data(withJSONObject: manifest))
        )
    }
    /// What old phones and the stuck publisher hold: the same parks under the mistaken identities.
    private func withMistakes(_ catalog: [String: Any], revision: Int64) throws -> [String: Any] {
        var old = catalog
        old["revision"] = revision
        old["parks"] = try #require(catalog["parks"] as? [[String: Any]]).map { park -> [String: Any] in
            guard let id = park["id"] as? String, let bad = mistaken[id] else { return park }
            var value = park
            value["id"] = bad
            value["siteID"] = bad
            value["aliases"] = [String]()
            return value
        }
        return old
    }
    private func revision(_ catalog: [String: Any]) throws -> Int64 {
        try #require((catalog["revision"] as? NSNumber)?.int64Value)
    }

    @Test func theBundleHoldsBothParksOnceUnderTheirCorrectedIDs() throws {
        let catalog = try bundled()
        let snapshot = try CatalogValidator().decodeAndValidate(
            bytes: published(catalog).bytes, manifest: published(catalog).manifest)
        for (id, old, name) in [
            (mammoth, "1d ago", "Mammoth Cave National Park"),
            (pocahontas, "2 days ago", "Pocahontas State Park"),
        ] {
            let matches = snapshot.parks.filter { $0.name == name }
            #expect(matches.count == 1)
            #expect(matches.first?.id.rawValue == id && matches.first?.siteID.rawValue == id)
            #expect(matches.first?.aliases.map(\.rawValue) == [old])
            #expect(!snapshot.parks.contains { $0.id.rawValue == old || $0.siteID.rawValue == old })
        }
    }

    @Test func anOldOfflineCatalogGivesWayToTheCorrectedOneAtLaunch() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let catalog = try bundled()
        // Even a cached copy NEWER than the bundle is refused once it carries a mistaken identity.
        for cachedRevision in [try revision(catalog) - 1_000_000, try revision(catalog) + 5] {
            let old = try published(withMistakes(catalog, revision: cachedRevision))
            let disk = CatalogDiskStore(
                directory: directory.appendingPathComponent("\(cachedRevision)"),
                bundleDirectory: try #require(Bundle.main.resourceURL))
            try disk.commit(.init(manifest: old.manifest, payload: old.bytes), previous: nil)
            let state = await CatalogRepository(disk: disk, client: nil).loadLocal()
            let snapshot = try #require(state.snapshot)
            #expect(snapshot.revision == (try revision(catalog)) && state.source == .bundle)
            #expect(
                snapshot.parks.filter { $0.name == "Mammoth Cave National Park" }.map(\.id.rawValue) == [
                    mammoth
                ])
            #expect(
                snapshot.parks.filter { $0.name == "Pocahontas State Park" }.map(\.id.rawValue) == [
                    pocahontas
                ])
        }
    }

    @Test func aPhoneStillHoldingTheMistakenCatalogAcceptsTheCorrectionBecauseAliasesExplainIt() throws {
        let catalog = try bundled()
        // An already installed build validated leniently, so its baseline can hold the mistakes.
        let baseline = try JSONDecoder().decode(
            CatalogSnapshot.self,
            from: published(withMistakes(catalog, revision: try revision(catalog) - 1_000_000)).bytes)
        #expect(baseline.parks.contains { $0.id.rawValue == "1d ago" })
        let corrected = try published(catalog)
        let accepted = try CatalogValidator().decodeAndValidate(
            bytes: corrected.bytes, manifest: corrected.manifest, baseline: baseline)
        #expect(accepted.parks.contains { $0.id.rawValue == mammoth })
        // Without the aliases the same update would strand that phone on the old catalog.
        var bare = catalog
        bare["parks"] = try #require(catalog["parks"] as? [[String: Any]]).map { park -> [String: Any] in
            var value = park
            if mistaken[park["id"] as? String ?? ""] != nil { value["aliases"] = [String]() }
            return value
        }
        let stranded = try published(bare)
        #expect(throws: CatalogValidator.Rejection.removedIdentity) {
            try CatalogValidator().decodeAndValidate(
                bytes: stranded.bytes, manifest: stranded.manifest, baseline: baseline)
        }
    }

    @Test func garbageIdentitiesCanNeverBeAcceptedAsAParkOrSiteID() throws {
        let catalog = try bundled()
        let parks = try #require(catalog["parks"] as? [[String: Any]])
        for (key, bad) in [
            ("id", "1d ago"), ("id", "2 days ago"), ("id", "3 hours ago"), ("id", " padded"), ("id", "café"),
            ("siteID", "2 days ago"), ("siteID", "has space"), ("id", String(repeating: "x", count: 129)),
        ] {
            var broken = catalog
            var first = parks[0]
            first[key] = bad
            broken["parks"] = [first] + parks.dropFirst()
            let candidate = try published(broken)
            #expect(throws: CatalogValidator.Rejection.identity, "\(key)=\(bad)") {
                try CatalogValidator().decodeAndValidate(bytes: candidate.bytes, manifest: candidate.manifest)
            }
        }
    }

    @Test func markVisitedWorksForBothParksAndNeverWorkedUnderTheOldIdentity() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await store.seedPremium()
        let catalog = try bundled()
        let snapshot = try CatalogValidator().decodeAndValidate(
            bytes: published(catalog).bytes, manifest: published(catalog).manifest)
        for id in [mammoth, pocahontas] {
            let park = try #require(snapshot.parks.first { $0.id.rawValue == id })
            let operation = try #require(try await store.markNativeVisit(park: park))
            let staged = try await store.visitOperation(operation)
            #expect(staged.changes.first?.intent.target.officialPlaceID == id)
            #expect(staged.changes.first?.intent.target.siteID == id)
            // The sealed command passes the same checks the server applies before it is sent.
            let sealed = try #require(try await store.nextVisitSubmission())
            try NativeCallableTransport.checkRequest(
                endpoint: "nativeCommand", bytes: sealed.submission.bytes)
            try await store.deferSubmission(sealed.submission.id, until: .distantFuture)
        }
        #expect(
            try await store.nativeVisitOverview().markers.keys.sorted() == [mammoth, pocahontas].sorted())
        // The original defect, kept as evidence: the mistaken identity cannot stage a visit.
        let broken = Park(
            id: .init(rawValue: "1d ago"), siteID: .init(rawValue: "1d ago"),
            name: "Mammoth Cave National Park",
            coordinate: try #require(Coordinate(latitude: 37.1989548, longitude: -86.1155956)))
        await #expect(throws: (any Error).self) { try await store.markNativeVisit(park: broken) }
        await store.close()
    }

    @Test func aParkAddedToTheSheetIsUsableFromTheNextPublishedRevisionWithoutAnAppUpdate() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let catalog = try bundled()
        let baseline = try CatalogValidator().decodeAndValidate(
            bytes: published(catalog).bytes, manifest: published(catalog).manifest)
        var next = catalog
        next["revision"] = try revision(catalog) + 60_000
        var added = try #require((catalog["parks"] as? [[String: Any]])?.first)
        let newID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
        added["id"] = newID
        added["siteID"] = newID
        added["name"] = "Brand New State Park"
        added["aliases"] = [String]()
        added["coordinate"] = ["latitude": 44.123456, "longitude": -93.654321]
        next["parks"] = try #require(catalog["parks"] as? [[String: Any]]) + [added]
        let update = try published(next)
        let accepted = try CatalogValidator().decodeAndValidate(
            bytes: update.bytes, manifest: update.manifest, baseline: baseline)
        let park = try #require(accepted.parks.first { $0.id.rawValue == newID })
        #expect(accepted.parks.count == baseline.parks.count + 1)
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await store.seedPremium()
        #expect(try await store.markNativeVisit(park: park) != nil)
        await store.close()
    }

    @Test func aTripThatStillNamesTheOldIdentityResolvesToTheCorrectedPark() throws {
        let catalog = try bundled()
        let snapshot = try CatalogValidator().decodeAndValidate(
            bytes: published(catalog).bytes, manifest: published(catalog).manifest)
        let park = try #require(snapshot.parks.first { $0.id.rawValue == mammoth })
        let day = Trip.Day(id: "day", stops: [])
        let assignment = try #require(TripDayColor.assignments(for: [day]).first)
        var value = PersonalParkProjection.Value()
        value.days = [ParkID(rawValue: "1d ago"): assignment]
        value.unconfirmedVisits = [ParkID(rawValue: "1d ago")]
        // The map's own alias-aware lookups: an old reference still belongs to this one park.
        #expect(value.day(for: park) == assignment)
        #expect(value.visitIsUnconfirmed(for: park))
        let other = try #require(snapshot.parks.first { $0.id.rawValue == pocahontas })
        #expect(value.day(for: other) == nil)
    }
}
