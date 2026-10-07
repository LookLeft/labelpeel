import AppKit
import Foundation
import IOBluetooth
import WebKit

/// The "labelsmith" script message handler on macOS. Unlike a browser, which
/// can only open the cu.* serial port macOS keeps for every paired device
/// (even when it's off), this opens an RFCOMM channel straight to the paired
/// printer with IOBluetooth, so connecting fails if the printer isn't there.
///
/// It also prints over USB (UsbPrinter), which a WebKit page can't do itself.
///
/// Messages match the iOS app: {op: "connect", kind: "bluetooth" | "usb"} →
/// {name, productId?}, {op: "write", data: base64}, {op: "read", timeoutMs} →
/// base64, {op: "close"}. All run on the main thread; Bluetooth and USB calls
/// are asynchronous so the window never blocks.
final class PrinterBridge: NSObject, WKScriptMessageHandlerWithReply, IOBluetoothRFCOMMChannelDelegate {
    /// Serial Port Profile, which Brother's Bluetooth Classic printers use.
    private static let serialPort = IOBluetoothSDPUUID(uuid16: 0x1101)

    weak var webView: WKWebView?

    private var device: IOBluetoothDevice?
    private var channel: IOBluetoothRFCOMMChannel?
    private var connectReply: ((Any?, String?) -> Void)?
    private var connectTimeout: DispatchWorkItem?
    private var inBuffer = Data()
    private var usb: UsbPrinter?

