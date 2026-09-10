import BarkDomain
import SwiftUI

/// A persistent text field keeps keyboard focus while the shared search result changes.
struct MapSearchBar: View {
    @Binding var text: String
    let focused: FocusState<Bool>.Binding
    let result: ParkFilter.Result
    let openFilters: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Image(systemName: "magnifyingglass").font(.system(size: 17))
                .padding(.leading, 16).accessibilityHidden(true)
            TextField("Search parks", text: $text)
                .font(.body)
                .focused(focused)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { focused.wrappedValue = false }
                .accessibilityIdentifier("park-search")
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 10).padding(.vertical, 14)
            if !text.isEmpty {
                Button {
                    text = ""
                    focused.wrappedValue = true
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 17))
                        .frame(width: 44, height: 48)
                }
                .accessibilityLabel("Clear search")
            }
            Text("\(result.matchingCount) / \(result.totalCount)")
                .font(.caption.monospacedDigit())
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .fixedSize().padding(.leading, 8)
                .accessibilityLabel("\(result.matchingCount) of \(result.totalCount) parks")
                .accessibilityIdentifier("park-count")
            Button(action: openFilters) {
                Image(systemName: "line.3.horizontal.decrease").font(.system(size: 17))
                    .frame(width: 52, height: 52)
            }
            .accessibilityLabel("Filters")
        }
        .foregroundStyle(Color.primary)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("park-search-bar")
    }
}
