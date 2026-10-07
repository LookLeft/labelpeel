import SwiftUI
import UIKit
import WebKit

/// Hosts the bundled web app in a WKWebView, served from the app bundle over
/// a private labelsmith:// scheme so ES modules and fetch() behave as on a web
/// server, with the printer bridge exposed as window.webkit.messageHandlers.labelsmith.
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ vc: WebViewController, context: Context) {}
}

final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var webView: WKWebView!
    private let bridge = PrinterBridge()
    private var downloads: [ObjectIdentifier: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        let background = UIColor(red: 0x11 / 255, green: 0x18 / 255, blue: 0x27 / 255, alpha: 1)
        view.backgroundColor = background

        let config = WKWebViewConfiguration()
        let root = Bundle.main.url(forResource: "Web", withExtension: nil)
        config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "labelsmith")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) {
            // Lets Safari's Develop menu on the Mac inspect the app.
            webView.isInspectable = true
        }
        bridge.webView = webView

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
        ])

        if root == nil {
            webView.loadHTMLString(
                "<body style='font:17px -apple-system;color:#eee;background:#111827;padding:40px'>"
                    + "<h2>Web app missing</h2><p>Run <code>ios/build-web.sh</code> on your Mac, then build again.</p></body>",
                baseURL: nil)
        } else {
            webView.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://app/index.html")!))
        }
    }

    // MARK: JavaScript dialogs (the web app uses confirm())

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    // MARK: Navigation and downloads (exports are <a download> links; hand them to the share sheet)

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if let url = action.request.url, let scheme = url.scheme,
           ![BundleSchemeHandler.scheme, "blob", "data", "about"].contains(scheme) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(suggestedFilename.isEmpty ? "label" : suggestedFilename)
        downloads[ObjectIdentifier(download)] = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}

/// Serves files from the bundled Web folder.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "labelsmith"
    private let root: URL?

    init(root: URL?) {
        self.root = root?.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        var status = 404
        var data = Data()
        var type = "text/plain"
        if let root {
            let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            if file.path.hasPrefix(root.path + "/"), let contents = try? Data(contentsOf: file) {
                status = 200
                data = contents
                type = Self.mimeType(file.pathExtension)
            }
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}
