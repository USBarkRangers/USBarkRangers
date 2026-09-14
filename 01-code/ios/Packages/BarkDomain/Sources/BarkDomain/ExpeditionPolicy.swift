import Foundation

/// Pure existing-schema operations. Server validation repeats these rules; local projection grants no authority.
public enum ExpeditionPolicy {
    public enum Failure: Error {
        case invalid, changedRun, duplicate, overlap, incomplete, missingWalk, limit
    }
    public static let keys = ["virtual_expedition", "lifetime_miles", "walkPoints", "completed_expeditions"]
    public static func content(_ profile: UserProfile) -> UserValue {
        .object(Dictionary(uniqueKeysWithValues: keys.map { ($0, profile.fields[$0] ?? .null) }))
    }
    public static func operation(
        action: String, payload: UserValue, snapshot: PersonalSnapshot,
        id: String = UUID().uuidString.lowercased(), now: Date = Date()
    ) throws -> UserMutation {
        let value = UserValue.object(["action": .string(action), "payload": payload])
        _ = try applying(value, to: snapshot.profile, now: now)
        return UserMutation(
            uid: snapshot.uid, kind: .expedition, expected: content(snapshot.profile),
            value: value, id: id, now: now)
    }
    public static func applying(_ value: UserValue, to profile: UserProfile, now: Date) throws -> UserProfile
    {
        guard let action = value.object?["action"]?.string,
            let payload = value.object?["payload"]?.object
        else { throw Failure.invalid }
        let rawExpedition = profile.fields["virtual_expedition"]
        guard rawExpedition == nil || rawExpedition == .null || rawExpedition?.object != nil else {
            throw Failure.invalid
        }
        let rawHistory = rawExpedition?.object?["history"]
        let rawCompleted = profile.fields["completed_expeditions"]
        let rawIDs = rawExpedition?.object?["native_walk_ids"]
        guard rawHistory == nil || rawHistory == .null || rawHistory?.array != nil,
            rawCompleted == nil || rawCompleted == .null || rawCompleted?.array != nil,
            rawIDs == nil || rawIDs == .null || rawIDs?.array != nil
        else { throw Failure.invalid }
        var result = profile
        var expedition = Expedition(profile: profile).fields
        var history = expedition["history"]?.array ?? []
        var miles = expedition["miles_logged"]?.expeditionNumber ?? 0
        var lifetime = profile.fields["lifetime_miles"]?.expeditionNumber ?? 0
        var points = profile.fields["walkPoints"]?.expeditionNumber ?? 0
        switch action {
        case "assign":
            guard let trail = try Trail.bundled().first(where: { $0.id == payload["trailID"]?.string }),
                let run = payload["runID"]?.string, UUID(uuidString: run) != nil
            else { throw Failure.invalid }
            if expedition["native_run_id"]?.string == run { return profile }
            expedition["active_trail"] = .string(trail.id)
            expedition["trail_name"] = .string(trail.name)
            expedition["trail_total_miles"] = .number(trail.meters / 1609.344)
            expedition["native_run_id"] = .string(run)
            miles = 0
        case "walk":
            guard let id = payload["id"]?.string, UUID(uuidString: id) != nil,
                let source = payload["source"]?.string, WalkSummary.Source(rawValue: source) != nil,
                let start = payload["startedAt"]?.date, let end = payload["endedAt"]?.date,
                start.timeIntervalSince1970 >= 0, end >= start, end <= now.addingTimeInterval(300),
                end.timeIntervalSince(start) <= 7 * 86400,
                let meters = payload["meters"]?.number, meters.isFinite, meters > 0, meters <= 500_000,
                let seconds = payload["elapsedSeconds"]?.number, seconds.isFinite, seconds >= 0,
                seconds <= end.timeIntervalSince(start) + 1
            else { throw Failure.invalid }
            if source != "manual", seconds <= 0 || meters / seconds > 8.94 { throw Failure.invalid }
            if source == "manual", meters > 15 * 1609.344 + 0.01 { throw Failure.limit }
            let ids = expedition["native_walk_ids"]?.array ?? []
            guard !ids.contains(.string(id)) else { throw Failure.duplicate }
            guard ids.count < 5_000, history.count < 2_000 else { throw Failure.limit }
            guard (payload["runID"]?.string) == expedition["native_run_id"]?.string else {
                throw Failure.changedRun
            }
            if source != "manual",
                history.contains(where: {
                    guard let fields = $0.object, fields["source"]?.string != "manual",
                        let oldStart = fields["startedAt"]?.date, let oldEnd = fields["endedAt"]?.date
                    else { return false }
                    return start < oldEnd && end > oldStart
                })
            {
                throw Failure.overlap
            }
            let added = (meters / 1609.344 * 100).rounded() / 100
            var record = payload
            record["miles"] = .number(added)
            record["ts"] = payload["endedAt"]
            record["pointMiles"] = .number(0)
            record["type"] = .string(
                source == "manual"
                    ? "Manual Entry"
                    : source == "health"
                        ? "Apple Health" : source == "pedometer" ? "Motion distance" : "GPS Walk")
            record["trailName"] = expedition["trail_name"] ?? .string("General Walk")
            history.insert(.object(record), at: 0)
            expedition["native_walk_ids"] = .array(ids + [.string(id)])
            lifetime += added
            if expedition["active_trail"]?.string != nil { miles += added }
        case "edit", "remove":
            guard let id = payload["id"]?.string,
                let index = Expedition(profile: profile).history.firstIndex(where: { $0.id == id })
            else { throw Failure.missingWalk }
            // Locate by identity in the raw array so unrelated malformed records retain their position.
            guard
                let rawIndex = history.enumerated().first(where: { offset, raw in
                    raw.object.map { WalkHistoryRecord(fields: $0, index: offset).id == id } == true
                })?.offset, var record = history[rawIndex].object
            else { throw Failure.missingWalk }
            let old = Expedition(profile: profile).history[index]
            guard old.editable else { throw Failure.invalid }
            let newMeters = action == "remove" ? 0 : payload["meters"]?.number ?? -1
            guard newMeters.isFinite, (0...500_000).contains(newMeters) else { throw Failure.invalid }
            if action == "edit", record["id"]?.string != nil {
                let cap =
                    record["source"]?.string == "manual"
                    ? 15 * 1609.344 : record["meters"]?.number ?? old.meters
                guard newMeters <= cap + 0.01 else { throw Failure.limit }
            }
            let newMiles = newMeters / 1609.344
            let newName = payload["trailName"]?.string ?? old.trailName
            guard !newName.isEmpty, newName.utf16.count <= 200 else { throw Failure.invalid }
            let date = payload["date"]?.date ?? old.date ?? now
            guard date <= now.addingTimeInterval(300) else { throw Failure.invalid }
            let credited = action == "remove" ? 0 : min(newMiles, old.pointMiles)
            points = max(0, points + credited - old.pointMiles)
            lifetime = max(0, lifetime + newMiles - old.meters / 1609.344)
            let activeName = expedition["trail_name"]?.string
            if record["id"]?.string != nil {
                // Native attribution is the immutable run ID; editing a display name cannot move credit.
                if let run = record["runID"]?.string, run == expedition["native_run_id"]?.string {
                    miles += newMiles - old.meters / 1609.344
                }
            } else {
                if old.trailName == activeName { miles -= old.meters / 1609.344 }
                if action != "remove", newName == activeName { miles += newMiles }
            }
            if action == "remove" {
                history.remove(at: rawIndex)
            } else {
                record["miles"] = .number(newMiles)
                record["pointMiles"] = .number(credited)
                record["trailName"] = .string(newName)
                record["ts"] = .number(date.timeIntervalSince1970 * 1000)
                history[rawIndex] = .object(record)
            }
        case "claim":
            guard let run = payload["runID"]?.string, run == expedition["native_run_id"]?.string,
                let trailID = expedition["active_trail"]?.string,
                let total = expedition["trail_total_miles"]?.expeditionNumber, total > 0, miles >= total
            else {
                throw Failure.incomplete
            }
            var completed = profile.fields["completed_expeditions"]?.array ?? []
            guard !completed.contains(where: { $0.object?["runID"]?.string == run }) else {
                throw Failure.duplicate
            }
            var entry = completed.first { $0.object?["id"]?.string == trailID }?.object ?? [:]
            entry.merge(
                [
                    "id": .string(trailID), "runID": .string(run),
                    "name": expedition["trail_name"] ?? .string(trailID), "miles": .number(total),
                    "points_earned": .number(1), "date_completed": .number(now.timeIntervalSince1970 * 1000),
                ],
                uniquingKeysWith: { _, new in new })
            completed.removeAll { $0.object?["id"]?.string == trailID }
            completed.append(.object(entry))
            result.fields["completed_expeditions"] = .array(completed)
            points += 1
            miles = 0
            for key in ["active_trail", "trail_name", "native_run_id"] { expedition[key] = .null }
            expedition["trail_total_miles"] = .number(0)
        default: throw Failure.invalid
        }
        expedition["history"] = .array(history)
        expedition["miles_logged"] = .number(max(0, miles))
        result.fields["virtual_expedition"] = .object(expedition)
        result.fields["lifetime_miles"] = .number(lifetime)
        result.fields["walkPoints"] = .number(points)
        return result
    }
}
