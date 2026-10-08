import Foundation
import IOKit
import IOKit.usb
import IOUSBHost

struct BridgeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// A Brother printer on USB, through its USB printer-class interface. Writes
/// block on a private queue; replies (status packets) arrive through a read
/// that is always waiting on the IN endpoint.
final class UsbPrinter {
    private static let brotherVendorID = 0x04f9
    private static let printerClass = 7
    /// iokit_common_msg(0x010): the device was unplugged.
    private static let serviceTerminated: UInt32 = 0xe000_0010

    let name: String
    let productID: Int?
    private let interface: IOUSBHostInterface
    private let outPipe: IOUSBHostPipe
    private let inPipe: IOUSBHostPipe?
    private let queue = DispatchQueue(label: "labelpeel.usb")
    private var open = true

    /// Called on the main thread.
    var onData: ((Data) -> Void)?
    var onDisconnect: (() -> Void)?

    init() throws {
        let matching = IOUSBHostInterface.__createMatchingDictionary(
            withVendorID: NSNumber(value: Self.brotherVendorID), productID: nil, bcdDevice: nil, interfaceNumber: nil,
            configurationValue: nil, interfaceClass: NSNumber(value: Self.printerClass), interfaceSubclass: nil,
            interfaceProtocol: nil, speed: nil, productIDArray: nil).takeRetainedValue()
        let service = IOServiceGetMatchingService(kIOMainPortDefault, matching)
        guard service != IO_OBJECT_NULL else {
            throw BridgeError("No Brother printer found on USB. Connect it with a USB cable and switch it on, then try again.")
        }
        defer { IOObjectRelease(service) }

        let parent = IOOptionBits(kIORegistryIterateRecursively | kIORegistryIterateParents)
        productID = IORegistryEntrySearchCFProperty(service, kIOServicePlane, "idProduct" as CFString, nil, parent) as? Int
        name = IORegistryEntrySearchCFProperty(service, kIOServicePlane, "USB Product Name" as CFString, nil, parent) as? String
            ?? "Brother printer"

        var disconnect: (() -> Void)?
        let handler: IOUSBHostInterestHandler = { _, messageType, _ in
            if messageType == Self.serviceTerminated { DispatchQueue.main.async { disconnect?() } }
        }
        do {
            interface = try IOUSBHostInterface(__ioService: service, options: [], queue: queue, interestHandler: handler)
        } catch {
            // Another app or driver has it; ask for it to be released to us.
            do {
                interface = try IOUSBHostInterface(__ioService: service, options: [.deviceSeize], queue: queue, interestHandler: handler)
            } catch {
                throw BridgeError("Could not open \(name) on USB. Quit other apps using the printer (such as P-touch Editor) and try again.")
            }
        }

        // Bulk endpoints of the printer interface.
        var outAddress: UInt8?
        var inAddress: UInt8?
        var current: UnsafePointer<IOUSBDescriptorHeader>?
        while let ep = IOUSBGetNextEndpointDescriptor(interface.configurationDescriptor, interface.interfaceDescriptor, current) {
            if IOUSBGetEndpointType(ep) == UInt8(kIOUSBEndpointTypeBulk.rawValue) {
                if IOUSBGetEndpointDirection(ep) == UInt8(kIOUSBEndpointDirectionIn.rawValue) { inAddress = IOUSBGetEndpointAddress(ep) }
                else { outAddress = IOUSBGetEndpointAddress(ep) }
            }
            current = UnsafeRawPointer(ep).assumingMemoryBound(to: IOUSBDescriptorHeader.self)
        }
        guard let outAddress, let pipe = try? interface.copyPipe(withAddress: Int(outAddress)) else {
            interface.destroy()
            throw BridgeError("\(name) has no USB printer output.")
        }
        outPipe = pipe
        if let inAddress { inPipe = try? interface.copyPipe(withAddress: Int(inAddress)) } else { inPipe = nil }

        disconnect = { [weak self] in
            guard let self, self.open else { return }
            self.close()
            self.onDisconnect?()
        }
        queue.async { self.readNext() }
    }

    /// Writes everything, then calls back on the main thread with an error message or nil.
    func write(_ data: Data, completion: @escaping (String?) -> Void) {
        queue.async {
            var failure: String?
            var offset = 0
            while offset < data.count && failure == nil {
                let chunk = NSMutableData(data: data.subdata(in: offset..<min(offset + 16384, data.count)))
                var sent = 0
                do {
                    try self.outPipe.__sendIORequest(with: chunk, bytesTransferred: &sent, completionTimeout: 10)
                    offset += max(sent, 1)
                } catch {
                    failure = "USB transfer failed. Check the cable and that the printer is on."
                }
            }
            DispatchQueue.main.async { completion(failure) }
        }
    }

    private func readNext() {
        guard open, let inPipe else { return }
        let buf = NSMutableData(length: 64)!
        do {
            try inPipe.enqueueIORequest(with: buf, completionTimeout: 0) { [weak self] status, count in
                guard let self, self.open else { return }
                if status == kIOReturnSuccess, count > 0 {
                    let bytes = Data(bytes: buf.bytes, count: count)
                    DispatchQueue.main.async { self.onData?(bytes) }
                }
                // Aborted or failed reads stop the loop; the interface is closing.
                if status == kIOReturnSuccess || status == kIOReturnTimeout {
                    self.queue.async { self.readNext() }
                }
            }
        } catch {
            // No reads; status replies just won't arrive.
        }
    }

    func close() {
        guard open else { return }
        open = false
        try? inPipe?.__abort(with: .asynchronous)
        interface.destroy()
    }
}
