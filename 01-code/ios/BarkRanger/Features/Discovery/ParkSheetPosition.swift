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
    let availableHeight: CGFloat
    let bottomOverlap: CGFloat
    let searchHeight: CGFloat

    func height(at position: ParkSheetPosition) -> CGFloat {
        switch position {
        case .low: min(bottomOverlap + 142, availableHeight * 0.4)
        case .medium:
            min(440 + bottomOverlap, max(height(at: .low) + 50, availableHeight - searchHeight - 100))
        case .high: availableHeight
        }
    }
    func nearest(to height: CGFloat) -> ParkSheetPosition {
        ParkSheetPosition.allCases.min {
            abs(self.height(at: $0) - height) < abs(self.height(at: $1) - height)
        }
            ?? .low
    }
}
