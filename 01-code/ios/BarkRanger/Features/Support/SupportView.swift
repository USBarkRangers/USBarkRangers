import BarkDomain
import PhotosUI
import SwiftUI

struct SupportDependencies {
    let account: AccountSession
    let service: (any FeedbackSending)?
    let store: FeedbackDraftStore
}
private struct SupportKey: EnvironmentKey { static let defaultValue: SupportDependencies? = nil }
extension EnvironmentValues {
    var support: SupportDependencies? {
        get { self[SupportKey.self] }
        set { self[SupportKey.self] = newValue }
    }
}

struct SupportView: View {
    let dependencies: SupportDependencies
    let park: Park?
    @State private var model: FeedbackModel
    @State private var photos: [PhotosPickerItem] = []
    @State private var mail = false
    @State private var newReport = false
    init(dependencies: SupportDependencies, park: Park? = nil) {
        self.dependencies = dependencies
        self.park = park
        _model = State(initialValue: FeedbackModel(store: dependencies.store, service: dependencies.service))
    }
    var body: some View {
        Form {
            Section("Report") {
                Picker("Category", selection: $model.draft.category) {
                    Text("Bug").tag(FeedbackReport.Category.bug)
                    Text("Park correction / missing location").tag(FeedbackReport.Category.correction)
                    Text("Idea").tag(FeedbackReport.Category.idea)
                    Text("Support").tag(FeedbackReport.Category.support)
                }
                if model.draft.category == .correction {
                    TextField("Park ID (if known)", text: $model.draft.parkID)
                    TextField("Park / missing place / address", text: $model.draft.location)
                }
                TextEditor(text: $model.draft.message).frame(minHeight: 140).accessibilityLabel(
                    "Report details")
                Text("\(model.draft.message.utf16.count) / 2,000 characters").font(.caption).foregroundStyle(
                    .secondary)
                if dependencies.account.identity == nil {
                    TextField("Contact email (optional)", text: $model.draft.contactEmail).keyboardType(
                        .emailAddress
                    ).textInputAutocapitalization(.never)
                }
            }.disabled(!model.loaded || model.busy || model.draft.attempted)
            Section("Images") {
                PhotosPicker(
                    "Add images", selection: $photos,
                    maxSelectionCount: max(1, 3 - model.draft.attachments.count), matching: .images
                )
                .disabled(
                    !model.loaded || model.busy || model.draft.attempted || model.draft.attachments.count >= 3
                )
                ForEach(model.draft.attachments) { image in
                    HStack {
                        if let preview = UIImage(data: image.data) {
                            Image(uiImage: preview).resizable().scaledToFit().frame(width: 80, height: 60)
                        }
                        Text("\(image.data.count / 1000) KB").font(.caption)
                        Spacer()
                        Button("Remove", role: .destructive) {
                            model.draft.attachments.removeAll { $0.id == image.id }
                        }
                        .disabled(model.busy || model.draft.attempted)
                    }
                }
                Text("Up to 3 images; 1.5 MB each, 4 MB total. Image location metadata is removed.").font(
                    .footnote)
            }
            Section {
                if let status = model.status {
                    Text(status).font(.footnote).accessibilityIdentifier("feedback-status")
                }
                Button(model.draft.attempted ? "Retry filing report" : "File report") {
                    Task { await model.submit() }
                }
                .disabled(!model.loaded || model.busy || model.receipt != nil)
                Button("Send with Mail…") { mail = true }.disabled(model.draft.validationMessage != nil)
                if model.draft.attempted { Button("New report") { newReport = true } }
                Text(
                    "Mail is a separate, user-controlled send. Filing a report does not prove an email was sent."
                ).font(.caption).foregroundStyle(.secondary)
                if model.busy { ProgressView() }
            }
        }.navigationTitle("Help & feedback").navigationBarTitleDisplayMode(.inline)
            .task(id: dependencies.account.identity?.uid) {
                await model.load(uid: dependencies.account.identity?.uid, park: park)
            }
            .task(id: photos) {
                if !photos.isEmpty {
                    await model.add(photos)
                    photos = []
                }
            }
            .onChange(of: model.draft) { _, _ in model.changed() }
            .onDisappear { Task { await model.flush() } }
            .sheet(isPresented: $mail) { FeedbackMailView(report: model.draft) }
            .confirmationDialog(
                "Start a new report? The current saved draft will be replaced.", isPresented: $newReport
            ) {
                Button("New report") { Task { await model.newReport() } }
            }
    }
}
