import BarkDomain
import SwiftUI

/// Paged visit display. A date/removal dialog captures a reviewed native selection.
struct VisitHistoryView: View {
    private struct Editing: Identifiable {
        let value: NativeVisitWorkingState
        var id: String { value.visitID ?? "" }
    }
    let model: PassportModel
    @State private var selected = Set<String>()
    @State private var editing: Editing?
    @State private var date = Date()
    @State private var confirmingRemoval = false
    @State private var removal: [NativeVisitWorkingState] = []
    @State private var preparation: Task<Void, Never>?
    @State private var preparationError: String?
    var body: some View {
        List(selection: $selected) {
            if let notice = model.notice { Text(notice).font(.footnote) }
            if let preparationError { Text(preparationError).font(.footnote) }
            if model.canEdit, !selected.isEmpty {
                Button("Remove selected (\(selected.count))", role: .destructive) {
                    let items = (model.history?.items ?? []).filter { selected.contains($0.id) }
                    guard items.count == selected.count else { return }
                    prepare(items) { values in
                        removal = values
                        confirmingRemoval = true
                    }
                }
                .disabled(model.working || preparation != nil)
                .buttonStyle(.borderless)
            }
            ForEach(model.history?.items ?? []) { item in
                let visit = item.visit
                VStack(alignment: .leading, spacing: 6) {
                    Text(visit.name)
                    Label(
                        visit.verified ? "Proximity check-in" : "Manual visit",
                        systemImage: visit.verified ? "location.fill" : "checkmark"
                    )
                    .font(.caption).foregroundStyle(.secondary)
                    Text(visit.happenedAt, style: .date).font(.caption)
                    if model.canEdit {
                        Button("Edit date") {
                            prepare([item]) { values in
                                guard let value = values.first else { return }
                                date = visit.happenedAt
                                editing = Editing(value: value)
                            }
                        }.disabled(model.working || preparation != nil)
                            .font(.caption).buttonStyle(.borderless)
                    }
                }.tag(visit.id)
            }
            if let history = model.history {
                if let message = history.message { Text(message).font(.footnote) }
                if history.hasMore {
                    Button(history.loading ? "Loading visits…" : "Load more visits", action: history.loadMore)
                        .disabled(history.loading).accessibilityIdentifier("load-more-visits")
                }
            }
        }
        .navigationTitle("Visit history")
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) { if model.canEdit { EditButton() } }
        }
        .confirmationDialog(
            "Remove the selected visits? Earned achievement history will be kept.",
            isPresented: $confirmingRemoval, titleVisibility: .visible
        ) {
            Button("Remove visits", role: .destructive) {
                let values = removal
                let removed = Set(values.compactMap(\.visitID))
                model.remove(values) { selected.subtract(removed) }
            }
        }
        .sheet(item: $editing) { visit in
            NavigationStack {
                Form {
                    DatePicker("Visited on", selection: $date, in: Date(timeIntervalSince1970: 0)...Date())
                        .disabled(model.working)
                    Text("Changing the date keeps the visit's original evidence tier.").font(.footnote)
                    if let notice = model.notice { Text(notice).font(.footnote) }
                }.navigationTitle("Visit date").toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            model.changeDate(visit.value, date: date) {
                                if editing?.id == visit.id { editing = nil }
                            }
                        }.disabled(model.working)
                    }
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editing = nil } }
                }
            }.presentationDetents([.medium])
        }
        .onChange(of: model.account.identity?.uid) { _, _ in
            preparation?.cancel()
            preparation = nil
            editing = nil
            removal = []
            confirmingRemoval = false
            selected = []
        }
        .task(id: model.account.nativeVisits?.scope) { await model.history?.observe() }
        .onDisappear {
            preparation?.cancel()
            preparation = nil
            model.history?.stop()
        }
    }
    private func prepare(_ items: [NativeVisitHistory.Item], completed: @escaping ([NativeVisitWorkingState]) -> Void) {
        guard preparation == nil, let feature = model.account.nativeVisits else { return }
        let scope = feature.scope
        preparationError = nil
        preparation = Task {
            defer { if !Task.isCancelled { preparation = nil } }
            do {
                let values = try await feature.repository.selectHistory(items)
                guard !Task.isCancelled, model.account.nativeVisits?.scope == scope else { return }
                completed(values)
            } catch {
                if !Task.isCancelled, model.account.nativeVisits?.scope == scope {
                    preparationError = "The selected visits changed or could not be loaded. Review the history and try again."
                }
            }
        }
    }
}
