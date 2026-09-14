import BarkDomain
import SwiftUI

struct WalkHistoryView: View {
    @Bindable var model: ExpeditionModel
    @State private var editing: NativeActivityDraft?
    @State private var removing: NativeActivityDraft?
    var body: some View {
        List {
            Section("Walks") {
                if model.history?.items.isEmpty != false {
                    Text(
                        model.history?.hasConfirmedPage == true
                            ? "No walks logged yet." : "No walks downloaded yet."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(model.history?.items ?? []) { walk in
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(walk.meters / 1609.344, specifier: "%.2f") miles").font(.headline)
                            Text(walk.trailName).font(.subheadline)
                            Text(walk.summary.source.rawValue.capitalized).font(.caption).foregroundStyle(
                                .secondary)
                            Text(Date(timeIntervalSince1970: Double(walk.happenedAtMs) / 1000), style: .date)
                                .font(.caption)
                        }
                        Spacer()
                        Menu {
                            Button("Edit walk") { editing = walk }
                            Button("Remove walk", role: .destructive) { removing = walk }
                        } label: {
                            Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("Actions for \(walk.trailName)")
                        .accessibilityIdentifier("walk-actions-\(walk.id)")
                        .disabled(!model.canEdit)
                    }
                }
                if model.history?.loading == true { ProgressView("Loading walks…") }
                if model.history?.hasMore == true {
                    Button("Load more walks") { model.history?.loadMore() }.disabled(
                        model.history?.loading == true)
                }
                if let message = model.history?.message { Text(message).font(.footnote) }
            }
            Section("Completed trails") {
                ForEach(model.completed) { entry in
                    VStack(alignment: .leading) {
                        Text(entry.name)
                        Text(Date(timeIntervalSince1970: Double(entry.completedAtMs) / 1000), style: .date)
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let notice = model.notice(for: .history) { Section { Text(notice).font(.footnote) } }
        }.navigationTitle("Walk history")
            .task(id: model.account.nativeExpeditions?.scope) { await model.observeHistory() }
            .onDisappear { model.history?.stop() }
            .onChange(of: model.account.nativeExpeditions?.scope) { _, _ in
                editing = nil
                removing = nil
            }
            .sheet(item: $editing) { walk in
                WalkEditView(
                    walk: walk,
                    save: { miles, date, name in
                        await model.edit(walk, miles: miles, date: date, trailName: name)
                    })
            }
            .confirmationDialog(
                "Remove this walk?",
                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
            ) {
                Button("Remove walk", role: .destructive) {
                    if let removing { model.remove(removing) }
                    removing = nil
                }
            }
    }
}

private struct WalkEditView: View {
    let walk: NativeActivityDraft
    let save: (Double, Date, String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var miles = ""
    @State private var date = Date()
    @State private var name = ""
    @State private var saving: Task<Void, Never>?
    @State private var failed = false
    var body: some View {
        NavigationStack {
            Form {
                TextField("Miles", text: $miles).keyboardType(.decimalPad)
                DatePicker("Date", selection: $date, in: ...Date())
                TextField("Trail name", text: $name)
                if failed {
                    Text("Could not save. Your edits are kept here; review the values and retry.")
                        .foregroundStyle(.red)
                }
                Text("Corrections retain historical credit but never increase mileage points.").font(
                    .footnote)
            }.navigationTitle("Edit walk")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }.disabled(saving != nil)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            saving = Task {
                                let saved = await save(Double(miles) ?? 0, date, name)
                                if !Task.isCancelled { if saved { dismiss() } else { failed = true } }
                                saving = nil
                            }
                        }.disabled(saving != nil || Double(miles) == nil || name.isEmpty)
                    }
                }
                .interactiveDismissDisabled(saving != nil)
                .onDisappear { saving?.cancel() }
                .onAppear {
                    miles = String(format: "%.2f", walk.meters / 1609.344)
                    date = Date(timeIntervalSince1970: Double(walk.happenedAtMs) / 1000)
                    name = walk.trailName
                }
        }
    }
}
