import SwiftUI

/// The sheet owns safe areas and clipping. A stop's hosted content must not shrink or move to
/// avoid the screen edge as its cell scrolls past it. UIKit still owns cell reuse and drag/drop.
final class RouteStopCell: UITableViewCell {
    private let host = UIHostingController(rootView: AnyView(EmptyView()))

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        host.safeAreaRegions = []
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: contentView.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])
    }
    required init?(coder: NSCoder) { nil }

    func setContent(_ content: AnyView) {
        host.rootView = AnyView(content.padding(.vertical, 6))
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            host.willMove(toParent: nil)
            host.removeFromParent()
            return
        }
        guard host.parent == nil else { return }
        var responder = next
        while let current = responder {
            if let parent = current as? UIViewController {
                parent.addChild(host)
                host.didMove(toParent: parent)
                break
            }
            responder = current.next
        }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        host.rootView = AnyView(EmptyView())
    }
}