    // Outgoing data is written one MTU-sized chunk at a time.
    private var outQueue: [(data: Data, reply: ((Any?, String?) -> Void)?)] = []
    private var writing: UnsafeMutableRawPointer?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "Bad message")
            return
        }
        switch op {
        case "connect":
            if body["kind"] as? String == "usb" { connectUsb(replyHandler) } else { connect(replyHandler) }
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

    // MARK: Connect (USB)

    private func connectUsb(_ reply: @escaping (Any?, String?) -> Void) {
        close()
        do {
            let printer = try UsbPrinter()
            printer.onData = { [weak self] in self?.inBuffer.append($0) }
            printer.onDisconnect = { [weak self] in
                self?.usb = nil
                self?.notifyDisconnect()
            }
            usb = printer
            var info: [String: Any] = ["name": printer.name]
            if let pid = printer.productID { info["productId"] = pid }
            reply(info, nil)
        } catch {
            reply(nil, error.localizedDescription)
        }
    }

    // MARK: Connect (Bluetooth)

    private func connect(_ reply: @escaping (Any?, String?) -> Void) {
        close()
        guard IOBluetoothHostController.default()?.powerState == kBluetoothHCIPowerStateON else {
            reply(nil, "Bluetooth is off. Turn it on in Control Centre or System Settings, then try again.")
            return
        }
        // Brother label printers advertise names like "PT-E560BT1234".
        let printers = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? [])
            .filter { ($0.name ?? "").uppercased().hasPrefix("PT-") }
        if printers.isEmpty {
            if let url = URL(string: "x-apple.systempreferences:com.apple.BluetoothSettings") { NSWorkspace.shared.open(url) }
            reply(nil, "No paired Brother printer found. Turn the printer on and pair it in System Settings → Bluetooth (opened for you), then connect again.")
            return
        }
        if printers.count == 1 {
            open(printers[0], reply)
            return
        }
        let alert = NSAlert()
        alert.messageText = "Choose a printer"
        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 260, height: 26))
        popup.addItems(withTitles: printers.map { $0.name ?? $0.addressString ?? "Printer" })
        alert.accessoryView = popup
        alert.addButton(withTitle: "Connect")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            open(printers[popup.indexOfSelectedItem], reply)
        } else {
            reply(nil, "No printer selected.")
        }
    }

    private func open(_ printer: IOBluetoothDevice, _ reply: @escaping (Any?, String?) -> Void) {
        device = printer
        connectReply = reply
        // Paging a printer that's off takes a while to fail; give up after 20 s.
        let timeout = DispatchWorkItem { [weak self] in
            self?.failConnect("\(printer.name ?? "The printer") didn't answer. Check it's switched on, in range and not connected to another device.")
        }
        connectTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)

        // The RFCOMM channel number is in the serial port's service record,
        // cached from pairing; if it's missing, ask the printer for it.
        if let channelID = serialChannel(printer) {
            openChannel(printer, channelID)
        } else if printer.performSDPQuery(self) != kIOReturnSuccess {
            failConnect("Could not reach \(printer.name ?? "the printer"). Check it's switched on and in range.")
        }
    }

    @objc func sdpQueryComplete(_ device: IOBluetoothDevice!, status: IOReturn) {
        guard device === self.device, connectReply != nil else { return }
        guard status == kIOReturnSuccess, let channelID = serialChannel(device) else {
            failConnect("\(device.name ?? "The printer") didn't answer. Check it's switched on, in range and not connected to another device.")
            return
        }
        openChannel(device, channelID)
    }

    private func serialChannel(_ device: IOBluetoothDevice) -> BluetoothRFCOMMChannelID? {
        guard let record = device.getServiceRecord(for: Self.serialPort) else { return nil }
        var id: BluetoothRFCOMMChannelID = 0
        return record.getRFCOMMChannelID(&id) == kIOReturnSuccess ? id : nil
    }

    private func openChannel(_ device: IOBluetoothDevice, _ channelID: BluetoothRFCOMMChannelID) {
        var ch: IOBluetoothRFCOMMChannel?
        let result = device.openRFCOMMChannelAsync(&ch, withChannelID: channelID, delegate: self)
        if result != kIOReturnSuccess {
            failConnect("Could not connect to \(device.name ?? "the printer"). Check it's switched on and not connected to another device.")
            return
        }
        channel = ch
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        guard rfcommChannel === channel, let reply = connectReply else { return }
        if error != kIOReturnSuccess {
            failConnect("Could not connect to \(device?.name ?? "the printer"). Check it's switched on and not connected to another device.")
            return
        }
        connectTimeout?.cancel()
        connectTimeout = nil
        connectReply = nil
        reply(["name": device?.name ?? "Brother printer"], nil)
    }

    private func failConnect(_ message: String) {
        guard let reply = connectReply else { return }
        connectReply = nil
        close()
        reply(nil, message)
    }

    // MARK: Write

    private func write(_ data: Data, _ reply: @escaping (Any?, String?) -> Void) {
        if let usb {
            usb.write(data) { error in reply(error == nil ? true : nil, error) }
            return
        }
        guard channel != nil else {
            reply(nil, "Printer not connected.")
            return
        }
        let mtu = max(1, Int(channel?.getMTU() ?? 512))
        var offset = 0
        while offset < data.count {
            let end = min(offset + mtu, data.count)
            // The reply goes with the last chunk, once it has been sent.
            outQueue.append((data.subdata(in: offset..<end), end == data.count ? reply : nil))
            offset = end
        }
        if data.isEmpty { reply(true, nil) }
        sendNext()
    }

    private func sendNext() {
        guard writing == nil, let ch = channel, !outQueue.isEmpty else { return }
        let chunk = outQueue[0].data
        // IOBluetooth reads the buffer after this call returns, so it must
        // outlive it; freed when the write completes.
        let buf = UnsafeMutableRawPointer.allocate(byteCount: chunk.count, alignment: 1)
        chunk.copyBytes(to: buf.assumingMemoryBound(to: UInt8.self), count: chunk.count)
        writing = buf
        if ch.writeAsync(buf, length: UInt16(chunk.count), refcon: nil) != kIOReturnSuccess {
            finishWrite(failed: true)
        }
    }

    func rfcommChannelWriteComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, refcon: UnsafeMutableRawPointer!, status error: IOReturn) {
        guard rfcommChannel === channel else { return }
        finishWrite(failed: error != kIOReturnSuccess)
    }

    private func finishWrite(failed: Bool) {
        writing?.deallocate()
        writing = nil
        guard !outQueue.isEmpty else { return }
        if failed {
            close()
            return
        }
        let done = outQueue.removeFirst()
        done.reply?(true, nil)
        sendNext()
    }

    // MARK: Read

    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!, data dataPointer: UnsafeMutableRawPointer!, length dataLength: Int) {
        guard rfcommChannel === channel, let dataPointer else { return }
        inBuffer.append(dataPointer.assumingMemoryBound(to: UInt8.self), count: dataLength)
    }

    private func read(deadline: Date, _ reply: @escaping (Any?, String?) -> Void) {
        if inBuffer.count >= 32 || Date() >= deadline || (channel == nil && usb == nil) {
            let out = inBuffer
            inBuffer.removeAll()
            reply(out.base64EncodedString(), nil)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025) { [weak self] in
            self?.read(deadline: deadline, reply)
        }
    }

    // MARK: Close

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        guard rfcommChannel === channel else { return }
        let wasOpen = connectReply == nil
        close()
        if wasOpen { notifyDisconnect() }
    }

    func close() {
        usb?.close()
        usb = nil
        connectTimeout?.cancel()
        connectTimeout = nil
        let ch = channel
        channel = nil
        ch?.setDelegate(nil)
        ch?.close()
        device?.closeConnection()
        device = nil
        inBuffer.removeAll()
        writing?.deallocate()
        writing = nil
        let failed = outQueue.compactMap(\.reply)
        outQueue.removeAll()
        failed.forEach { $0(nil, "Printer disconnected.") }
    }

    private func notifyDisconnect() {
        webView?.evaluateJavaScript("window.__labelsmithNativeDisconnect && window.__labelsmithNativeDisconnect()")
    }
}
