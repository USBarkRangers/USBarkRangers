import SwiftUI

enum MapSheetPosition: Int, CaseIterable {
    case low, medium, high
    var label: String {
        switch self {
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        }
    }
}

/// Sheet geometry is local presentation state, independent of catalog and camera persistence.
struct MapSheetLayout {
    static let topInset: CGFloat = 8
    static let chromeDuration: TimeInterval = 0.22
    let availableHeight: CGFloat
    let bottomOverlap: CGFloat
    let searchHeight: CGFloat

    func height(at position: MapSheetPosition) -> CGFloat {
        switch position {
        case .low: min(bottomOverlap + 142, availableHeight * 0.4)
        case .medium:
            min(440 + bottomOverlap, max(height(at: .low) + 50, availableHeight - searchHeight - 100))
        case .high: max(0, availableHeight - Self.topInset)
        }
    }
    func presentation(at height: CGFloat) -> MapSheetPosition {
        if height > self.height(at: .medium) + 1 { return .high }
        return height > self.height(at: .low) + 1 ? .medium : .low
    }
    func expansion(at height: CGFloat) -> CGFloat {
        let low = self.height(at: .low)
        return min(1, max(0, (height - low) / max(1, self.height(at: .medium) - low)))
    }
    func detailExpansion(at height: CGFloat) -> CGFloat {
        let medium = self.height(at: .medium)
        return min(1, max(0, (height - medium) / max(1, self.height(at: .high) - medium)))
    }
    func hidesChrome(at height: CGFloat) -> Bool {
        // Cross a small threshold, then finish the short animation even if the finger pauses.
        height > self.height(at: .medium) + 8
    }
    func nearest(to height: CGFloat) -> MapSheetPosition {
        MapSheetPosition.allCases.min {
            abs(self.height(at: $0) - height) < abs(self.height(at: $1) - height)
        }
            ?? .low
    }
}
