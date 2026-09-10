import SwiftUI

/// Fixed 4:3 media slots. Replace each slot's content with real images when a source is available.
struct ParkThumbnailStrip: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(0..<3) { _ in
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color(uiColor: .secondarySystemBackground))
                            .overlay {
                                Image(systemName: "photo").font(.title2)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(width: 144, height: 108)
                            .accessibilityHidden(true)
                    }
                }
            }
            Text("Park photos coming soon").font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("park-thumbnails")
    }
}
