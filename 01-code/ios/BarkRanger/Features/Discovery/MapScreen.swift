import BarkDomain
import SwiftUI

/// Owns discovery presentation and focus; search/filter results still come from the feature model.
struct MapScreen: View {
    @Bindable var model: MapFeatureModel
    @FocusState private var searchFocused: Bool
    @State private var showsFilters = false
    @State private var recentersAfterFilters = false
    @State private var resultsCollapsed = true
    @State private var detailPosition = MapSheetPosition.low
    @State private var detailHeight: CGFloat = 0
    @State private var routeHeight: CGFloat = 0
    @State private var isVisible = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var searchHeight: CGFloat = 60
    @State private var controlsHeight: CGFloat = 60
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let sheetLayout = MapSheetLayout(
                availableHeight: geometry.size.height + geometry.safeAreaInsets.bottom,
                bottomOverlap: geometry.safeAreaInsets.bottom, searchHeight: searchHeight)
            let showsDay = model.routeDay?.target != nil
            let sheetHeight = model.selectionID != nil ? detailHeight : showsDay ? routeHeight : 0
            let hidesChrome = sheetLayout.hidesChrome(at: sheetHeight)
            ZStack(alignment: .top) {
                NativeMapView(
                    model: model, detailFramingHeight: sheetLayout.height(at: .medium),
                    topObstruction: geometry.safeAreaInsets.top + searchHeight,
                    interactionBegan: dismissSearch
                )
                .accessibilityLabel("Park map")
                .accessibilityValue("\(model.result.matchingCount) matching parks")
                .accessibilityIdentifier("park-map")
                .ignoresSafeArea(.container, edges: [.top, .bottom])
                .ignoresSafeArea(.keyboard)
                VStack(spacing: 8) {
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
                        FilterChipsView(
                            query: model.query, update: model.setFilters,
                            trip: model.routeDay, showRoute: model.showTripRoute,
                            openTrip: model.openTrip,
                            emptySpaceTapped: dismissSearch)
                    }
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        searchHeight = $0 + MapSheetLayout.topInset
                    }
                    if searchFocused || (model.parks.isEmpty && !resultsCollapsed) {
                        MapSearchResults(
                            parks: model.projection?.searchParks ?? [], places: model.placeSearch,
                            selectPlace: { suggestion in
                                model.placeSearch.select(suggestion) { model.selectPlace($0) }
                            },
                            maximumHeight: max(100, min(360, geometry.size.height * 0.55)),
                            select: { id in
                                searchFocused = false
                                model.selectPark(id: id)
                            },
                            clear: { model.setFilters(.init()) })
                    }
                }
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    controlsHeight = $0
                }
                .padding(.horizontal, 12).padding(.top, MapSheetLayout.topInset)
                .offset(
                    y: reduceMotion || !hidesChrome ? 0 : -(controlsHeight + geometry.safeAreaInsets.top + 16)
                )
                .opacity(reduceMotion && hidesChrome ? 0 : 1)
                .animation(.easeInOut(duration: MapSheetLayout.chromeDuration), value: hidesChrome)
                .allowsHitTesting(!hidesChrome)
                .accessibilityHidden(hidesChrome)
            }
            .background(MapTabBarTransition(hidesChrome: hidesChrome, reduceMotion: reduceMotion))
            .background(Color(uiColor: .systemBackground).ignoresSafeArea())
            .overlay(alignment: .bottomLeading) {
                if model.usesOfflineMap && !searchFocused && model.selectionID == nil && !showsDay {
                    Text("Offline geographic overview · Natural Earth")
                        .font(.footnote).foregroundStyle(Color.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(6).background(.background, in: RoundedRectangle(cornerRadius: 8))
                        .padding(.horizontal, 8).padding(.bottom, 76)
                }
            }
            .overlay(alignment: .bottom) {
                if !showsFilters {
                    MapSelectionSheets(
                        model: model, parkPosition: $detailPosition, layout: sheetLayout,
                        addStop: {
                            model.routeDay?.position = .low
                            searchFocused = true
                        },
                        parkHeightChanged: { detailHeight = $0 }, dayHeightChanged: { routeHeight = $0 }
                    )
                    .offset(y: geometry.safeAreaInsets.bottom)
                }
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .sheet(
            isPresented: $showsFilters,
            onDismiss: {
                // Present a possible permission/failure alert only after the filter sheet has closed.
                guard recentersAfterFilters else { return }
                recentersAfterFilters = false
                model.locateMe()
            }
        ) {
            FilterSheet(
                model: model, dismiss: { showsFilters = false },
                recenter: {
                    recentersAfterFilters = true
                    showsFilters = false
                })
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
        .onChange(of: model.selectionID) { _, id in
            // Keep the user's low/medium browsing height across selections and dismissals.
            // Reset high on the next selection so the departing sheet keeps its full height.
            if id != nil {
                resultsCollapsed = true
                if detailPosition == .high { detailPosition = .low }
                searchFocused = false
            } else {
                detailHeight = 0
            }
        }
        .onChange(of: searchFocused) { _, focused in
            if focused {
                resultsCollapsed = false
                model.dismissPark()
                model.routeDay?.position = .low
            }
            refreshPlaces()
        }
        .onChange(of: model.query) { _, _ in
            resultsCollapsed = false
            refreshPlaces()
        }
        .onChange(of: model.canSearchPlaces) { _, _ in refreshPlaces() }
        .onChange(of: model.isOffline) { _, _ in refreshPlaces() }
        .onChange(of: model.searchFocusRequest) { _, _ in focusRequestedSearch() }
        .onChange(of: model.routeDay?.target) { _, target in
            if target != nil { searchFocused = false } else { routeHeight = 0 }
        }
        .onAppear {
            isVisible = true
            model.routeDay?.start()
            focusRequestedSearch()
        }
        .onDisappear {
            isVisible = false
            searchFocused = false
            model.placeSearch.cancel()
            model.routeDay?.stop()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && isVisible {
                model.routeDay?.start()
                refreshPlaces()
            }
            if phase == .background { model.placeSearch.cancel() }
        }
    }
    private func dismissSearch() {
        resultsCollapsed = true
        searchFocused = false
    }
    private func focusRequestedSearch() {
        guard isVisible, model.consumeSearchFocusRequest() else { return }
        searchFocused = true
    }
    private func refreshPlaces() {
        guard searchFocused else {
            model.placeSearch.cancel()
            return
        }
        model.placeSearch.update(
            query: model.query.search, region: model.lastRegion,
            permitted: model.canSearchPlaces, connected: !model.isOffline)
    }

}
