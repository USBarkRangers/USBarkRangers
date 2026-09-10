import BarkDomain
import SwiftUI

struct SearchSheet: View {
    @Bindable var model: MapFeatureModel
    let dismiss: () -> Void
    var body: some View {
        NavigationStack {
            List(model.parks) { park in
                Button {
                    model.selectPark(id: park.id)
                    dismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(park.name).foregroundStyle(Color.primary)
                        Text("\(park.state) · \(park.swag.rawValue)").font(.subheadline).foregroundStyle(
                            Color.primary)
                    }.fixedSize(horizontal: false, vertical: true).padding(.vertical, 4)
                }
            }
            .overlay { if model.parks.isEmpty { ContentUnavailableView.search(text: model.query.search) } }
            .searchable(
                text: Binding(
                    get: { model.query.search },
                    set: { text in
                        var query = model.query
                        query.search = text
                        model.setFilters(query)
                    }), prompt: "Park name, state or abbreviation"
            )
            .searchPresentationToolbarBehavior(.avoidHidingContent)
            .navigationTitle("Search parks")
            .safeAreaInset(edge: .bottom) {
                FilterSummaryView(result: model.result, clear: { model.setFilters(.init()) }).padding()
                    .background(.background)
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: dismiss) } }
        }
    }
}
