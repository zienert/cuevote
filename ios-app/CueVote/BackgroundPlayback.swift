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
/// So while the scene is not in front, the page is asked once a second what it
/// holds. Only MusicKit JS plays Apple Music:
///   * MusicKit, and no YouTube player: the page is left alone. Its player may
///     pause and start again, from the lock screen or when the channel says so.
///   * anything else: all media in the page is suspended on the spot. WebKit
///     then refuses every play(), from the page, from a frame and from the lock
///     screen's play button, until the scene is back in front.
///
/// The question is put to the main frame, which only ever holds CueVote (see
/// CueVoteOrigin), and its answer is read here. There is no message handler a
/// frame could call to claim that Apple Music is playing.
@MainActor
final class BackgroundPlayback: NSObject {
    private enum Holding: String {
        /// MusicKit is on the page, and no YouTube player.
        case appleMusic
        /// No MusicKit on the page, or a YouTube player next to it.
        case other
    }

    private enum Phase {
        case inFront
        /// Not in front: the page is asked what it holds, again and again.
        case watching(Task<Void, Never>)
        /// Not in front: all media stays suspended until the scene is back.
        case suspended
    }

    /// Runs in the main frame, in the page's own world. A YouTube player on the
    /// page always answers "other", whatever else is there.
    private static let question = """
    (function () {
        try {
            if (document.querySelector('iframe[src*="youtube"]')) return 'other';
            var kit = window.MusicKit;
            var music = kit && typeof kit.getInstance === 'function' ? kit.getInstance() : null;
            return music ? 'appleMusic' : 'other';
        } catch (e) {
            return 'other';
        }
    })()
    """

    private weak var webView: WKWebView?
    private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "CueVote", category: "BackgroundPlayback")
    private var phase = Phase.inFront
    /// Held from entering the background until the first answer is in.
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(sceneDidEnterBackground), name: UIScene.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneIsBack), name: UIScene.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneIsBack), name: UIScene.didActivateNotification, object: nil)
    }

    /// WebKit goes by the scene its view is in; so does this.
    private func concerns(_ notification: Notification) -> Bool {
        guard let scene = webView?.window?.windowScene else { return false }
        return notification.object as AnyObject? === scene
    }

    @objc private func sceneDidEnterBackground(_ notification: Notification) {
        guard concerns(notification), case .inFront = phase else { return }
        // iOS suspends an app that plays nothing within seconds. The first
        // answer has to be in before that: a page left as it is could be started
        // from the lock screen. Out of time without one, nothing plays on.
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Background playback") { [weak self] in
            self?.suspendMedia()
            self?.endBackgroundTask()
        }
        phase = .watching(Task { [weak self] in
            var answered = false
            while !Task.isCancelled {
                guard let self else { return }
                let holding = await self.ask()
                // Back in front, or suspended, while the page was answering.
                guard !Task.isCancelled else { return }
                guard holding == .appleMusic else {
                    self.suspendMedia()
                    return
                }
                if !answered {
                    answered = true
                    self.log.info("Apple Music on the page: it is left to play")
                    self.endBackgroundTask()
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        })
    }

    @objc private func sceneIsBack(_ notification: Notification) {
        guard concerns(notification) else { return }
        switch phase {
        case .inFront:
            break
        case .watching(let watch):
            watch.cancel()
        case .suspended:
            // WebKit starts again what was playing when it was suspended.
            log.info("Back in front: the page's media is resumed")
            webView?.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        }
        phase = .inFront
        endBackgroundTask()
    }

    /// Asks the page what it holds. A page that is not CueVote's, or does not
    /// answer, holds nothing that may play on.
    private func ask() async -> Holding {
        guard let webView, CueVoteOrigin.isTrusted(webView.url) else { return .other }
        return await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(Self.question) { answer, _ in
                continuation.resume(returning: (answer as? String).flatMap(Holding.init(rawValue:)) ?? .other)
            }
        }
    }

    /// Stops all media in the page and keeps it stopped until the scene is back.
    private func suspendMedia() {
        guard case .watching(let watch) = phase else { return }
        watch.cancel()
        phase = .suspended
        log.info("No Apple Music on the page: its media is suspended")
        webView?.setAllMediaPlaybackSuspended(true) { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
