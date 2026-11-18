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
///
/// A page left to play is also kept ready while it is silent: between two
/// titles, and through a pause of the channel. iOS stops an app within seconds
/// of its last sound, and from then on nothing reaches the page: not the next
/// title, not "play" from the owner's computer. On iOS 18 WebKit also gives up
/// the audio session with the last sound in the background, and the next title
/// could not start. So a second, silent sound runs next to MusicKit (the
/// carrier, see `carrierScript`), for as long as `readyTime` says.
@MainActor
final class BackgroundPlayback: NSObject {
    /// What the page says it holds.
    private struct Answer {
        /// MusicKit is on the page and no YouTube player. Nothing else may play on.
        var appleMusic = false
        /// MusicKit plays, or is about to: loading, buffering, seeking.
        var busy = false
        /// This device plays an Apple Music channel, which the page marks on
        /// <html data-apple-player>. A page from before the mark does not say.
        var isPlayer = false
        /// <html data-apple-standby>: how long a paused channel is kept ready on
        /// this device, in minutes, or "channel" for as long as it stays open.
        var standby: String?
    }

    private enum Phase {
        case inFront
        /// Not in front: the page is asked what it holds, again and again.
        case watching(Task<Void, Never>)
        /// Not in front: all media stays suspended until the scene is back.
        case suspended
    }

    /// How long a page stays ready after MusicKit's last sound where the page
    /// does not say that this device plays the channel: the gap between two
    /// titles.
    private static let gapTime: TimeInterval = 20
    /// How long a channel this device plays is kept ready without a choice on
    /// the page: two hours, as in the Android app.
    private static let standbyTime: TimeInterval = 2 * 60 * 60
    /// The carrier is asked for this long at a time and asked again every
    /// second: left alone, it stops by itself.
    private static let carrierSeconds = 3

    /// The carrier lives in a world of its own: the page cannot reach it, and
    /// it cannot reach the page's scripts.
    private static let world = WKContentWorld.world(name: "CueVoteBackground")

    /// Runs in the main frame, in the page's own world. A YouTube player on the
    /// page always answers "other", whatever else is there.
    ///
    /// It also calls play() on what already plays. That changes nothing for the
    /// sound; it tells WebKit, which runs this as the user's doing, that these
    /// are the elements the user started. The lock screen shows the element
    /// started last by the user, and that has to be MusicKit's, not the carrier:
    /// a paused channel showed as playing otherwise.
    private static let question = """
    (function () {
        try {
            if (document.querySelector('iframe[src*="youtube"]')) return { holding: 'other' };
            var kit = window.MusicKit;
            var music = kit && typeof kit.getInstance === 'function' ? kit.getInstance() : null;
            if (!music) return { holding: 'other' };
            var states = kit.PlaybackStates || {};
            var busy = !!music.isPlaying
                || [states.loading, states.waiting, states.seeking, states.stalled].indexOf(music.playbackState) !== -1;
            var media = document.querySelectorAll('audio, video');
            for (var i = 0; i < media.length; i++) {
                if (media[i].paused || media[i].ended) continue;
                var again = media[i].play();
                if (again && again.catch) again.catch(function () {});
            }
            var root = document.documentElement;
            return {
                holding: 'appleMusic',
                busy: busy,
                player: root.getAttribute('data-apple-player'),
                standby: root.getAttribute('data-apple-standby')
            };
        } catch (e) {
            return { holding: 'other' };
        }
    })()
    """

