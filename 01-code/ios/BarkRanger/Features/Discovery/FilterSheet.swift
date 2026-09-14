import BarkDomain
import SwiftUI

struct FilterSheet: View {
    let model: MapFeatureModel
    let dismiss: () -> Void
    let recenter: () -> Void
    var body: some View {
        NavigationStack {
            Form {
                Section("Map") {
                    Toggle(
                        "Show saved pins",
                        isOn: Binding(
                            get: { model.settings.value.showSavedPins },
                            set: { visible in
                                var settings = model.settings.value
                                settings.showSavedPins = visible
                                model.settings.update(settings)
                            })
                    )
                    .accessibilityIdentifier("show-saved-pins")
                    if let saved = model.savedPlaces, !saved.isReady, let message = saved.message {
                        Text(message).font(.footnote)
                        Button("Retry saved places", action: saved.load).disabled(saved.isWorking)
                    }
                    Button(action: recenter) {
                        Label(
                            model.isLocating ? "Locating…" : "Recenter on my location",
                            systemImage: "location.fill")
                    }.disabled(model.isLocating)
                }
                Section("Park category") {
                    ForEach(ParkCategory.allCases, id: \.self) { category in
                        Toggle(
                            category.rawValue,
                            isOn: Binding(
                                get: { model.query.categories.contains(category) },
                                set: { included in
                                    var query = model.query
                                    if included {
                                        query.categories.insert(category)
                                    } else {
                                        query.categories.remove(category)
                                    }
                                    model.setFilters(query)
                                }))
                    }
                }
                Section("Swag") {
                    ForEach(Swag.allCases, id: \.self) { swag in
                        Toggle(
                            swag.rawValue,
                            isOn: Binding(
                                get: { model.query.swag.contains(swag) },
                                set: { included in
                                    var query = model.query
                                    if included { query.swag.insert(swag) } else { query.swag.remove(swag) }
                                    model.setFilters(query)
                                }))
                    }
                }
                Section { Text("When none are selected, all are included.") }
                Section("Personal filters") {
                    Picker(
                        "Show parks",
                        selection: Binding(
                            get: { model.query.personal },
                            set: { value in
                                var query = model.query
                                query.personal = value
                                model.setFilters(query)
                            })
                    ) {
                        Text("All parks").tag(ParkFilter.Personal.all)
                        Text("Visited").tag(ParkFilter.Personal.visited)
                        Text("Not visited").tag(ParkFilter.Personal.unvisited)
                        Text("In active trip").tag(ParkFilter.Personal.trip)
                    }
                }
                Section { Button("Reset filters") { model.setFilters(.init()) } }
            }
            .navigationTitle("Filters")
            .safeAreaInset(edge: .bottom) {
                FilterSummaryView(result: model.result, clear: { model.setFilters(.init()) }).padding()
                    .background(.background)
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: dismiss) } }
        }
    }
}
