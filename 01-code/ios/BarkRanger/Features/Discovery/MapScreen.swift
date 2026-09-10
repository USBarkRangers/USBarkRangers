import BarkDomain
import SwiftUI

/// Owns discovery presentation and focus; search/filter results still come from the feature model.
struct MapScreen: View {
    @Bindable var model: MapFeatureModel
    @FocusState private var searchFocused: Bool
    @State private var showsFilters = false

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                NativeMapView(model: model)
                    .accessibilityLabel("Park map")
                    .accessibilityValue("\(model.result.matchingCount) matching parks")
                    .accessibilityIdentifier("park-map")
                    .ignoresSafeArea(.container, edges: .top)
                    .ignoresSafeArea(.keyboard)
                VStack(spacing: 8) {
                    MapSearchBar(
                        text: Binding(
                            get: { model.query.search },
                            set: { text in
                                var query = model.query
                                query.search = text
                                model.setFilters(query)
                            }),
                        focused: $searchFocused,
                        result: model.result,
                        openFilters: {
                            searchFocused = false
                            showsFilters = true
                        })
                    FilterChipsView(query: model.query, update: model.setFilters)
                    if searchFocused || model.parks.isEmpty {
                        MapSearchResults(
                            parks: model.parks,
                            maximumHeight: max(100, min(360, geometry.size.height * 0.55)),
                            select: { id in
                                searchFocused = false
                                model.selectPark(id: id)
                            },
                            clear: { model.setFilters(.init()) })
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.top, 8)
            }
            .overlay(alignment: .bottomTrailing) {
                if !searchFocused {
                    Button(action: model.locateMe) {
                        Image(systemName: "location.fill").frame(width: 48, height: 48)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                    .accessibilityLabel(model.isLocating ? "Locating…" : "Locate me")
                    .disabled(model.isLocating).padding(12)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if model.usesOfflineMap && !searchFocused {
                    Text("Offline geographic overview · Natural Earth")
                        .font(.caption2).foregroundStyle(Color.primary)
                        .padding(6).background(.background, in: RoundedRectangle(cornerRadius: 8))
                        .padding(.leading, 8).padding(.bottom, 76)
                }
            }
        }
        .sheet(isPresented: $showsFilters) {
            FilterSheet(model: model, dismiss: { showsFilters = false })
        }
        .sheet(
            isPresented: Binding(
                get: { model.selectedID != nil && !showsFilters },
                set: { if !$0 { model.dismissPark() } })
        ) {
            ParkDetailView(model: model.detail, dismiss: model.dismissPark).presentationDetents([.large])
        }
        .alert(
            "Location unavailable",
            isPresented: Binding(
                get: { model.locationMessage != nil }, set: { if !$0 { model.locationMessage = nil } })
        ) {
            Button("OK") { model.locationMessage = nil }
        } message: {
            Text(model.locationMessage ?? "")
        }
        .onChange(of: model.selectedID) { _, id in if id != nil { searchFocused = false } }
        .onDisappear { searchFocused = false }
    }
}
