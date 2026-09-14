import BarkDomain
import Foundation

/// A destination intent, never an editable trip. Root delivers it; Map's edit owner consumes it.
struct StopSearchRequest: Equatable {
    let id = UUID()
    let scope: String
    let tripID: String
    let destination: TripStopPolicy.Destination
    var after: String? = nil
}
