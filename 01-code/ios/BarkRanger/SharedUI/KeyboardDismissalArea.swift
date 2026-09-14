import SwiftUI
import UIKit

/// Dismiss on empty form space without stealing taps from text inputs or buttons.
/// The recognizer is restricted to this view's bounds and removed with the screen.
struct KeyboardDismissalArea: UIViewRepresentable {
    func makeUIView(context: Context) -> Area { Area() }
    func updateUIView(_ view: Area, context: Context) {}

    static func dismantleUIView(_ view: Area, coordinator: ()) { view.detach() }

    final class Area: UIView, UIGestureRecognizerDelegate {
        private weak var attachedWindow: UIWindow?
        private lazy var tap: UITapGestureRecognizer = {
            let value = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
            value.cancelsTouchesInView = false
            value.delegate = self
            return value
        }()

        override func didMoveToWindow() {
            super.didMoveToWindow()
            detach()
            attachedWindow = window
            window?.addGestureRecognizer(tap)
            isUserInteractionEnabled = false
        }
        func detach() {
            attachedWindow?.removeGestureRecognizer(tap)
            attachedWindow = nil
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool
        {
            guard window != nil, bounds.contains(touch.location(in: self)) else { return false }
            var target = touch.view
            while let view = target {
                if view is UIControl || view is any UITextInput { return false }
                target = view.superview
            }
            return true
        }
        @objc private func dismissKeyboard() { window?.endEditing(true) }
    }
}
