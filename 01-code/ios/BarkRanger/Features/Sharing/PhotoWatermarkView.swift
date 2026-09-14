import BarkDomain
import PhotosUI
import SwiftUI

/// Owns this local photo-editing session. Passport and Share & export only navigate here.
struct PhotoWatermarkView: View {
    @State private var model = ExportModel()
    @State private var photo: PhotosPickerItem?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PhotosPicker("Choose photo", selection: $photo, matching: .images)
                    .barkActionStyle().disabled(model.busy)
                if let image = model.photo, let logo = model.logo {
                    WatermarkPreview(image: image, logo: logo, placement: $model.placement)
                    Slider(value: $model.placement.width, in: 0.10...0.45) { Text("Watermark size") }
                        .accessibilityIdentifier("watermark-size")
                    Menu("Position watermark") {
                        Picker("Corner", selection: $model.placement.corner) {
                            ForEach(WatermarkPlacement.Corner.allCases, id: \.self) { corner in
                                Text(corner.rawValue).tag(corner)
                            }
                        }
                    }
                    Text("Drag the logo toward a corner. Release to snap it into place.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Share photo", action: model.exportPhoto).barkActionStyle().disabled(model.busy)
                }
                if model.busy { ProgressView("Preparing…") }
                if let error = model.error { Text(error).font(.footnote).foregroundStyle(.red) }
            }.barkSectionCard().padding(20)
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Photo watermark").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task(id: photo) { if let photo { await model.select(photo) } }
        .sheet(item: $model.file, onDismiss: model.clearFile) { file in FileShareView(url: file.url) }
        .onDisappear { if model.file == nil { model.clear() } }
    }
}

/// Only the held logo moves freely. The committed placement always remains one of four corners.
private struct WatermarkPreview: View {
    let image: UIImage
    let logo: UIImage
    @Binding var placement: WatermarkPlacement
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var translation: CGSize?
    private var snap: Animation? { reduceMotion ? nil : .easeOut(duration: 0.14) }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let frame = placement.frame(in: size, markAspect: logo.size.width / logo.size.height)
            let offset = translation ?? .zero
            let center = CGPoint(
                x: min(size.width - frame.width / 2, max(frame.width / 2, frame.midX + offset.width)),
                y: min(size.height - frame.height / 2, max(frame.height / 2, frame.midY + offset.height)))
            ZStack(alignment: .topLeading) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fit)
                    .accessibilityIdentifier("watermark-preview")
                if translation != nil {
                    let target = targetFrame(at: center, in: size)
                    Image(uiImage: logo).resizable().aspectRatio(contentMode: .fit)
                        .frame(width: target.width, height: target.height)
                        .position(x: target.midX, y: target.midY).opacity(0.35)
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
                Image(uiImage: logo).resizable().aspectRatio(contentMode: .fit)
                    .frame(width: frame.width, height: frame.height)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 3, coordinateSpace: .named("watermark-photo"))
                            .updating($translation) { gesture, value, _ in value = gesture.translation }
                            .onEnded { gesture in
                                placement.corner = .nearest(
                                    x: (frame.midX + gesture.translation.width) / size.width,
                                    y: (frame.midY + gesture.translation.height) / size.height)
                            }
                    )
                    .accessibilityLabel("Watermark logo")
                    .accessibilityValue(placement.corner.rawValue)
                    .accessibilityIdentifier("watermark-logo")
                    .position(center)
            }
            .coordinateSpace(name: "watermark-photo")
            .animation(snap, value: translation == nil)
            .animation(snap, value: placement.corner)
        }
        .aspectRatio(image.size.width / image.size.height, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func targetFrame(at point: CGPoint, in size: CGSize) -> CGRect {
        var target = placement
        target.corner = .nearest(x: point.x / size.width, y: point.y / size.height)
        return target.frame(in: size, markAspect: logo.size.width / logo.size.height)
    }
}
