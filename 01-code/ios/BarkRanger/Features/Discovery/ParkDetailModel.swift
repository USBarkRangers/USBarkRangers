import BarkDomain
import Foundation
import Observation

/// One selected park or external place. Directions use that same selection; visit intents require a real park.
@MainActor @Observable
final class ParkDetailModel {
    enum Selection: Equatable {
        case park(Park)
        case place(Trip.Stop, subtitle: String)
        var id: String {
            switch self {
            case .park(let park): "park:" + park.id.rawValue
            case .place(let stop, _): "place:" + stop.id
            }
        }
        var stop: Trip.Stop {
            switch self {
            case .park(let park): Trip.Stop(park: park)
            case .place(let stop, _): stop
            }
        }
        var name: String { stop.name }
    }
    private(set) var selection: Selection?
    var park: Park? { if case .park(let park) = selection { park } else { nil } }
    var place: Trip.Stop? { if case .place(let stop, _) = selection { stop } else { nil } }
    var subtitle: String? { if case .place(_, let subtitle) = selection { subtitle } else { nil } }
    private(set) var isOpeningMaps = false
    var message: String?
    private let maps: MapsHandoff
    private let account: AccountSession?
    private let catalog: CatalogRepository?
    private let location: LocationClient?
    private var adventureTask: Task<Void, Never>?
    private var adventureID = UUID()
    var isSavingVisit: Bool { adventureTask != nil }
    var visitScope: String? { account?.nativeVisits?.scope }
    var supportsAdventures: Bool { canEditTrips || canEditVisits }
    var canEditTrips: Bool { account?.dataAccess.canEditDrafts == true }
    var canEditVisits: Bool { account?.dataAccess.canEditAccount == true }
    private let visitedIDs: () -> Set<ParkID>
    var isVisited: Bool {
        guard let park else { return false }
        let ids = visitedIDs()
        return ids.contains(park.id) || park.aliases.contains { ids.contains($0) }
    }
    @ObservationIgnored private(set) var navigation: Task<Void, Never>?
    init(
        maps: MapsHandoff, account: AccountSession? = nil, catalog: CatalogRepository? = nil,
        location: LocationClient? = nil, visitedIDs: @escaping () -> Set<ParkID> = { [] }
    ) {
        self.maps = maps
        self.visitedIDs = visitedIDs
        self.account = account
        self.catalog = catalog
        self.location = location
    }
    /// Selection already has validated catalog data; publish its identity and actions together.
    func show(_ park: Park?) {
        select(park.map(Selection.park))
    }
    func showPlace(_ stop: Trip.Stop, subtitle: String = "") { select(.place(stop, subtitle: subtitle)) }
    private func select(_ value: Selection?) {
        guard selection != value else { return }
        cancelActions()
        selection = value
        message = nil
    }
    /// Capture the displayed park synchronously, before scheduling the platform handoff.
    func navigate() {
        guard let stop = selection?.stop, navigation == nil else { return }
        isOpeningMaps = true
        message = nil
        navigation = Task {
            guard !Task.isCancelled else { return }
            let opened = await maps.openStop(stop)
            guard !Task.isCancelled else { return }
            isOpeningMaps = false
            navigation = nil
            if !opened { message = "Apple Maps could not be opened. Please try again." }
        }
    }
    func cancelNavigation() {
        navigation?.cancel()
        navigation = nil
        isOpeningMaps = false
    }
    func cancelActions() {
        cancelNavigation()
        adventureID = UUID()
        adventureTask?.cancel()
        adventureTask = nil
    }
    func markVisit(usingLocation: Bool) {
        guard canEditVisits else {
            message = AccountDataAccess.readOnlyMessage
            return
        }
        guard let park, let repository = account?.nativeVisits?.repository else {
            message = "Sign in to record your park visits."
            return
        }
        performAdventure {
            if usingLocation {
                guard let location = self.location else { throw LocationClient.Failure.unavailable }
                let fix = try await location.observedFix()
                try Task.checkCancellation()
                try await repository.mark(park: park, fix: fix)
            } else {
                try Task.checkCancellation()
                try await repository.mark(park: park)
            }
            return "Visit saved on this iPhone. Cloud confirmation appears in Passport."
        }
    }
    func reviewVisitRemoval() async -> NativeVisitWorkingState? {
        guard let park, let repository = account?.nativeVisits?.repository else { return nil }
        let scope = account?.nativeVisits?.scope
        do {
            let value = try await repository.workingState(park: park)
            guard !Task.isCancelled, account?.nativeVisits?.scope == scope, self.park?.id == park.id,
                value.visitID != nil
            else { return nil }
            return value
        } catch {
            if !Task.isCancelled, account?.nativeVisits?.scope == scope, self.park?.id == park.id {
                message = "This visit could not be reviewed. Your saved history is retained."
            }
            return nil
        }
    }
    func removeVisit(_ selected: NativeVisitWorkingState) {
        guard canEditVisits else {
            message = AccountDataAccess.readOnlyMessage
            return
        }
        guard let park, park.siteID.rawValue == selected.siteID,
            let repository = account?.nativeVisits?.repository
        else { return }
        performAdventure {
            try await repository.remove([selected])
            return "Visit removal saved on this iPhone."
        }
    }
    private func performAdventure(_ work: @escaping @MainActor () async throws -> String) {
        guard adventureTask == nil else { return }
        let id = UUID()
        let parkID = park?.id
        let uid = account?.identity?.uid
        adventureID = id
        message = nil
        adventureTask = Task {
            do {
                try Task.checkCancellation()
                guard account?.identity?.uid == uid, self.park?.id == parkID else {
                    throw AccountFailure.accountChanged
                }
                let result = try await work()
                if !Task.isCancelled, account?.identity?.uid == uid, self.park?.id == parkID {
                    message = result
                }
            } catch {
                if !Task.isCancelled, account?.identity?.uid == uid, self.park?.id == parkID {
                    message = Self.adventureMessage(error)
                }
            }
            if adventureID == id { adventureTask = nil }
        }
    }
    static func adventureMessage(_ error: any Error) -> String {
        switch error {
        case NativeStore.Failure.unavailable: AccountDataAccess.readOnlyMessage
        case VisitPolicy.Failure.outOfRange:
            "You need to be within 25 km of this park for a proximity check-in. You can record a manual visit."
        case VisitPolicy.Failure.poorLocation:
            "A recent, accurate location was not available. Try again or record a manual visit."
        case LocationClient.Failure.denied:
            "Location permission is off. You can enable it in iPhone Settings or record a manual visit."
        case NativeStore.Failure.invalidAcknowledgment:
            "This change could not be saved. The park may already be in your trip, or the saved record changed."
        case TripDayEdit.Failure.duplicateStop:
            "This park is already in your trip. Open Trips to review its day."
        default:
            "The change could not be saved. Check your connection, account access and available storage, then try again."
        }
    }
}
