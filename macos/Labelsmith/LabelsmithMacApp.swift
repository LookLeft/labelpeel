import Sparkle
import SwiftUI

@main
struct LabelsmithMacApp: App {
    @NSApplicationDelegateAdaptor private var delegate: AppDelegate
    /// Checks GitHub releases for updates (daily, and from the app menu).
    private let updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)

    var body: some Scene {
        // One window: the printer accepts one connection at a time.
        Window("Labelsmith", id: "main") {
            WebContainer()
                .frame(minWidth: 760, minHeight: 520)
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") { updater.checkForUpdates(nil) }
            }
            // ⌘N, ⌘S, ⌘O and ⌘P are handled by the web app itself.
            CommandGroup(replacing: .newItem) {}
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
