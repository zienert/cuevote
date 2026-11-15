import os
import UIKit
import WebKit

/// What CueVote's page may play once the app is no longer in front.
///
/// The audio background mode (UIBackgroundModes in Info.plist) lets iOS keep the
/// app running for as long as the page plays sound, and it makes no difference
/// between sounds. CueVote has to: an Apple Music channel may play on with the
/// phone locked, a YouTube channel may not. YouTube's terms forbid playback in
/// the background, and CueVote's access to the YouTube API depends on keeping
/// them.
///
/// So each time the scene leaves the front, the page is asked what it is doing.
/// Only MusicKit JS plays Apple Music, and only it gets to go on:
///   * MusicKit is playing: the page is left alone.
///   * MusicKit is on the page but silent: it gets a few seconds, enough to
///     start the next title, and is left alone if it does.
///   * anything else: all media in the page is suspended on the spot. WebKit
///     then refuses every play(), from the page, from a frame and from the lock
///     screen's play button, until the scene is back in front.
///
/// The question is put to the main frame, which only ever holds CueVote (see
/// CueVoteOrigin), and its answer is read here. There is no message handler a
/// frame could call to claim that Apple Music is playing.
@MainActor
final class BackgroundPlayback: NSObject {
    private enum Playing: String {
        /// MusicKit is playing, or loading what it was told to play.
        case appleMusic
        /// MusicKit is on the page and silent: between two titles, or paused.
        case appleMusicSilent
        /// No MusicKit on the page, or a YouTube player next to it.
        case other
    }

    /// How long a silent MusicKit may take to start its next title. WebKit keeps
    /// a page that stopped playing awake for 10 seconds for the same purpose.
    private static let secondsForNextTitle = 8

    /// Runs in the main frame, in the page's own world. A YouTube player on the
    /// page always answers "other", whatever MusicKit says.
    private static let question = """
    (function () {
        try {
            if (document.querySelector('iframe[src*="youtube"]')) return 'other';
            var kit = window.MusicKit;
            var music = kit && typeof kit.getInstance === 'function' ? kit.getInstance() : null;
            if (!music) return 'other';
            var states = kit.PlaybackStates || {};
            var state = music.playbackState;
            var loading = typeof state === 'number'
                && [states.loading, states.waiting, states.seeking, states.stalled].indexOf(state) !== -1;
            return music.isPlaying || loading ? 'appleMusic' : 'appleMusicSilent';
        } catch (e) {
            return 'other';
        }
    })()
    """

    private weak var webView: WKWebView?
    private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "CueVote", category: "BackgroundPlayback")

    /// Whether MusicKit was playing when the scene stopped being in front.
    /// WebKit pauses a video the moment the scene is in the background, so by
    /// then a music video no longer counts as playing.
    private var playingWhenLeft = false
    /// Goes up each time the scene is back in front. An answer from the page
    /// that belongs to an earlier absence is dropped.
    private var absence = 0
    private var suspended = false
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(sceneWillDeactivate), name: UIScene.willDeactivateNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneDidEnterBackground), name: UIScene.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneWillEnterForeground), name: UIScene.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneDidActivate), name: UIScene.didActivateNotification, object: nil)
    }

    /// WebKit goes by the scene its view is in; so does this.
    private func concerns(_ notification: Notification) -> Bool {
        guard let scene = webView?.window?.windowScene else { return false }
        return notification.object as AnyObject? === scene
    }

    /// Asks the page what it is playing. The question is on its way before this
    /// returns, and answers come back in the order the questions were asked.
    private func ask(_ answer: @escaping @MainActor (Playing) -> Void) {
        guard let webView, CueVoteOrigin.isTrusted(webView.url) else {
            answer(.other)
            return
        }
        webView.evaluateJavaScript(Self.question) { result, _ in
            answer((result as? String).flatMap(Playing.init(rawValue:)) ?? .other)
        }
    }

    // About to leave the front: Home, the app switcher, Control Center, a lock.
    @objc private func sceneWillDeactivate(_ notification: Notification) {
        guard concerns(notification) else { return }
        let absence = self.absence
        playingWhenLeft = false
        ask { [weak self] playing in
            guard let self, absence == self.absence else { return }
            self.playingWhenLeft = playing == .appleMusic
        }
    }

    @objc private func sceneDidEnterBackground(_ notification: Notification) {
        guard concerns(notification) else { return }
        // iOS suspends an app that plays nothing within seconds. The decision
        // has to be made first: a page left as it is could be started again
        // from the lock screen. Out of time without one, nothing plays on.
        endBackgroundTask()
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Background playback") { [weak self] in
            self?.suspendMedia()
            self?.endBackgroundTask()
        }
        decide(absence: absence, waited: 0)
    }

    private func decide(absence: Int, waited: Int) {
        ask { [weak self] playing in
            guard let self, absence == self.absence, !self.suspended else { return }
            switch playing {
            case .other:
                self.suspendMedia()
            case .appleMusic:
                self.leaveToPlay()
            case .appleMusicSilent where self.playingWhenLeft:
                self.leaveToPlay()
            case .appleMusicSilent where waited < Self.secondsForNextTitle:
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    self?.decide(absence: absence, waited: waited + 1)
                }
            case .appleMusicSilent:
                self.suspendMedia()
            }
        }
    }

    private func leaveToPlay() {
        log.info("Apple Music is playing: the page is left to play on")
        endBackgroundTask()
    }

    /// Stops all media in the page and keeps it stopped until resumeMedia().
    private func suspendMedia() {
        guard let webView, !suspended else {
            endBackgroundTask()
            return
        }
        suspended = true
        log.info("No Apple Music playing: the page's media is suspended")
        let absence = self.absence
        webView.setAllMediaPlaybackSuspended(true) { [weak self] in
            guard let self, absence == self.absence else { return }
            self.endBackgroundTask()
        }
    }

    @objc private func sceneWillEnterForeground(_ notification: Notification) {
        guard concerns(notification) else { return }
        absence += 1
        playingWhenLeft = false
        endBackgroundTask()
        resumeMedia()
    }

    @objc private func sceneDidActivate(_ notification: Notification) {
        guard concerns(notification) else { return }
        absence += 1
        playingWhenLeft = false
    }

    /// WebKit starts again what was playing when it was suspended.
    private func resumeMedia() {
        guard suspended else { return }
        suspended = false
        log.info("Back in front: the page's media is resumed")
        webView?.setAllMediaPlaybackSuspended(false, completionHandler: nil)
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
