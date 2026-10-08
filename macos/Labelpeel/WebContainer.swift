import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// Hosts the bundled web app in a WKWebView, served from the app bundle over a
/// private labelpeel:// scheme (BundleSchemeHandler), with the IOBluetooth
/// printer bridge exposed as window.webkit.messageHandlers.labelpeel.
struct WebContainer: NSViewControllerRepresentable {
    func makeNSViewController(context: Context) -> WebViewController { WebViewController() }
    func updateNSViewController(_ vc: WebViewController, context: Context) {}
}

final class WebViewController: NSViewController, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var webView: WKWebView!
    private let bridge = PrinterBridge()
    private var downloads: [ObjectIdentifier: URL] = [:]

    override func loadView() {
        let config = WKWebViewConfiguration()
        let root = Bundle.main.url(forResource: "Web", withExtension: nil)
        config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "labelpeel")
        // Lets the page tell the Mac app from the iPad app (iPads also report a Mac platform).
        config.userContentController.addUserScript(WKUserScript(
            source: "window.__labelpeelPlatform = 'macos';" + Self.screenScript(NSScreen.main),
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820), configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            // Safari's Develop menu can inspect the app.
            webView.isInspectable = true
        }
        bridge.webView = webView
        view = webView

        if root == nil {
            webView.loadHTMLString(
                "<body style='font:15px -apple-system;color:#eee;background:#111827;padding:40px'>"
                    + "<h2>Web app missing</h2><p>Run <code>macos/build-web.sh</code>, then build again.</p></body>",
                baseURL: nil)
        } else {
            webView.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://app/index.html")!))
        }
    }

    // MARK: Screen size, for "actual size" zoom

    /// CSS pixels per real millimetre on a screen. WebKit's CSS pixels are the
    /// screen's points, and the display reports its physical size.
    static func pointsPerMm(_ screen: NSScreen?) -> Double? {
        guard let screen,
              let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
        else { return nil }
        let mm = CGDisplayScreenSize(id)
        // Some external displays and projectors don't report a usable size.
        guard mm.width > 50 else { return nil }
        return screen.frame.width / mm.width
    }

    static func screenScript(_ screen: NSScreen?) -> String {
        guard let ppm = pointsPerMm(screen) else { return "window.__labelpeelScreen = undefined;" }
        return "window.__labelpeelScreen = { pxPerMm: \(ppm) };"
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        // Moving the window to another display changes the scale.
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeScreenNotification, object: view.window, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.webView.evaluateJavaScript(Self.screenScript(self.view.window?.screen))
        }
    }

    // MARK: JavaScript dialogs (the web app uses confirm())

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // MARK: File inputs (Open, images, fonts, CSV)

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    // MARK: Navigation and downloads (saves and exports are <a download> links)

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if let url = action.request.url, let scheme = url.scheme,
           ![BundleSchemeHandler.scheme, "blob", "data", "about"].contains(scheme) {
            NSWorkspace.shared.open(url)
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
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename.isEmpty ? "label" : suggestedFilename
        panel.canCreateDirectories = true
        panel.begin { result in
            guard result == .OK, let url = panel.url else { return completionHandler(nil) }
            // WKDownload won't overwrite; the panel already confirmed replacing.
            try? FileManager.default.removeItem(at: url)
            self.downloads[ObjectIdentifier(download)] = url
            completionHandler(url)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}
