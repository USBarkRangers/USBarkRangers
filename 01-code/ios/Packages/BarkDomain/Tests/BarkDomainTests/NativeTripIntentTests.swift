import Foundation
import Testing

@testable import BarkDomain

struct NativeTripIntentTests {
    @Test func notesOnlyClassificationCoversBookendsClearingAndSafeFullSaveFallbacks() throws {
        let stop = Trip.Stop(
            id: "stop", placeIdentity: .custom("place"), name: "Place",
            coordinate: Coordinate(latitude: 40, longitude: -80), notes: "Original")
        let trip = Trip(
            id: "trip", days: [.init(id: "day", stops: [stop])],
            start: .init(
                id: "start", placeIdentity: .custom("start"), name: "Start",
                coordinate: Coordinate(latitude: 41, longitude: -81), notes: "Start note"))
        let base = try NativeTripIntent.save(.init(trip: trip)).projectedBase(for: trip)
        var draft = TripDraft(trip: trip, nativeBase: base)
        #expect(try NativeTripNotes(draft: draft) == nil)
        draft.trip.days[0].stops[0].notes = ""
        draft.trip.start?.notes = "Changed start"
        let notes = try #require(try NativeTripNotes(draft: draft))
        #expect(Set(notes.notes.map(\.stopID)) == ["stop", "start"])
        let next = try NativeTripIntent.notes(draft).projectedBase(for: draft.trip)
        #expect(next.contentRevision == 1)
        #expect(next.notes.values.allSatisfy { $0.revision == 2 })
        #expect(try next.contentFingerprint == NativeTripBase.fingerprint(draft.trip))
        var structural = draft
        structural.trip.name = "Rename as well"
        #expect(try NativeTripNotes(draft: structural) == nil)
        structural = draft
        structural.trip.days[0].notes = "Day notes live in itinerary"
        #expect(try NativeTripNotes(draft: structural) == nil)
        structural = draft
        structural.trip.days[0].color = "#000000"
        #expect(try NativeTripNotes(draft: structural) == nil)
        structural = draft
        structural.trip.days[0].stops.removeAll()
        #expect(try NativeTripNotes(draft: structural) == nil)
        var empty = trip
        empty.days[0].stops[0].notes = ""
        let emptyBase = try NativeTripIntent.save(.init(trip: empty)).projectedBase(for: empty)
        var firstNote = TripDraft(trip: empty, nativeBase: emptyBase)
        firstNote.trip.days[0].stops[0].notes = "First note adds a reference"
        #expect(try NativeTripNotes(draft: firstNote) == nil)
        var legacy = draft
        legacy.nativeBase?.contentFingerprint = nil
        #expect(try NativeTripNotes(draft: legacy) == nil)
        // Existing durable saves retain their original wire kind/revision semantics.
        let legacyIntent = try JSONDecoder().decode(
            NativeTripIntent.self,
            from: JSONEncoder().encode(NativeTripIntent.save(draft)))
        #expect(legacyIntent.resultContentRevision == 2)
        #expect(
            try JSONDecoder().decode(
                NativeTripIntent.self,
                from: JSONEncoder().encode(NativeTripIntent.notes(draft))) == .notes(draft))
    }

    @Test func anUnsavedRemovalAndUndoDoNotLoseTheAcknowledgedNotePreimage() throws {
        let saved = Trip(
            id: "trip",
            days: [
                .init(
                    id: "day",
                    stops: [
                        .init(
                            id: "stop", placeIdentity: .custom("place"), name: "Place",
                            coordinate: Coordinate(latitude: 40, longitude: -80), notes: "Submitted text")
                    ])
            ])
        let intent = NativeTripIntent.save(TripDraft(trip: saved, nativeBase: .init()))
        var working = saved
        working.days[0].stops = []
        let base = try intent.projectedBase(for: working)
        #expect(base.notes.count == 1)
        working.days[0].stops = saved.days[0].stops
        working.days[0].stops[0].notes = "Edited after undo"
        let command = try NativeTripSave(trip: working, baseNotes: base.notes)
        #expect(command.notes.first?.expectedRevision == 1)
        #expect(command.notes.first?.text == "Edited after undo")
    }
}
