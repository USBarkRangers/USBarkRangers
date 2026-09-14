import BarkDomain
import SwiftUI

struct SharingView: View {
    let account: AccountSession
    let catalog: CatalogRepository
    @State private var model = ExportModel()
    private var awards: [(id: String, name: String)] {
        let badges = (try? NativePassport.badges(progress: account.nativeVisits?.overview?.progress)) ?? []
        return badges.filter(\.earned).map { (id: $0.definition.id, name: $0.definition.name) }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                NavigationLink(destination: PhotoWatermarkView()) {
                    Label("Photo watermark", systemImage: "photo").font(.headline)
                }.barkSectionCard()
                if let visits = account.nativeVisits, account.identity != nil {
                    let name = account.profileState?.visible?.displayName ?? "Bark Ranger"
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Share your adventures").font(.headline)
                        Button("Passport card") {
                            model.passport(progress: visits.overview?.progress, name: name, catalog: catalog)
                        }
                        Button("Expedition card") {
                            let expedition = NativeExpeditionPresentation(overview: account.nativeExpeditions?.overview)
                            let completions = account.nativeExpeditions?.completedCount.map {
                                "\($0) trails completed"
                            } ?? "Trail completions not downloaded"
                            model.card(
                                title: "Virtual Expedition", name: expedition.name,
                                lines: [
                                    String(format: "%.1f miles explored", expedition.meters / 1609.344),
                                    completions, "US BARK Rangers",
                                ])
                        }
                        Menu("Achievement card") {
                            ForEach(awards, id: \.id) { award in
                                Button(award.name) {
                                    model.card(
                                        title: "Achievement unlocked", name: award.name,
                                        lines: [name, "US BARK Rangers"])
                                }
                            }
                        }.disabled(awards.isEmpty)
                        Button("Export visits CSV") { model.visits(repository: visits.repository, catalog: catalog) }
                    }.barkSectionCard().disabled(model.busy)
                }
                if model.busy { ProgressView("Preparing…") }
                if let error = model.error { Text(error).font(.footnote).foregroundStyle(.red) }
            }.padding(20)
        }.navigationTitle("Share & export").navigationBarTitleDisplayMode(.inline)
            .task(id: account.nativeExpeditions?.scope) {
                account.nativeExpeditions?.requestCompletedTrails()
            }
            .onChange(of: account.identity?.uid) { _, _ in model.clear() }
            .sheet(item: $model.file, onDismiss: model.clearFile) { file in FileShareView(url: file.url) }
            .onDisappear { if model.file == nil { model.clear() } }
    }
}

struct FileShareView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
