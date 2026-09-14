import BarkDomain
import MessageUI
import SwiftUI

struct FeedbackMailView: View {
    let report: FeedbackReport
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        if MFMailComposeViewController.canSendMail() {
            Composer(report: report, done: { dismiss() })
        } else {
            NavigationStack {
                Form {
                    Text(
                        "Mail is not configured on this device. Copy the report below and email support@usbarkrangersmap.com."
                    )
                    Text(report.mailBody).textSelection(.enabled)
                    ShareLink(item: report.mailBody) {
                        Label("Share report text", systemImage: "square.and.arrow.up")
                    }
                    Text("Attachments remain in your saved draft.").font(.footnote)
                }.navigationTitle("Email report").toolbar { Button("Done") { dismiss() } }
            }
        }
    }
    private struct Composer: UIViewControllerRepresentable {
        let report: FeedbackReport
        let done: () -> Void
        func makeCoordinator() -> Coordinator { Coordinator(done: done) }
        func makeUIViewController(context: Context) -> MFMailComposeViewController {
            let controller = MFMailComposeViewController()
            controller.mailComposeDelegate = context.coordinator
            controller.setToRecipients(["support@usbarkrangersmap.com"])
            controller.setSubject("Bark Ranger \(report.category.rawValue) · \(report.id)")
            controller.setMessageBody(report.mailBody, isHTML: false)
            for (index, image) in report.attachments.enumerated() {
                controller.addAttachmentData(
                    image.data, mimeType: "image/jpeg", fileName: "image-\(index + 1).jpg")
            }
            return controller
        }
        func updateUIViewController(_ controller: MFMailComposeViewController, context: Context) {}
        final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
            let done: () -> Void
            init(done: @escaping () -> Void) { self.done = done }
            func mailComposeController(
                _ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult,
                error: (any Error)?
            ) { done() }
        }
    }
}
