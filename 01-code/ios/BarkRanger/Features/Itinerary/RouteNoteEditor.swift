import BarkDomain
import SwiftUI

/// One temporary text buffer; day and stop notes have separate stable persistence targets.
struct RouteNoteDraft: Identifiable {
    let id = UUID()
    let target: TripDayID
    let stopID: String?
    let original: String
    var title: String { stopID == nil ? "Day notes" : "Stop note" }
    func change(_ value: String, expected: String? = nil) -> TripDayEdit {
        if let stopID { return .stopNotes(id: stopID, expected: expected ?? original, value: value) }
        return .notes(expected: expected ?? original, value: value)
    }
}

struct RouteNoteEditor: View {
    let draft: RouteNoteDraft
    let isSaving: Bool
    let message: String?
    let save: (String) -> Void
    @State private var text = ""
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                TextEditor(text: $text).frame(minHeight: 200).accessibilityLabel(draft.title)
                Text("\(text.utf16.count) / 1,000 characters").font(.caption).foregroundStyle(.secondary)
                if let message { Text(message).font(.footnote).foregroundStyle(.red) }
            }
            .navigationTitle(draft.title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save(text) }.disabled(isSaving || text.utf16.count > 1_000)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
        .onAppear { text = draft.original }
    }
}
