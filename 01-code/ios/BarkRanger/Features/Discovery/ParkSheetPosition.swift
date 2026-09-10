import SwiftUI

enum ParkSheetPosition: Int, CaseIterable {
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
struct ParkSheetLayout {
    static let topInset: CGFloat = 8
    static let chromeDuration: TimeInterval = 0.22
    let availableHeight: CGFloat
    let bottomOverlap: CGFloat
    let searchHeight: CGFloat

    func height(at position: ParkSheetPosition) -> CGFloat {
        switch position {
        case .low: min(bottomOverlap + 142, availableHeight * 0.4)
        case .medium:
            min(440 + bottomOverlap, max(height(at: .low) + 50, availableHeight - searchHeight - 100))
        case .high: max(0, availableHeight - Self.topInset)
        }
    }
    func presentation(at height: CGFloat) -> ParkSheetPosition {
        if height > self.height(at: .medium) + 1 { return .high }
        return height > self.height(at: .low) + 1 ? .medium : .low
    }
    func hidesChrome(at height: CGFloat) -> Bool {
        // Cross a small threshold, then finish the short animation even if the finger pauses.
        height > self.height(at: .medium) + 8
    }
    func nearest(to height: CGFloat) -> ParkSheetPosition {
        ParkSheetPosition.allCases.min {
            abs(self.height(at: $0) - height) < abs(self.height(at: $1) - height)
        }
            ?? .low
    }
}
