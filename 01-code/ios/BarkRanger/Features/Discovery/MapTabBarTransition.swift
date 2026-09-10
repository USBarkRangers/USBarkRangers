import SwiftUI

/// Briskly hides/restores the native tab bar after the sheet crosses medium, without moving its layout frame.
struct MapTabBarTransition: UIViewControllerRepresentable {
    let hidesChrome: Bool
    let reduceMotion: Bool

    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.hidesChrome = hidesChrome
        controller.reduceMotion = reduceMotion
        controller.apply()
    }
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.restore()
    }

    final class Controller: UIViewController {
        var hidesChrome = false
        var reduceMotion = false
        private weak var bar: UITabBar?
        private(set) var isVisible = false

        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
        }
        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            apply()
        }
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            isVisible = true
            apply(animated: false)
        }
        override func viewWillDisappear(_ animated: Bool) {
            isVisible = false
            restore()
            super.viewWillDisappear(animated)
        }
        func apply(animated: Bool = true) {
            guard isVisible, viewIfLoaded?.window != nil, let tabBar = tabBarController?.tabBar else {
                return
            }
            bar = tabBar
            tabBar.isUserInteractionEnabled = !hidesChrome
            tabBar.accessibilityElementsHidden = hidesChrome
            let layer = tabBar.layer
            let target = CATransform3DMakeTranslation(
                0, hidesChrome && !reduceMotion ? tabBar.bounds.height + 32 : 0, 0)
            let opacity: Float = hidesChrome && reduceMotion ? 0 : 1
            guard !CATransform3DEqualToTransform(layer.sublayerTransform, target) || layer.opacity != opacity
            else { return }
            let current = layer.presentation() ?? layer
            let move = CABasicAnimation(keyPath: "sublayerTransform")
            move.fromValue = NSValue(caTransform3D: current.sublayerTransform)
            move.toValue = NSValue(caTransform3D: target)
            move.duration = ParkSheetLayout.chromeDuration
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = current.opacity
            fade.toValue = opacity
            fade.duration = ParkSheetLayout.chromeDuration
            // Only rendered contents move. UIKit retains the bar's resting frame and safe areas.
            layer.removeAnimation(forKey: "bark.chrome")
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.sublayerTransform = target
            tabBar.alpha = CGFloat(opacity)
            CATransaction.commit()
            guard animated else { return }
            let transition = CAAnimationGroup()
            transition.animations = reduceMotion ? [fade] : [move, fade]
            transition.duration = ParkSheetLayout.chromeDuration
            transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            // A reversal starts at the visible presentation, not the old destination. Layout passes
            // with the same destination return above, so holding the finger cannot restart the slide.
            layer.add(transition, forKey: "bark.chrome")
        }

        func restore() {
            bar?.layer.removeAnimation(forKey: "bark.chrome")
            bar?.layer.sublayerTransform = CATransform3DIdentity
            bar?.alpha = 1
            bar?.isUserInteractionEnabled = true
            bar?.accessibilityElementsHidden = false
            bar = nil
        }
    }
}
