import ActivityKit
import SwiftUI
import WidgetKit

@main struct BarkRangerActivity: WidgetBundle {
    var body: some Widget { WalkLiveActivity() }
}

struct WalkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WalkActivityAttributes.self) { context in
            HStack(spacing: 16) {
                Image(systemName: "pawprint.fill").font(.title).foregroundStyle(.mint)
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.attributes.trailName).font(.headline).lineLimit(1)
                    Text(
                        context.isStale
                            ? "Reopen to check recording"
                            : context.state.paused ? "Walk paused" : "Recording your walk"
                    ).font(.caption)
                }
                Spacer()
                VStack(alignment: .trailing) {
                    distance(context.state)
                    elapsed(context.state, stale: context.isStale).font(.caption.monospacedDigit())
                }
            }
            .padding().activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .widgetURL(URL(string: "barkranger://walk"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "pawprint.fill").foregroundStyle(.mint)
                }
                DynamicIslandExpandedRegion(.trailing) { distance(context.state) }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(
                            context.isStale
                                ? "Check recording"
                                : context.state.paused ? "Paused" : context.attributes.trailName
                        ).lineLimit(1)
                        Spacer()
                        elapsed(context.state, stale: context.isStale)
                    }.font(.caption)
                }
            } compactLeading: {
                Image(systemName: context.state.paused ? "pause.fill" : "figure.walk").foregroundStyle(.mint)
            } compactTrailing: {
                Text(context.state.meters / 1609.344, format: .number.precision(.fractionLength(1)))
            } minimal: {
                Image(systemName: "pawprint.fill").foregroundStyle(.mint)
            }
            .widgetURL(URL(string: "barkranger://walk"))
        }
    }
    private func distance(_ state: WalkActivityAttributes.ContentState) -> some View {
        Text(
            Measurement(value: state.meters, unit: UnitLength.meters),
            format: .measurement(width: .abbreviated, usage: .road)
        )
        .font(.headline.monospacedDigit())
    }
    @ViewBuilder private func elapsed(_ state: WalkActivityAttributes.ContentState, stale: Bool) -> some View
    {
        if let start = state.activeSince, !stale {
            Text(start, style: .timer)
        } else {
            Text(Duration.seconds(state.elapsedSeconds).formatted(.time(pattern: .hourMinuteSecond)))
        }
    }
}
