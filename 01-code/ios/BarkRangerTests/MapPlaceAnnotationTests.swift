import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct MapPlaceAnnotationTests {
    @Test func pendingBookmarkKeepsItsMarkerAndOnlyTurnsNormalAfterAcknowledgment() throws {
        let map = PlaceRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let markers = MapPlaceAnnotations()
        let stop = Trip.Stop(
            name: "Pending pin", coordinate: try #require(Coordinate(latitude: 41, longitude: -81)))
        let place = try #require(SavedPlace(stop: stop, subtitle: ""))
        markers.apply(
            [:], selected: stop, dayID: nil, saved: [place.id: .init(place, pending: true)], to: map)
        let annotation = try #require(markers.selectedAnnotation)
        let pending = try #require(markers.view(for: annotation, on: map) as? PlaceAnnotationView)
        #expect(pending.savePending && pending.isSaved)
        #expect(pending.color == UIColor(red: 1, green: 0.9, blue: 0.45, alpha: 1))
        #expect(pending.accessibilityValue?.contains("Waiting for server confirmation") == true)
        markers.apply([:], selected: stop, dayID: nil, saved: [place.id: .init(place)], to: map)
        #expect(markers.selectedAnnotation === annotation)
        let confirmed = try #require(markers.view(for: annotation, on: map) as? PlaceAnnotationView)
        #expect(!confirmed.savePending && confirmed.isSaved && confirmed.color == .systemBlue)
    }
    @Test func bookmarksShareTripAndSelectedMarkersAndVisibilityNeverDeletesMembership() throws {
        let map = PlaceRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let markers = MapPlaceAnnotations()
        let stop = Trip.Stop(
            name: "Hinckley", coordinate: try #require(Coordinate(latitude: 41.24, longitude: -81.75)))
        let bookmark = try #require(SavedPlace(stop: stop, subtitle: "Ohio"))
        let saved = [bookmark.id: SavedPlaceIndex.Pin(bookmark)]
        markers.apply([:], selected: stop, dayID: nil, to: map)
        let selected = try #require(markers.selectedAnnotation)
        markers.apply([:], selected: stop, dayID: nil, saved: saved, to: map)
        #expect(
            markers.selectedAnnotation === selected,
            "Saving must not replace the selected pin or move its camera")
        #expect(map.annotations.compactMap { $0 as? PlaceAnnotation }.count == 1)
        let view = try #require(markers.view(for: selected, on: map) as? PlaceAnnotationView)
        #expect(view.isSaved && view.isSelected)
        let day = TripDayColor.Assignment(dayID: "one", index: 0, color: TripDayColor.palette[0])
        let trip = [stop.id: PersonalParkProjection.Value.Place(stop: stop, day: day, number: 1)]
        markers.apply(trip, selected: nil, dayID: "one", saved: saved, to: map)
        #expect(map.annotations.compactMap { $0 as? PlaceAnnotation }.count == 1)
        let tripView = try #require(markers.view(for: selected, on: map) as? PlaceAnnotationView)
        #expect(tripView.isSaved && tripView.color == day.color.uiColor && tripView.number == 1)
        markers.apply(trip, selected: nil, dayID: "one", saved: saved, showSaved: false, to: map)
        #expect(
            map.annotations.compactMap { $0 as? PlaceAnnotation }.count == 1,
            "A visibility filter cannot remove a trip stop")
        markers.apply([:], selected: nil, dayID: nil, saved: saved, showSaved: false, to: map)
        #expect(map.annotations.compactMap { $0 as? PlaceAnnotation }.isEmpty)
        markers.apply([:], selected: nil, dayID: nil, saved: saved, to: map)
        #expect(
            map.annotations.compactMap { $0 as? PlaceAnnotation }.count == 1,
            "Clearing a trip must retain its independent bookmark")
        map.lookups = 0
        map.mutations = 0
        for _ in 0..<300 { markers.apply([:], selected: nil, dayID: nil, saved: saved, to: map) }
        #expect(map.lookups == 0 && map.mutations == 0)
        markers.apply(trip, selected: nil, dayID: "one", to: map)
        let retained = try #require(map.annotations.compactMap { $0 as? PlaceAnnotation }.first)
        let unstarred = try #require(markers.view(for: retained, on: map) as? PlaceAnnotationView)
        #expect(!unstarred.isSaved && unstarred.color == day.color.uiColor)
        markers.apply([:], selected: nil, dayID: nil, to: map)
        #expect(map.annotations.compactMap { $0 as? PlaceAnnotation }.isEmpty)
    }
    @Test func geometryDoesNotRescanCustomStopsAndRemovingTripRemovesItsAnnotations() throws {
        let map = PlaceRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let markers = MapPlaceAnnotations()
        let color = TripDayColor.Assignment(dayID: "one", index: 0, color: TripDayColor.palette[0])
        let places = try Dictionary(
            uniqueKeysWithValues: (0..<500).map { index in
                let stop = Trip.Stop(
                    name: "Place \(index)", coordinate: try #require(Coordinate(latitude: 41, longitude: -81))
                )
                return (
                    stop.id, PersonalParkProjection.Value.Place(stop: stop, day: color, number: index + 1)
                )
            })
        markers.apply(places, selected: nil, dayID: nil, to: map)
        let initial = map.annotations.compactMap { $0 as? PlaceAnnotation }
        #expect(initial.count == 500)
        map.lookups = 0
        map.mutations = 0
        for _ in 0..<300 { markers.apply(places, selected: nil, dayID: nil, to: map) }
        #expect(map.lookups == 0 && map.mutations == 0)
        let selected = try #require(initial.first?.stop)
        markers.apply(places, selected: selected, dayID: "one", to: map)
        #expect(markers.selectedAnnotation === initial.first)
        markers.apply([:], selected: nil, dayID: nil, to: map)
        #expect(map.annotations.compactMap { $0 as? PlaceAnnotation }.isEmpty)
        #expect(markers.selectedAnnotation == nil)
    }
}

@MainActor private final class PlaceRecordingMap: MKMapView {
    var lookups = 0
    var mutations = 0
    override func view(for annotation: any MKAnnotation) -> MKAnnotationView? {
        lookups += 1
        return nil
    }
    override func addAnnotation(_ annotation: any MKAnnotation) {
        mutations += 1
        super.addAnnotation(annotation)
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        mutations += 1
        super.removeAnnotations(annotations)
    }
}
