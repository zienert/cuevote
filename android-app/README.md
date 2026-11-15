# CueVote Android Wrapper

This is a native Android wrapper for the CueVote web application.

## Purpose
- **Always On Screen**: Keeps the device awake while the app is open.
- **Autoplay Fix**: Disables the "User Gesture Requirement" so videos play automatically.
- **Apple Music in the background**: An Apple Music channel that plays on the device keeps playing when the app leaves the screen or the screen is switched off (a foreground service, see `PlaybackService.kt`). YouTube channels stop in the background, as YouTube's terms require.

## How to Build

1.  **Install Android Studio**
    - [Download here](https://developer.android.com/studio).

2.  **Open Project**
    - Launch Android Studio.
    - Select **Open**.
    - Navigate to this folder: `cuevote/android-app`.

3.  **Run / Debug**
    - Connect your Android device via USB (ensure Developer Options > USB Debugging is ON).
    - Or create an AVD (Emulator).
    - Click the **Run** (Green Play) button in the toolbar.

4.  **Generate APK**
    - Menu: `Build` > `Build Bundle(s) / APK(s)` > `Build APK(s)`.
    - Locate the APK in `app/build/outputs/apk/debug/app-debug.apk`.

## Configuration
The App URL is hardcoded in `MainActivity.kt`:
```kotlin
webView.loadUrl("https://cuevote.com")
```
Change this if you need to point to a different environment.
