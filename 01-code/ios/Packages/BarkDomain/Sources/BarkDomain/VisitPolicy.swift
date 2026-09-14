import Foundation

/// Visit validation and exact touched-record intents. No storage, location requests or UI side effects.
public enum VisitPolicy {
    public enum Failure: Error { case retired, invalidDate, poorLocation, outOfRange, unresolved }
    public static let proximityMeters = 25_000.0

    public static func evaluateProximity(park: Park, fix: LocationFix, now: Date) throws {
        guard fix.accuracy.isFinite, (0...5_000).contains(fix.accuracy),
            abs(fix.date.timeIntervalSince(now)) < 60
        else { throw Failure.poorLocation }
        guard fix.coordinate.distance(to: park.coordinate) <= proximityMeters else {
            throw Failure.outOfRange
        }
    }
    public static func mark(
        park: Park, snapshot: PersonalSnapshot, catalog: CatalogSnapshot,
        fix: LocationFix? = nil, now: Date = Date(), timeZone: TimeZone = .current
    ) throws -> UserMutation? {
        guard !park.isRetired else { throw Failure.retired }
        if let fix { try evaluateProximity(park: park, fix: fix, now: now) }
        let visits = Visit.records(in: snapshot.profile)
        let existing = visits.filter { visit in
            guard let id = visit.parkID else { return false }
            return park.matchesIdentity(ParkID(rawValue: id))
                || catalog.park(id: ParkID(rawValue: id))?.siteID == park.siteID
        }
        if !existing.isEmpty, fix == nil || existing.allSatisfy(\.verified) { return nil }
        var expected: [String: UserValue] = [:]
        var values: [String: UserValue] = [:]
        if existing.isEmpty {
            let id = park.id.rawValue
            expected[id] = .null
            values[id] = .object([
                "id": .string(id), "name": .string(park.name), "state": .string(park.state),
                "lat": .number(park.coordinate.latitude), "lng": .number(park.coordinate.longitude),
                "verified": .bool(fix != nil), "ts": .number(now.timeIntervalSince1970 * 1000),
                "timeZone": .string(timeZone.identifier),
            ])
        } else {
            for visit in existing {
                var fields = visit.fields
                fields["verified"] = .bool(true)
                if fields["timeZone"] == nil { fields["timeZone"] = .string(timeZone.identifier) }
                expected[visit.id] = visit.record
                values[visit.id] = .object(fields)
            }
        }
        if let fix {
            for id in values.keys {
                var fields = values[id]?.object ?? [:]
                fields["proximity"] = .object([
                    "latitude": .number(fix.coordinate.latitude),
                    "longitude": .number(fix.coordinate.longitude),
                    "accuracy": .number(fix.accuracy),
                    "timestamp": .number(fix.date.timeIntervalSince1970 * 1000),
                ])
                values[id] = .object(fields)
            }
        }
        return UserMutation(
            uid: snapshot.uid, kind: .visits, expected: .object(expected), value: .object(values), now: now)
    }
    public static func remove(ids: Set<String>, snapshot: PersonalSnapshot, now: Date = Date()) throws
        -> UserMutation?
    {
        var expected: [String: UserValue] = [:]
        for visit in Visit.records(in: snapshot.profile) where ids.contains(visit.id) {
            guard visit.parkID != nil else { throw Failure.unresolved }
            expected[visit.id] = visit.record
        }
        guard !expected.isEmpty else { return nil }
        return UserMutation(
            uid: snapshot.uid, kind: .visits, expected: .object(expected),
            value: .object(expected.mapValues { _ in .null }), now: now)
    }
    public static func changeDate(id: String, date: Date, snapshot: PersonalSnapshot, now: Date = Date())
        throws -> UserMutation
    {
        guard date.timeIntervalSince1970 >= 0, date <= now.addingTimeInterval(60) else {
            throw Failure.invalidDate
        }
        guard var visit = Visit.records(in: snapshot.profile).first(where: { $0.parkID == id }) else {
            throw Failure.unresolved
        }
        let original = visit.record
        visit.fields["verified"] = .bool(visit.verified)
        visit.fields["ts"] = .number(date.timeIntervalSince1970 * 1000)
        return UserMutation(
            uid: snapshot.uid, kind: .visits, expected: .object([id: original]),
            value: .object([id: visit.record]), now: now)
    }
}
