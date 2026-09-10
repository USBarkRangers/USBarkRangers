import BarkDomain
import SwiftUI

struct MapScreen: View {
    @Bindable var model: MapFeatureModel
    @State private var showsList = false
    @State private var sheet: Sheet?
    private enum Sheet: String, Identifiable {
        case search, filters
        var id: Self { self }
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                FilterSummaryView(result: model.result, clear: { model.setFilters(.init()) })
                Text(SettingsModel.statusText(model.catalogState)).font(.caption).foregroundStyle(
                    Color.primary
                ).fixedSize(horizontal: false, vertical: true)
                Picker("Discovery display", selection: $showsList) {
                    Text("Map").tag(false)
                    Text("Results list").tag(true)
                }.pickerStyle(.segmented)
            }.padding(.horizontal).padding(.vertical, 10).background(.background)
            if showsList {
                if #available(iOS 26, *) {
                    resultsList.scrollEdgeEffectHidden(for: .bottom)
                } else {
                    resultsList
                }
            } else {
                ZStack(alignment: .bottomTrailing) {
                    NativeMapView(model: model)
                        .accessibilityLabel("Park map")
                    Button(action: model.locateMe) {
                        Label(model.isLocating ? "Locating…" : "Locate me", systemImage: "location.fill")
                    }
                    .buttonStyle(.borderedProminent).controlSize(.large).disabled(model.isLocating).padding()
                    if model.parks.isEmpty { emptyResults.background(.background) }
                }
                if model.usesOfflineMap {
                    Text("Offline geographic overview · Natural Earth").font(.caption).padding(6)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Search parks", systemImage: "magnifyingglass") { sheet = .search }
                Button("Filters", systemImage: "line.3.horizontal.decrease") { sheet = .filters }
            }
        }
        .sheet(item: $sheet, onDismiss: {}) { item in
            switch item {
            case .search: SearchSheet(model: model, dismiss: { sheet = nil })
            case .filters: FilterSheet(model: model, dismiss: { sheet = nil })
            }
        }
        .sheet(
            isPresented: Binding(
                get: { model.selectedID != nil && sheet == nil }, set: { if !$0 { model.dismissPark() } })
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
        .onChange(of: model.settings.value.filters) { _, _ in model.rebuild() }
    }
    private var resultsList: some View {
        List(model.parks) { park in
            Button {
                model.selectPark(id: park.id)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(park.name).foregroundStyle(Color.primary)
                    Text("\(park.state) · \(park.swag.rawValue)").font(.subheadline).foregroundStyle(
                        Color.primary)
                }.fixedSize(horizontal: false, vertical: true).padding(.vertical, 5)
            }
        }.listStyle(.plain).clipped()
            .overlay { if model.parks.isEmpty { emptyResults } }
    }

    private var emptyResults: some View {
        ScrollView {
            ContentUnavailableView {
                Label("No matching parks", systemImage: "magnifyingglass")
            } description: {
                Text("Your saved catalog is still available. Try another search or clear the filters.")
                    .foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
            } actions: {
                Button("Clear filters") { model.setFilters(.init()) }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            }
            .padding(.vertical, 20)
        }
    }
}
