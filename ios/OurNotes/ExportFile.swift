import UIKit
import WebKit

/// `webkit.messageHandlers.exportFile.postMessage({name, text})`: writes the text to a temporary file and opens the
/// share sheet for it (Save to Files, AirDrop…). A WKWebView can't save a page-made download by itself.
final class ExportFile: NSObject, WKScriptMessageHandler {
    weak var presenter: UIViewController?

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let body = m.body as? [String: Any], let name = body["name"] as? String, let text = body["text"] as? String,
              let presenter else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent((name as NSString).lastPathComponent)
        do { try Data(text.utf8).write(to: url, options: .atomic) } catch { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = presenter.view   // iPad
        sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        presenter.present(sheet, animated: true)
    }
}
