# CueVote iOS & iPadOS Native Wrapper

This directory contains the Swift source files to create a native iOS and iPadOS wrapper app for CueVote. It matches the core functionality of the Android wrapper (specifically Wakelock and Autoplay permissions) and ensures the web app functionality works seamlessly.

## Supported Platforms

*   **iPhone (iOS)**: Fully Supported
*   **iPad (iPadOS)**: Fully Supported
*   **Apple TV (tvOS)**: **NOT Supported**
    *   *Reason*: Apple TV (tvOS) does not include the `WebKit` framework, meaning "WebViews" (browsers inside apps) are strictly prohibited and technically unavailable. The only way to support Apple TV is to rewrite the application natively using SwiftUI or TVML, which is outside the scope of this wrapper.
    *   *Workaround*: Users can AirPlay content from their iPhone/iPad wrapper to the Apple TV.

## Setup Instructions

Prerequisites: **Mac with Xcode installed**.

1.  **Open Xcode** and create a **New Project**.
    *   Select **iOS** -> **App**.
    *   Click **Next**.
2.  **Configure the Project**:
    *   Product Name: `CueVote`
    *   Interface: **SwiftUI**
    *   Language: **Swift**
    *   Organization Identifier: `com.cuevote` (or your preferred ID)
    *   Click **Next** and save it.
3.  **Setup Universal Support (iPhone & iPad)**:
    *   Click on the **Project File** (blue icon at the top of the file navigator).
    *   Select the **Target** (CueVote).
    *   In the **General** tab, look for **Supported Destinations**.
    *   Ensure both **iPhone** and **iPad** are present.
4.  **Import Files**:
    *   Replace the generated `CueVoteApp.swift` with the one provided in `CueVote/CueVoteApp.swift`.
    *   Replace `ContentView.swift` with `CueVote/ContentView.swift`.
    *   Add `CueVote/WebView.swift`, `CueVote/QRScannerView.swift` and `CueVote/BackgroundPlayback.swift` to your project (Drag & Drop into Xcode file navigator, ensuring "Copy items if needed" is checked).
5.  **Capabilities and Info.plist**:
    *   Select the **Target** (CueVote), open **Signing & Capabilities**, click **+ Capability** and add **Background Modes**. Tick **Audio, AirPlay, and Picture in Picture**. This writes `UIBackgroundModes` with the value `audio` into the app's Info.plist; without it iOS suspends the app, and the music, as soon as it leaves the screen.
    *   In the **Info** tab add **Privacy - Camera Usage Description** (`NSCameraUsageDescription`) for the QR scanner.
    *   Alternatively set `CueVote/Info.plist` as the target's Info.plist file (**Build Settings** -> **Info.plist File**). It carries both keys.
6.  **Build and Run**:
    *   Select an iPhone or iPad simulator/device and press **Cmd + R**.

## Key Features Implemented

*   **Universal Layout**: Works on both iPhone and iPad.
*   **Wakefulness**: Screen stays on (`isIdleTimerDisabled = true`).
*   **Autoplay**: Media plays automatically (Restrictions disabled in `WKWebViewConfiguration`).
*   **Detection**: Seamlessly detected by the web client as "Wrapper" avoiding the "Install App" block page.
*   **Background Playback**: An Apple Music channel keeps playing when the app is in the background or the device is locked. Everything else, a YouTube channel included, is stopped until the app is back in front (`BackgroundPlayback.swift`): YouTube's terms do not allow playback in the background.
*   **Ready While Paused**: The device that plays an Apple Music channel stays ready in the background while the channel is paused, for two hours, so that the owner can start it again from another device. The app plays a silent sound for that time; iOS stops an app that plays nothing. After that the app has to be opened again, or started from the lock screen.

## Testing Background Playback

The iOS Simulator cannot play Apple Music's protected songs and videos, and it keeps an app running in the background whether or not the background mode is set. What it does show, with unprotected audio such as the 30-second previews a guest gets in an Apple Music channel, is that the page plays on after Home and Lock and that a YouTube channel stops. Full playback in the background needs a real device signed in to an Apple Music subscription.
