import BarkDomain
import SwiftUI

/// Owns discovery presentation and focus; search/filter results still come from the feature model.
struct MapScreen: View {
    @Bindable var model: MapFeatureModel
    @FocusState private var searchFocused: Bool
    @State private var showsFilters = false
    @State private var resultsCollapsed = false
    @State private var detailPosition = ParkSheetPosition.low
    @State private var detailHeight: CGFloat = 0
    @State private var searchHeight: CGFloat = 60
    @State private var tabBarOverlap: CGFloat = 0
    @State private var aboveMedium = false

    var body: some View {
        GeometryReader { geometry in
            let sheetLayout = ParkSheetLayout(
                availableHeight: geometry.size.height + geometry.safeAreaInsets.bottom,
                bottomOverlap: tabBarOverlap, searchHeight: searchHeight)
            ZStack(alignment: .top) {
                NativeMapView(
                    model: model, detailPosition: detailPosition, detailHeight: detailHeight,
                    detailMaximumHeight: sheetLayout.height(at: .medium),
                    topObstruction: geometry.safeAreaInsets.top + searchHeight
                ) {
                    resultsCollapsed = true
                    searchFocused = false
                }
                .accessibilityLabel("Park map")
                .accessibilityValue("\(model.result.matchingCount) matching parks")
                .accessibilityIdentifier("park-map")
                .ignoresSafeArea(.container, edges: [.top, .bottom])
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
                            model.dismissPark()
                            showsFilters = true
                        })
                    FilterChipsView(query: model.query, update: model.setFilters)
                    if searchFocused || (model.parks.isEmpty && !resultsCollapsed) {
                        MapSearchResults(
                            parks: model.parks,
                            maximumHeight: max(100, min(360, geometry.size.height * 0.55)),
                            select: { id in
                                searchFocused = false
                                model.selectPark(id: id)
                            },
                            clear: { model.setFilters(.init()) })
                    }
                }
                .padding(.horizontal, 12).padding(.top, ParkSheetLayout.topInset)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    searchHeight = $0
                }
                .opacity(model.selectedID != nil && aboveMedium ? 0 : 1)
                .allowsHitTesting(model.selectedID == nil || !aboveMedium)
                .accessibilityHidden(model.selectedID != nil && aboveMedium)
            }
            .background(Color(uiColor: .systemBackground).ignoresSafeArea())
            .overlay(alignment: .bottomTrailing) {
                if !searchFocused && model.selectedID == nil {
                    Button(action: model.locateMe) {
                        Image(systemName: "location.fill").frame(width: 48, height: 48)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                    .accessibilityLabel(model.isLocating ? "Locating…" : "Locate me")
                    .disabled(model.isLocating).padding(12)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if model.usesOfflineMap && !searchFocused && model.selectedID == nil {
                    Text("Offline geographic overview · Natural Earth")
                        .font(.caption2).foregroundStyle(Color.primary)
                        .padding(6).background(.background, in: RoundedRectangle(cornerRadius: 8))
                        .padding(.leading, 8).padding(.bottom, 76)
                }
            }
            .overlay(alignment: .bottom) {
                if model.selectedID != nil && !showsFilters {
                    ParkDetailSheet(
                        model: model.detail, position: $detailPosition, layout: sheetLayout,
                        dismiss: model.dismissPark
                    ) { height, expanded in
                        detailHeight = height
                        aboveMedium = expanded
                    }
                    .offset(y: geometry.safeAreaInsets.bottom)
                }
            }
            .onChange(of: geometry.safeAreaInsets.bottom, initial: true) { _, overlap in
                // Keep detents stable when hiding the native tab bar changes the safe area mid-drag.
                if model.selectedID == nil && !searchFocused { tabBarOverlap = overlap }
            }
        }
        .toolbar(model.selectedID != nil && aboveMedium ? .hidden : .visible, for: .tabBar)
        .sheet(isPresented: $showsFilters) {
            FilterSheet(model: model, dismiss: { showsFilters = false })
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
        .onChange(of: model.selectedID) { _, id in
            detailPosition = .low
            aboveMedium = false
            if id != nil { searchFocused = false }
        }
        .onChange(of: searchFocused) { _, focused in
            if focused {
                resultsCollapsed = false
                model.dismissPark()
            }
        }
        .onChange(of: model.query) { _, _ in resultsCollapsed = false }
        .onDisappear { searchFocused = false }
    }
}