    /// The carrier: ten seconds of silence, played in a loop while the app asks
    /// for it. It is a sound like any other to WebKit and to iOS, so the audio
    /// session stays and the page keeps running.
    ///
    /// It starts from a timer of its own, never from a call of the app: WebKit
    /// takes what the app runs for the user's doing, and the lock screen would
    /// show the carrier in place of the music (see `question`).
    static let carrierScript = WKUserScript(source: """
    (function () {
        var carrier = null;
        var until = 0;
        function rest() {
            if (carrier && !carrier.paused) carrier.pause();
        }
        function silence() {
            var rate = 8000, n = 10 * rate;
            var bytes = new Uint8Array(44 + n);
            bytes.fill(128, 44);
            var view = new DataView(bytes.buffer);
            var put = function (at, text) { for (var i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
            put(0, 'RIFF'); view.setUint32(4, 36 + n, true); put(8, 'WAVE'); put(12, 'fmt ');
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
            view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
            put(36, 'data'); view.setUint32(40, n, true);
            var audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
            audio.loop = true;
            return audio;
        }
        window.cueVoteCarrier = function (seconds) {
            until = seconds > 0 ? Date.now() + seconds * 1000 : 0;
            if (!until) rest();
        };
        setInterval(function () {
            if (Date.now() >= until) { rest(); return; }
            if (!carrier) carrier = silence();
            if (carrier.paused) {
                var started = carrier.play();
                if (started && started.catch) started.catch(function () {});
            }
        }, 500);
    })();
    """, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world)

    private weak var webView: WKWebView?
    private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "CueVote", category: "BackgroundPlayback")
    private var phase = Phase.inFront
    /// Held from entering the background until the first answer is in.
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    /// When MusicKit was last busy, as far as the page was asked.
    private var lastBusy = Date.distantPast
    /// When the scene last left the front.
    private var leftFront = Date.distantPast
    private var keptReady = false

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
        leftFront = Date()
        phase = .watching(Task { [weak self] in
            var answered = false
            while !Task.isCancelled {
                guard let self else { return }
                let answer = await self.ask()
                // Back in front, or suspended, while the page was answering.
                guard !Task.isCancelled else { return }
                guard answer.appleMusic else {
                    self.suspendMedia()
                    return
                }
                self.keepReady(answer)
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
            carry(false)
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
    private func ask() async -> Answer {
        guard let webView, CueVoteOrigin.isTrusted(webView.url) else { return Answer() }
        return await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(Self.question) { result, _ in
                var answer = Answer()
                if let said = result as? [String: Any], said["holding"] as? String == "appleMusic" {
                    answer.appleMusic = true
                    answer.busy = said["busy"] as? Bool ?? false
                    answer.isPlayer = said["player"] is String
                    answer.standby = said["standby"] as? String
                }
                continuation.resume(returning: answer)
            }
        }
    }

    /// How long the page stays ready after its last sound.
    private func readyTime(_ answer: Answer) -> TimeInterval {
        guard answer.isPlayer else { return Self.gapTime }
        if answer.standby == "channel" { return .infinity }
        if let minutes = answer.standby.flatMap(Double.init), minutes > 0 { return minutes * 60 }
        return Self.standbyTime
    }

    /// Runs the carrier while the page is to stay ready, and lets it rest
    /// after that: iOS then stops the app as it stops any silent one.
    private func keepReady(_ answer: Answer) {
        let now = Date()
        if answer.busy { lastBusy = now }
        // A channel this device plays counts from when the app left the front:
        // nobody asked the page before that.
        let lastSound = answer.isPlayer ? max(lastBusy, leftFront) : lastBusy
        let ready = now.timeIntervalSince(lastSound) < readyTime(answer)
        if ready != keptReady {
            keptReady = ready
            log.info("\(ready ? "The page is kept ready" : "The page is no longer kept ready", privacy: .public)")
        }
        carry(ready)
    }

    /// Asks the carrier to run for a few more seconds, or to rest.
    private func carry(_ on: Bool) {
        if !on { keptReady = false }
        guard let webView, CueVoteOrigin.isTrusted(webView.url) else { return }
        let seconds = on ? Self.carrierSeconds : 0
        webView.evaluateJavaScript("window.cueVoteCarrier && window.cueVoteCarrier(\(seconds)); 0", in: nil, in: Self.world, completionHandler: nil)
    }

    /// Stops all media in the page and keeps it stopped until the scene is back.
    private func suspendMedia() {
        guard case .watching(let watch) = phase else { return }
        watch.cancel()
        phase = .suspended
        carry(false)
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
