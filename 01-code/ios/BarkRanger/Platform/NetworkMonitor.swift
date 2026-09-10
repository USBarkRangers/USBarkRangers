import Foundation
import Network

/// Path availability is only a retry hint; it never establishes catalog freshness.
@MainActor
final class NetworkMonitor {
    private var generation = UUID()
    private var monitor: NWPathMonitor?
    private var continuation: AsyncStream<Bool>.Continuation?
    private(set) var isConnected: Bool?

    func start() -> AsyncStream<Bool> {
        stop()
        let (stream, continuation) = AsyncStream<Bool>.makeStream(bufferingPolicy: .bufferingNewest(1))
        self.continuation = continuation
        let monitor = NWPathMonitor()
        let generation = UUID()
        self.generation = generation
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard self?.monitor != nil, self?.generation == generation else { return }
                self?.isConnected = connected
                self?.continuation?.yield(connected)
            }
        }
        self.monitor = monitor
        monitor.start(queue: DispatchQueue(label: "BarkCatalogConnectivity"))
        return stream
    }
    func stop() {
        monitor?.cancel()
        monitor = nil
        continuation?.finish()
        continuation = nil
    }
}
