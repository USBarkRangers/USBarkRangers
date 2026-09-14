import BarkDomain
import UIKit

/// One native conversion shared by route renderers, park rings and the day-color picker.
extension TripDayColor {
    nonisolated var uiColor: UIColor {
        UIColor(
            red: Double((rgb >> 16) & 255) / 255,
            green: Double((rgb >> 8) & 255) / 255,
            blue: Double(rgb & 255) / 255, alpha: 1)
    }
}
