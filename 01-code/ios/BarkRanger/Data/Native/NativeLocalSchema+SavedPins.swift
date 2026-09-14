import Foundation
import SwiftData

extension NativeLocalSchema {
    @Model final class SavedPin {
        #Index<SavedPin>([\.changeSequence])
        @Attribute(.unique) var id: String
        var revision: Int64
        var confirmed: Data?
        var changeSequence: Int64
        // Existing authored local text is retained, not uploaded with thin map metadata.
        var localNotes: String
        init(id: String, sequence: Int64, localNotes: String = "") {
            self.id = id
            revision = 0
            changeSequence = sequence
            self.localNotes = localNotes
        }
    }
    @Model final class SavedPinCursor {
        @Attribute(.unique) var key: String
        var request: Data
        init(request: Data) {
            key = "savedPins"
            self.request = request
        }
    }
}
