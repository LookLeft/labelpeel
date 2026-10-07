import ExternalAccessory
import Foundation
import WebKit

/// The "labelsmith" script message handler. iOS gives apps Bluetooth Classic
/// printers only through the External Accessory framework, so this opens an
/// EASession on Brother's command protocol and moves raw bytes for the web
/// app, which builds the same raster jobs it sends over Web Serial.
///
/// Messages from JS: {op: "connect"} → {name}, {op: "write", data: base64},
/// {op: "read", timeoutMs} → base64, {op: "close"}. All run on the main thread.
final class PrinterBridge: NSObject, WKScriptMessageHandlerWithReply, StreamDelegate {
    static let protocolString = "com.brother.ptcbp"

    weak var webView: WKWebView?

    private var session: EASession?
    private var accessory: EAAccessory?

    private var outBuffer = Data()
    private var outOffset = 0
    private var queued = 0
    private var written = 0
    private var pendingWrites: [(end: Int, reply: (Any?, String?) -> Void)] = []
    private var inBuffer = Data()

    override init() {
        super.init()
        EAAccessoryManager.shared().registerForLocalNotifications()
        NotificationCenter.default.addObserver(
            self, selector: #selector(accessoryDidDisconnect(_:)),
            name: .EAAccessoryDidDisconnect, object: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "Bad message")
            return
        }
        switch op {
        case "connect":
            connect(replyHandler)
        case "write":
            guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else {
                replyHandler(nil, "Bad data")
                return
            }
            write(data, replyHandler)
        case "read":
            let timeout = (body["timeoutMs"] as? NSNumber)?.doubleValue ?? 1000
            read(deadline: Date().addingTimeInterval(timeout / 1000), replyHandler)
        case "close":
            close()
            replyHandler(true, nil)
        default:
            replyHandler(nil, "Unknown op \(op)")
        }
    }

    // MARK: Connect

    private func findAccessory() -> EAAccessory? {
        EAAccessoryManager.shared().connectedAccessories.first { $0.protocolStrings.contains(Self.protocolString) }
    }

    private func connect(_ reply: @escaping (Any?, String?) -> Void) {
        close()
        if let acc = findAccessory() {
            open(acc, reply)
            return
        }
        // Not paired or not awake: show iOS's pairing sheet, then wait for the
        // accessory to appear.
        EAAccessoryManager.shared().showBluetoothAccessoryPicker(withNameFilter: nil) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error = error as? EABluetoothAccessoryPickerError, error.code == .resultCancelled {
                    reply(nil, "No printer selected.")
                    return
                }
                self.waitForAccessory(until: Date().addingTimeInterval(8), reply)
            }
        }
    }

    private func waitForAccessory(until deadline: Date, _ reply: @escaping (Any?, String?) -> Void) {
        if let acc = findAccessory() {
            open(acc, reply)
        } else if Date() >= deadline {
            reply(nil, "No Brother printer found. Turn the printer on, make sure it isn't connected to another phone or app, and pair it in Settings > Bluetooth if it isn't listed.")
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.waitForAccessory(until: deadline, reply)
            }
        }
    }

    private func open(_ acc: EAAccessory, _ reply: @escaping (Any?, String?) -> Void) {
        guard let s = EASession(accessory: acc, forProtocol: Self.protocolString),
              let input = s.inputStream, let output = s.outputStream
        else {
            reply(nil, "Could not open a session with \(acc.name). Close other apps using the printer and try again.")
            return
        }
        for stream in [input, output] as [Stream] {
            stream.delegate = self
            stream.schedule(in: .main, forMode: .default)
            stream.open()
        }
        session = s
        accessory = acc
        let name = acc.name.isEmpty ? acc.modelNumber : acc.name
        reply(["name": name.isEmpty ? "Brother printer" : name], nil)
    }

    // MARK: Write

    private func write(_ data: Data, _ reply: @escaping (Any?, String?) -> Void) {
        guard session != nil else {
            reply(nil, "Printer not connected.")
            return
        }
        outBuffer.append(data)
        queued += data.count
        pendingWrites.append((queued, reply))
        flush()
    }

    private func flush() {
        guard let output = session?.outputStream else { return }
        while output.hasSpaceAvailable && outOffset < outBuffer.count {
            let n = outBuffer.withUnsafeBytes { raw -> Int in
                let base = raw.bindMemory(to: UInt8.self).baseAddress! + outOffset
                return output.write(base, maxLength: min(1024, outBuffer.count - outOffset))
            }
            if n <= 0 { break }
            outOffset += n
            written += n
        }
        if outOffset >= outBuffer.count {
            outBuffer.removeAll(keepingCapacity: true)
            outOffset = 0
        }
        while let first = pendingWrites.first, first.end <= written {
            pendingWrites.removeFirst()
            first.reply(true, nil)
        }
    }

    // MARK: Read

    private func read(deadline: Date, _ reply: @escaping (Any?, String?) -> Void) {
        if inBuffer.count >= 32 || Date() >= deadline || session == nil {
            let out = inBuffer
            inBuffer.removeAll()
            reply(out.base64EncodedString(), nil)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025) { [weak self] in
            self?.read(deadline: deadline, reply)
        }
    }

    // MARK: Streams

    func stream(_ stream: Stream, handle event: Stream.Event) {
        switch event {
        case .hasBytesAvailable:
            guard let input = stream as? InputStream else { return }
            var buf = [UInt8](repeating: 0, count: 1024)
            while input.hasBytesAvailable {
                let n = input.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                inBuffer.append(buf, count: n)
            }
        case .hasSpaceAvailable:
            flush()
        case .errorOccurred, .endEncountered:
            close()
            notifyDisconnect()
        default:
            break
        }
    }

    // MARK: Close

    func close() {
        guard let s = session else { return }
        for stream in [s.inputStream, s.outputStream].compactMap({ $0 }) as [Stream] {
            stream.close()
            stream.remove(from: .main, forMode: .default)
            stream.delegate = nil
        }
        session = nil
        accessory = nil
        outBuffer.removeAll()
        outOffset = 0
        queued = 0
        written = 0
        inBuffer.removeAll()
        let failed = pendingWrites
        pendingWrites.removeAll()
        failed.forEach { $0.reply(nil, "Printer disconnected.") }
    }

    @objc private func accessoryDidDisconnect(_ note: Notification) {
        guard let gone = note.userInfo?[EAAccessoryKey] as? EAAccessory,
              let acc = accessory, gone.connectionID == acc.connectionID
        else { return }
        close()
        notifyDisconnect()
    }

    private func notifyDisconnect() {
        webView?.evaluateJavaScript("window.__labelsmithNativeDisconnect && window.__labelsmithNativeDisconnect()")
    }
}
