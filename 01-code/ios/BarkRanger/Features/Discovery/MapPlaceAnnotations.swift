import BarkDomain
import MapKit

/// Non-catalog marker reconciliation only: trip stops, device bookmarks and the selected search result.
final class MapPlaceAnnotations {
    private var annotations: [String: PlaceAnnotation] = [:]
    private var previous: [String: PersonalParkProjection.Value.Place] = [:]
    private var saved: [String: SavedPlaceIndex.Pin] = [:]
    private var showSaved = true
    private var starred = Set<String>()
    private var pendingIdentities = Set<String>()
    private var selected: Trip.Stop?
    private var numberedDay: String?
    var selectedAnnotation: PlaceAnnotation? { selected.flatMap { annotations[$0.id] } }

    func apply(
        _ places: [String: PersonalParkProjection.Value.Place], selected: Trip.Stop?,
        dayID: String?, saved: [String: SavedPlaceIndex.Pin] = [:], showSaved: Bool = true, to map: MKMapView
    ) {
        guard
            previous != places || self.selected != selected || numberedDay != dayID
                || self.saved != saved || self.showSaved != showSaved
        else { return }
        self.saved = saved
        pendingIdentities = Set(saved.values.filter(\.isPending).map { $0.stop.placeIdentity.storageID })
        self.showSaved = showSaved
        previous = places
        self.selected = selected
        numberedDay = dayID
        var stops = places.mapValues(\.stop)
        if let selected { stops[selected.id] = selected }
        // A bookmark shares the existing trip/selected marker when their place identities agree.
        // Hiding bookmarks never hides a trip stop or the explicitly selected search result.
        starred = []
        let savedIdentities = Set(saved.values.map { $0.stop.placeIdentity.storageID })
        for stop in stops.values {
            if let key = SavedPlace.identity(for: stop), savedIdentities.contains(key) {
                starred.insert(stop.id)
            }
        }
        if showSaved {
            let represented = Set(stops.values.compactMap { SavedPlace.identity(for: $0) })
            for record in saved.values where !represented.contains(record.stop.placeIdentity.storageID) {
                stops[record.stop.id] = record.stop
                starred.insert(record.stop.id)
            }
        }
        stops = stops.filter { $0.value.coordinate != nil }
        let removed = annotations.filter { stops[$0.key] == nil }
        map.removeAnnotations(Array(removed.values))
        annotations = annotations.filter { stops[$0.key] != nil }
        for (id, stop) in stops {
            let annotation: PlaceAnnotation
            if let current = annotations[id] {
                annotation = current
                annotation.update(stop)
            } else {
                guard let created = PlaceAnnotation(stop: stop) else { continue }
                annotation = created
                annotations[id] = annotation
                map.addAnnotation(annotation)
            }
            if let view = map.view(for: annotation) as? PlaceAnnotationView {
                configure(view, annotation: annotation)
            }
        }
        if let annotation = selectedAnnotation,
            !map.selectedAnnotations.contains(where: { $0 === annotation })
        {
            map.selectAnnotation(annotation, animated: false)
        }
    }
    func view(for annotation: PlaceAnnotation, on map: MKMapView) -> MKAnnotationView {
        let view =
            (map.dequeueReusableAnnotationView(withIdentifier: "custom-place") as? PlaceAnnotationView)
            ?? PlaceAnnotationView(annotation: annotation, reuseIdentifier: "custom-place")
        view.annotation = annotation
        configure(view, annotation: annotation)
        return view
    }
    private func configure(_ view: PlaceAnnotationView, annotation: PlaceAnnotation) {
        let place = previous[annotation.stop.id]
        let pending = pendingIdentities.contains(annotation.stop.placeIdentity.storageID)
        let color =
            pending
            ? UIColor(red: 1, green: 0.9, blue: 0.45, alpha: 1)
            : place?.day.color.uiColor ?? .systemBlue
        let number = place?.day.dayID == numberedDay ? place?.number : nil
        let selected = selected?.id == annotation.stop.id
        let isSaved = starred.contains(annotation.stop.id)
        if view.image == nil || view.color != color || view.number != number || view.isSelected != selected
            || view.isSaved != isSaved || view.savePending != pending
        {
            view.isSaved = isSaved
            view.savePending = pending
            view.color = color
            view.number = number
            view.setSelected(selected, animated: false)
        }
        view.accessibilityLabel = annotation.stop.name
        view.accessibilityIdentifier = "place-pin-" + annotation.stop.id
    }
}
