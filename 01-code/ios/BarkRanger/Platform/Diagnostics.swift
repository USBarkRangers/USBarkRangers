import Foundation
import OSLog

/// Local logs accept fixed event names only: no URLs, account IDs or user text.
nonisolated struct Diagnostics: Sendable {
    enum Event: String {
        case enteredForeground, enteredBackground, unsupportedLink
    }

    enum Operation: String {
        case shellStartup, catalogLocalReady, catalogLoaderDismissed
    }

    private let logger = Logger(subsystem: "swarm.USBARKRANGERS", category: "Shell")
    private let enabled: Bool

    init(enabled: Bool = true) {
        self.enabled = enabled
    }

    func record(_ event: Event) {
        guard enabled else { return }
        logger.info("\(event.rawValue, privacy: .public)")
    }

    /// A monotonic, synchronous boundary; preserves the operation's return/error.
    func measure<Value>(_ operation: Operation, action: () throws -> Value) rethrows -> Value {
        let clock = ContinuousClock()
        let start = clock.now
        defer {
            if enabled {
                let elapsed = start.duration(to: clock.now)
                logger.info(
                    "\(operation.rawValue, privacy: .public) duration=\(String(describing: elapsed), privacy: .public)"
                )
            }
        }
        return try action()
    }
    func duration(_ operation: Operation, milliseconds: Double) {
        guard enabled else { return }
        logger.info("\(operation.rawValue, privacy: .public) milliseconds=\(milliseconds, privacy: .public)")
    }

}
