import SwiftUI

@main
struct PtouchStudioApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .background(Color(red: 0x11 / 255, green: 0x18 / 255, blue: 0x27 / 255))
        }
    }
}
