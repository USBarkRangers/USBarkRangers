import BarkDomain
import SwiftUI

struct FilterSheet: View {
    let model: MapFeatureModel
    let dismiss: () -> Void
    var body: some View {
        NavigationStack {
            Form {
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
                    Text("Visited parks and trip filters will be available when those features are added.")
                        .foregroundStyle(.secondary)
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
