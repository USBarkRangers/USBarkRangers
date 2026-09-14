import BarkDomain
import SwiftUI

struct ParkShareView: View {
    let park: Park
    @State private var model = ExportModel()
    private var url: URL? {
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [
            URLQueryItem(name: "q", value: park.name),
            URLQueryItem(name: "ll", value: "\(park.coordinate.latitude),\(park.coordinate.longitude)"),
        ]
        return components?.url
    }
    var body: some View {
        if let url {
            HStack {
                ShareLink(item: url, subject: Text(park.name)) {
                    Label("Share park", systemImage: "square.and.arrow.up")
                }
                Button("Park QR code") { model.qr(url) }.disabled(model.busy)
            }.barkActionStyle()
                .sheet(item: $model.file, onDismiss: model.clearFile) { file in
                    FileShareView(url: file.url)
                }
                .onDisappear { if model.file == nil { model.clear() } }
            if let error = model.error { Text(error).font(.footnote) }
        }
    }
}
