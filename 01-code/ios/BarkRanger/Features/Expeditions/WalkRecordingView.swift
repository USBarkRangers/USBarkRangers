import BarkDomain
import SwiftUI

/// Renders the app-owned recorder. Navigating away never stops a walk.
struct WalkRecordingView: View {
    @Bindable var recorder: WalkRecorder
    @State private var discard = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Walk tracker", systemImage: "figure.walk").font(.headline)
            if let recording = recorder.recording, recording.uid == recorder.account.identity?.uid {
                HStack {
                    Text("\(recording.meters / 1609.344, specifier: "%.2f") mi").font(.largeTitle.bold())
                        .monospacedDigit()
                    Spacer()
                    Text(
                        Duration.seconds(recording.elapsedSeconds).formatted(
                            .time(pattern: .hourMinuteSecond))
                    )
                    .font(.title3.monospacedDigit())
                }
                Text(recorder.status).font(.footnote).foregroundStyle(.secondary)
                HStack {
                    if recording.phase == .recording {
                        Button("Pause") { Task { await recorder.pause() } }
                    } else if recording.phase != .finishing {
                        Button("Resume") { Task { await recorder.resume() } }
                    }
                    Button(recording.phase == .finishing ? "Retry saving walk" : "Finish walk") {
                        Task { await recorder.finish() }
                    }
                    Menu {
                        Button("Discard walk", role: .destructive) { discard = true }
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
                    }
                }.barkActionStyle().disabled(recorder.busy)
            } else {
                Text(
                    "Record a walk with the screen locked or while using another app. The GPS path stays on this iPhone; only the finished summary syncs."
                )
                .font(.footnote).foregroundStyle(.secondary)
                Button("Start GPS walk") { Task { await recorder.start(source: .gps) } }
                    .barkActionStyle(prominent: true).disabled(!recorder.canStart)
                if recorder.motionAvailable {
                    Button("Use motion distance") { Task { await recorder.start(source: .pedometer) } }
                        .disabled(!recorder.canStart)
                }
            }
            if recorder.busy { ProgressView() }
            if let error = recorder.error { Text(error).font(.footnote).foregroundStyle(.red) }
        }.barkSectionCard()
            .confirmationDialog("Discard this recorded walk?", isPresented: $discard) {
                Button("Discard walk", role: .destructive) { Task { await recorder.discard() } }
            } message: {
                Text("This removes the unsaved recording from this iPhone.")
            }
    }
}
