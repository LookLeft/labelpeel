import SwiftUI

@main
struct LabelsmithMacApp: App {
    @NSApplicationDelegateAdaptor private var delegate: AppDelegate

    var body: some Scene {
        // One window: the printer accepts one connection at a time.
        Window("Labelsmith", id: "main") {
            WebContainer()
                .frame(minWidth: 760, minHeight: 520)
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            // ⌘N, ⌘S, ⌘O and ⌘P are handled by the web app itself.
            CommandGroup(replacing: .newItem) {}
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
