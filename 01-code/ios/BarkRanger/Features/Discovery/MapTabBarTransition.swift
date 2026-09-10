import SwiftUI

/// Moves the existing native tab bar with the sheet, without changing safe areas mid-gesture.
struct MapTabBarTransition: UIViewControllerRepresentable {
    let progress: CGFloat
    let reduceMotion: Bool

    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.progress = progress
        controller.reduceMotion = reduceMotion
        controller.apply()
    }
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.restore()
    }

    final class Controller: UIViewController {
        var progress: CGFloat = 0
        var reduceMotion = false
        private weak var bar: UITabBar?
        private var isVisible = false

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
            apply()
        }
        override func viewWillDisappear(_ animated: Bool) {
            isVisible = false
            restore()
            super.viewWillDisappear(animated)
        }
        func apply() {
            guard isVisible, viewIfLoaded?.window != nil, let tabBar = tabBarController?.tabBar else {
                return
            }
            bar = tabBar
            let amount = min(1, max(0, progress))
            // Move rendered contents, not UIKit's layout frame. Transforming the bar itself lets
            // a later scroll/layout pass bake the offset into its resting position.
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            tabBar.layer.sublayerTransform = CATransform3DMakeTranslation(
                0, reduceMotion ? 0 : (tabBar.bounds.height + 32) * amount, 0)
            CATransaction.commit()
            tabBar.alpha = reduceMotion ? 1 - amount : 1
            tabBar.isUserInteractionEnabled = amount == 0
            tabBar.accessibilityElementsHidden = amount > 0
        }
        func restore() {
            bar?.layer.sublayerTransform = CATransform3DIdentity
            bar?.alpha = 1
            bar?.isUserInteractionEnabled = true
            bar?.accessibilityElementsHidden = false
            bar = nil
        }
    }
}
