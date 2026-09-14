import BarkDomain
import SwiftUI

/// Matches the existing section cards and native navigation; no recording or persistence logic in the view.
struct ExpeditionView: View {
    @Environment(\.dynamicTypeSize) private var textSize
    @Bindable var model: ExpeditionModel
    var showMap: (([Coordinate]) -> Void)? = nil
    @State private var chooseTrail = false
    @State private var miles = ""
    @FocusState private var enteringMiles: Bool
    @State private var imports = false
    @State private var replacement: Trail?
    @State private var confirmReplacement = false
    @State private var requestedMapTrail: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    if textSize.isAccessibilitySize {
                        Text("Virtual expedition").font(.title2.bold())
                    } else {
                        Label("Virtual expedition", systemImage: "mountain.2").font(.title2.bold())
                    }
                    Text(model.expedition.name).font(.headline)
                    if model.expedition.trailID != nil {
                        ProgressView(value: model.expedition.fraction).tint(.accentColor)
                        Text(
                            "\(model.expedition.meters / 1609.344, specifier: "%.2f") / \(model.expedition.totalMeters / 1609.344, specifier: "%.1f") miles"
                        ).monospacedDigit()
                        NavigationLink("Trail & recorded path", destination: ExpeditionMapView(model: model))
                        if showMap != nil {
                            Button("Show trail on Map") { requestedMapTrail = model.expedition.trailID }
                        }
                        if model.expedition.fraction >= 1 {
                            Button("Complete expedition · +1 point", action: model.claim).disabled(
                                !model.canClaim)
                        }
                    }
                    let actions =
                        textSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout())
                    actions {
                        Button("Choose trail") { chooseTrail = true }
                        Button("Surprise me") { if let trail = model.suggestedTrail() { request(trail) } }
                    }.barkActionStyle().disabled(!model.canChooseTrail)
                    Text(
                        "Walk anywhere to advance your virtual trail. Mileage adds progress; completing a trail earns one point."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                }.barkSectionCard()
                WalkRecordingView(recorder: model.recorder)
                if model.expedition.trailID == nil, model.recorder.recording != nil {
                    NavigationLink("View recorded path") { ExpeditionMapView(model: model) }
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text("Log a walk").font(.headline)
                    HStack {
                        TextField("Miles", text: $miles).keyboardType(.decimalPad).textFieldStyle(
                            .roundedBorder
                        )
                        .focused($enteringMiles)
                        Button("Add miles") {
                            enteringMiles = false
                            model.logManual(miles: Double(miles) ?? 0)
                        }
                        .disabled(!model.canRecord)
                    }
                    if let notice = model.notice(for: .manualEntry) {
                        Text(notice).font(.footnote).accessibilityIdentifier("expedition-notice")
                    }
                    Text("Up to 15 miles per manual entry.").font(.caption).foregroundStyle(.secondary)
                    if model.selectionKnown {
                        Text(
                            "Lifetime: \(model.expedition.lifetimeMeters / 1609.344, specifier: "%.1f") miles"
                        ).font(.subheadline)
                    } else {
                        Text("Connect to download your current expedition before recording a walk.").font(
                            .footnote)
                    }
                    NavigationLink("Walk history") { WalkHistoryView(model: model) }
                    Button("Import from Apple Health") { imports = true }.disabled(
                        !model.canRecord || !model.health.available)
                }.barkSectionCard()
                if !model.account.dataAccess.canEditAccount {
                    Text(
                        "Your existing history remains available. Premium is required to record or change walks."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                }
                if let notice = model.notice(for: .expedition) {
                    Text(notice).font(.footnote).accessibilityIdentifier("expedition-notice")
                }
                if model.pendingCount > 0 {
                    Text(
                        "\(model.pendingCount) changes saved on this iPhone. Mileage and points above are confirmed account totals; pending walks appear in history."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                }
                if let message = model.account.nativeExpeditions?.sync?.message
                    ?? model.account.nativeExpeditions?.message
                {
                    Text(message).font(.footnote)
                }
                if let pending = model.conflicts.first {
                    ExpeditionConflictView(id: pending, model: model)
                }
            }.padding(20)
        }
        .navigationTitle("Expeditions").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $chooseTrail, onDismiss: { confirmReplacement = replacement != nil }) {
            NavigationStack {
                List(model.trails) { trail in
                    Button {
                        request(trail)
                    } label: {
                        VStack(alignment: .leading) {
                            Text(trail.name)
                            Text("\(trail.meters / 1609.344, specifier: "%.1f") miles").font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }.navigationTitle("Choose a trail")
                    .toolbar { Button("Done") { chooseTrail = false } }
            }
        }
        .confirmationDialog(
            "Start a new trail?",
            isPresented: Binding(
                get: { confirmReplacement },
                set: {
                    confirmReplacement = $0
                    if !$0 { replacement = nil }
                }),
            titleVisibility: .visible, presenting: replacement
        ) { trail in
            Button("Start new trail") {
                model.assign(trail)
                replacement = nil
            }
            Button("Cancel", role: .cancel) { replacement = nil }
        } message: { trail in
            Text("Start \(trail.name)? Your walk history is preserved; current trail progress resets.")
        }
        .task(id: requestedMapTrail) {
            guard let id = requestedMapTrail else { return }
            let uid = model.account.identity?.uid
            let trail = try? await model.geometry.geometry(id: id)
            guard !Task.isCancelled, uid == model.account.identity?.uid, id == model.expedition.trailID else {
                return
            }
            requestedMapTrail = nil
            if let trail { showMap?(trail) }
        }
        .sheet(isPresented: $imports) {
            NavigationStack {
                List {
                    Text(
                        "Choose a completed walking or hiking workout. Only its distance and time summary is added; overlapping workouts are rejected."
                    ).font(.footnote)
                    ForEach(model.workouts) { workout in
                        Button {
                            model.importWorkout(workout)
                            imports = false
                        } label: {
                            VStack(alignment: .leading) {
                                Text(workout.endedAt, style: .date)
                                Text("\(workout.meters / 1609.344, specifier: "%.2f") miles")
                            }
                        }
                    }
                    if model.busy { ProgressView() }
                    if let notice = model.notice(for: .expedition) { Text(notice) }
                }.navigationTitle("Apple Health").toolbar { Button("Done") { imports = false } }
                    .task { await model.loadWorkouts() }
            }
        }
    }
    private func request(_ trail: Trail) {
        let pickerWasOpen = chooseTrail
        chooseTrail = false
        if model.expedition.trailID != nil {
            replacement = trail
            if !pickerWasOpen { confirmReplacement = true }
        } else {
            model.assign(trail)
        }
    }
}
