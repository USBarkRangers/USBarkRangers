import BarkDomain
import SwiftUI

struct SettingsView: View {
    let model: SettingsModel
    @State private var document: SettingsModel.Document?
    var body: some View {
        Form {
            Section("Map") {
                Picker("Map appearance", selection: preference(\.mapStyle)) {
                    ForEach(AppSettings.MapStyle.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                Toggle("Group nearby pins", isOn: preference(\.clustering))
                Toggle("Remember map position", isOn: preference(\.rememberMapPosition))
                Picker("Distance units", selection: preference(\.units)) {
                    ForEach(AppSettings.Units.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .disabled(true)
                Text("Distance measurements are not available yet.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Location permission settings", action: model.openSystemSettings)
            }
            Section("Park catalog") {
                Text(SettingsModel.statusText(model.catalogState))
                if let catalog = model.catalogState.snapshot {
                    LabeledContent("Records", value: String(catalog.parks.count))
                    LabeledContent("Published", value: String(catalog.publishedAt.prefix(10)))
                }
                if let checkedAt = model.catalogState.checkedAt {
                    LabeledContent(
                        "Last checked", value: checkedAt.formatted(date: .abbreviated, time: .shortened))
                }
                Button("Check for updates", action: model.refreshCatalog)
                    .disabled(
                        model.catalogState.status == .checking || model.catalogState.status == .notConfigured)
                Text(
                    "Park records, search, details and the geographic overview work offline. Apple street and satellite imagery need a connection unless already available on your device."
                ).font(.footnote)
            }
            Section("About your data") {
                ForEach(SettingsModel.Document.allCases) { item in
                    Button(item.rawValue) {
                        model.openLegalDocument(item)
                        document = item
                    }
                }
                Text("Settings are saved on this iPhone. Account sign-in and cloud sync arrive in phase 3.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section { Button("Reset device preferences", action: model.resetPreferences) }
        }
        .navigationTitle("Settings")
        .sheet(item: $document) { item in
            NavigationStack {
                ScrollView {
                    Text(model.documentText).textSelection(.enabled).padding(20).frame(
                        maxWidth: .infinity, alignment: .leading)
                }
                .navigationTitle(item.rawValue).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { document = nil } } }
            }
        }
    }
    private func preference<Value>(_ key: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding(
            get: { model.preferences.value[keyPath: key] },
            set: { value in
                var settings = model.preferences.value
                settings[keyPath: key] = value
                model.update(settings)
            })
    }
}
