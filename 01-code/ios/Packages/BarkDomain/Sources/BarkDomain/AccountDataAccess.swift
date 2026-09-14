import Foundation

/// Editing permission derived from confirmed access, never a second entitlement or stored flag.
/// Guest planning is device-only. Signing in makes that same data subject to account permissions.
public struct AccountDataAccess: Equatable, Sendable {
    public let canEditAccount: Bool
    public let canEditDrafts: Bool
    public static let readOnlyMessage = "Your saved data is available to view. Premium is required to edit."

    public init(entitlement: Entitlement?, isGuest: Bool = false) {
        canEditAccount = !isGuest && entitlement?.premium == true
        canEditDrafts = isGuest || canEditAccount
    }
}
