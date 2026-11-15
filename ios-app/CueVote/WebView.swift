import SwiftUI
import WebKit
import AuthenticationServices
import CryptoKit

/// The origins this wrapper trusts.
///
/// Two separate jobs hang off this list, and both matter:
///   * only these may load in the WebView's main frame, and
///   * only these may talk to the native bridge.
/// The bridge hands out a Google access token that doubles as the CueVote login,
/// so any page that reaches it can take over the account. Keeping foreign pages
/// out of the WebView entirely is the primary defence; the per-message origin
/// check below is the backstop.
enum CueVoteOrigin {
    static let allowedHosts: Set<String> = ["cuevote.com", "www.cuevote.com"]

    static func isTrusted(_ url: URL?) -> Bool {
        guard let url = url,
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased() else { return false }
        return allowedHosts.contains(host)
    }

    /// Origin of the frame that actually sent a script message.
    ///
    /// `message.webView?.url` is the MAIN frame's URL — checking that would let a
    /// third-party iframe embedded on cuevote.com (the YouTube player is one)
    /// speak with CueVote's authority. `WKFrameInfo.securityOrigin` is the frame's
    /// own origin and cannot be spoofed from JS.
    static func isTrusted(_ frame: WKFrameInfo) -> Bool {
        let origin = frame.securityOrigin
        return origin.`protocol`.lowercased() == "https"
            && allowedHosts.contains(origin.host.lowercased())
    }
}

/// Apple Music's sign-in pages.
enum AppleSignIn {
    /// Where MusicKit JS opens its sign-in window.
    static func isSignInPage(_ url: URL?) -> Bool {
        guard let url = url, url.scheme?.lowercased() == "https" else { return false }
        return url.host?.lowercased() == "authorize.music.apple.com"
    }

    /// The pages that sign-in moves through: Apple ID, two-factor, password reset.
    static func isApplePage(_ url: URL?) -> Bool {
        guard let url = url, url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased() else { return false }
        return host == "apple.com" || host.hasSuffix(".apple.com")
    }

    static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

/// Apple Music's sign-in, shown over CueVote as a sheet: a bar with the page's
/// address and a close button, Apple's page underneath. The page is a popup of
/// CueVote's WebView, so MusicKit gets its answer the regular way. Closing the
/// sheet cancels the sign-in: the popup goes away, MusicKit sees its window
/// closed and stops waiting.
final class AppleSignInController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    private let address = UILabel()

    /// The web view must exist before createWebViewWith returns it, so it is
    /// built here rather than in viewDidLoad.
    init(configuration: WKWebViewConfiguration) {
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark"), for: .normal)
        close.tintColor = .white
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        address.textColor = UIColor(white: 0.64, alpha: 1)
        address.font = .systemFont(ofSize: 14)
        address.lineBreakMode = .byTruncatingMiddle

        let bar = UIView()
        bar.backgroundColor = UIColor(white: 0.04, alpha: 1)
        [address, close].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            bar.addSubview($0)
        }
        [bar, webView].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 48),
            address.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            address.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            address.trailingAnchor.constraint(lessThanOrEqualTo: close.leadingAnchor, constant: -8),
            close.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -4),
            close.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // However the sheet went (close button, swipe, the page closing itself),
        // the popup goes with it.
        guard isBeingDismissed || presentingViewController == nil else { return }
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
    }

    // Inside the sign-in, Apple's own pages only; anything else goes to Safari.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let target = navigationAction.targetFrame, !target.isMainFrame {
            decisionHandler(.allow)
            return
        }
        let url = navigationAction.request.url
        if AppleSignIn.isApplePage(url) || url?.scheme?.lowercased() == "about" {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if let url = url, url.scheme?.lowercased() == "https" {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        address.text = webView.url?.host
    }

    // Apple's page closes itself once MusicKit has the result.
    func webViewDidClose(_ webView: WKWebView) {
        dismiss(animated: true)
    }

    // Further windows from Apple's page (help links) go to Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme?.lowercased() == "https" {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isOffline: Bool
    @Binding var isLoading: Bool
    @Binding var pageLoaded: Bool
    var reloadKey: UUID = UUID()
    
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.applicationNameForUserAgent = "CueVoteWrapper"
        
        // One content controller for both the user script and the message
        // handlers. Building a second one and assigning it over the first
        // silently drops whatever was registered on the first — keep this as a
        // single object so a future handler cannot be lost that way.
        let contentController = WKUserContentController()

        // Main frame only: sub-frames are third-party (the YouTube player) and
        // have no business seeing the wrapper marker.
        let scriptSource = "window.CueVoteAndroid = { isNative: function() { return true; } };"
        let script = WKUserScript(source: scriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        contentController.addUserScript(script)

        contentController.add(context.coordinator, name: "nativeGoogleLogin")
        contentController.add(context.coordinator, name: "toggleQRButton")
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        
        let tokenObserver = NotificationCenter.default.addObserver(forName: NSNotification.Name("InjectGoogleToken"), object: nil, queue: .main) { note in
            // JSON-encode the token instead of raw string interpolation. Google
            // OAuth tokens are alphanumeric in practice, but a single stray
            // quote or backslash would break out of the JS string context and
            // turn the bridge into an RCE primitive in the web layer.
            //
            // Re-check the origin at injection time, not just when the sign-in
            // started. ASWebAuthenticationSession runs for as long as the user
            // needs to type a password, and the page underneath can navigate in
            // the meantime — deliver the token only if CueVote is still loaded.
            guard CueVoteOrigin.isTrusted(webView.url) else { return }
            if let token = note.object as? String,
               let tokenData = try? JSONEncoder().encode(token),
               let tokenJson = String(data: tokenData, encoding: .utf8) {
                let js = "window.handleNativeGoogleLogin && window.handleNativeGoogleLogin(\(tokenJson));"
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }

        let resumeObserver = NotificationCenter.default.addObserver(forName: NSNotification.Name("AppDidBecomeActive"), object: nil, queue: .main) { _ in
            webView.evaluateJavaScript("window.cuevoteReconnect && window.cuevoteReconnect()", completionHandler: nil)
        }

        context.coordinator.observers.append(contentsOf: [tokenObserver, resumeObserver])

        // Apple Music plays on when the app leaves the front; nothing else does.
        context.coordinator.backgroundPlayback = BackgroundPlayback(webView: webView)

        // WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: Date(timeIntervalSince1970: 0)) { }

        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        webView.load(request)
        
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url?.absoluteString != url.absoluteString && !isOffline {
            let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            uiView.load(request)
        }
    }
    
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    
    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
        var parent: WebView
        var webAuthSession: ASWebAuthenticationSession?
        var codeVerifier: String?
        var observers: [NSObjectProtocol] = []
        var backgroundPlayback: BackgroundPlayback?

        init(parent: WebView) { self.parent = parent }

        deinit {
            observers.forEach { NotificationCenter.default.removeObserver($0) }
            observers.removeAll()
        }

        // Start
        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
             // We can use this to keep loading true, but user sets it to true initially.
        }

        // Success
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isOffline = false
                self.parent.isLoading = false
                self.parent.pageLoaded = true
            }
        }
        
        // Failure (Provisional - e.g. dns lookup failed, offline)
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("WebView Load Failed: \(error.localizedDescription)")
            DispatchQueue.main.async {
                self.parent.isOffline = true
                self.parent.isLoading = false
            }
        }
        
        // Failure (during commit)
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("WebView Navigation Failed: \(error.localizedDescription)")
             DispatchQueue.main.async {
                self.parent.isOffline = true
                self.parent.isLoading = false
            }
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            print("[WKWebView] Content process terminated (likely OOM). Reloading.")
            DispatchQueue.main.async {
                self.parent.isLoading = true
            }
            webView.reload()
        }

        /// Gate on what may load in the WebView at all.
        ///
        /// The wrapper shows no address bar, so a foreign page loaded here looks
        /// exactly like CueVote to the user — and sits next to a native bridge
        /// that hands out a Google access token. Foreign pages are therefore
        /// handed to the system browser instead, where the user can see the real
        /// origin and where no bridge exists.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {

            // Sub-frames are the page's own business — the YouTube player lives in
            // one, and the server's CSP (frame-src) already restricts them. Only
            // the main frame is gated here. A nil targetFrame means a new window,
            // which is treated like a main-frame navigation so target="_blank"
            // links end up in the browser rather than dying silently.
            if let target = navigationAction.targetFrame, !target.isMainFrame {
                decisionHandler(.allow)
                return
            }

            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if CueVoteOrigin.isTrusted(url) {
                decisionHandler(.allow)
                return
            }

            // about:blank / about:srcdoc are WebKit's own, not a navigation away.
            if url.scheme?.lowercased() == "about" {
                decisionHandler(.allow)
                return
            }

            // Apple Music's sign-in, opened by CueVote as a new window: it has to
            // stay a popup of this WebView (see createWebViewWith below).
            if navigationAction.targetFrame == nil,
               AppleSignIn.isSignInPage(url),
               CueVoteOrigin.isTrusted(navigationAction.sourceFrame) {
                decisionHandler(.allow)
                return
            }

            decisionHandler(.cancel)

            // Only a page of ours earns the hand-off. The OAuth consent screen
            // legitimately redirects to a DJ client's redirect_uri — https, or a
            // custom scheme for a native client — and that has to reach the
            // system. Granting the same to any page would turn a foreign document
            // into a launcher for arbitrary app URLs.
            guard CueVoteOrigin.isTrusted(navigationAction.sourceFrame),
                  let scheme = url.scheme?.lowercased(),
                  !["about", "data", "blob", "file", "javascript"].contains(scheme),
                  UIApplication.shared.canOpenURL(url) else { return }

            UIApplication.shared.open(url)
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            return UIApplication.shared.connectedScenes
                .filter { $0.activationState == .foregroundActive }
                .first(where: { $0 is UIWindowScene })
                .flatMap({ $0 as? UIWindowScene })?.windows
                .first(where: { $0.isKeyWindow }) ?? ASPresentationAnchor()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            // Message handlers are NOT origin-bound: WebKit delivers messages from
            // whatever document happens to be loaded, main frame or iframe. Every
            // handler therefore has to check for itself who is calling.
            guard CueVoteOrigin.isTrusted(message.frameInfo) else { return }

            if message.name == "nativeGoogleLogin" {
                startGoogleSignInPKCE()
            } else if message.name == "toggleQRButton" {
                // Parse boolean from JS payload
                var show = false
                if let boolVal = message.body as? Bool {
                    show = boolVal
                } else if let intVal = message.body as? Int {
                    show = (intVal != 0)
                } else if let numVal = message.body as? NSNumber {
                    show = numVal.boolValue
                }

                NotificationCenter.default.post(name: NSNotification.Name("ToggleQRButton"), object: show)
            }
        }
        
        func startGoogleSignInPKCE() {
            // TODO: Enter your iOS Client ID Here
            let iosClientId = "296553515986-asvbr086mtb3e266srp1ccett5egjlh0.apps.googleusercontent.com"
            
            // Standard Custom Scheme for Google OAuth
            // Remove .apps.googleusercontent.com from the end to get the scheme base
            let schemeBase = iosClientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
            let customScheme = "com.googleusercontent.apps.\(schemeBase)"
            let redirectUri = "\(customScheme):/oauth2callback"
            
            // Safety Check
            if iosClientId.contains("PASTE") {
                print("Please configure iosClientId in WebView.swift")
                return
            }
            
            // Generate PKCE Verifier & Challenge
            let verifier = generateCodeVerifier()
            self.codeVerifier = verifier
            let challenge = generateCodeChallenge(verifier: verifier)
            
            var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
            components.queryItems = [
                URLQueryItem(name: "client_id", value: iosClientId),
                URLQueryItem(name: "redirect_uri", value: redirectUri),
                URLQueryItem(name: "response_type", value: "code"),
                URLQueryItem(name: "scope", value: "email profile openid"),
                URLQueryItem(name: "code_challenge", value: challenge),
                URLQueryItem(name: "code_challenge_method", value: "S256")
            ]
            
            guard let authUrl = components.url else { return }
            
            self.webAuthSession = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: customScheme) { callbackURL, error in
                guard error == nil, let callbackURL = callbackURL else { return }
                
                if let code = self.extractQueryParam(url: callbackURL, param: "code") {
                    self.exchangeCodeForToken(code: code, clientId: iosClientId, redirectUri: redirectUri, verifier: verifier)
                }
            }
            self.webAuthSession?.presentationContextProvider = self
            self.webAuthSession?.start()
        }
        
        func exchangeCodeForToken(code: String, clientId: String, redirectUri: String, verifier: String) {
            let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
            var request = URLRequest(url: tokenEndpoint)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            
            let bodyParams = [
                "client_id": clientId,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirectUri,
                "code_verifier": verifier
            ]
            
            let bodyString = bodyParams.map { "\($0)=\($1)" }.joined(separator: "&")
            request.httpBody = bodyString.data(using: .utf8)
            
            let task = URLSession.shared.dataTask(with: request) { data, response, error in
                guard let data = data, error == nil else { return }
                
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let accessToken = json["access_token"] as? String {
                    self.injectTokenToWeb(token: accessToken)
                }
            }
            task.resume()
        }
        
        func generateCodeVerifier() -> String {
            var buffer = Array<UInt8>(repeating: 0, count: 32)
            _ = SecRandomCopyBytes(kSecRandomDefault, buffer.count, &buffer)
            return Data(buffer).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
                .trimmingCharacters(in: .whitespaces)
        }

        func generateCodeChallenge(verifier: String) -> String {
            guard let data = verifier.data(using: .ascii) else { return "" }
            let hash = SHA256.hash(data: data)
            return Data(hash).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
                .trimmingCharacters(in: .whitespaces)
        }
        
        func extractQueryParam(url: URL, param: String) -> String? {
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let items = components.queryItems else { return nil }
            return items.first(where: { $0.name == param })?.value
        }
        
        func injectTokenToWeb(token: String) {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: NSNotification.Name("InjectGoogleToken"), object: token)
            }
        }
        
        /// New windows. Only Apple Music's sign-in gets one: MusicKit JS opens it
        /// with window.open and waits for it to post the result back through
        /// window.opener, so it must be a real popup of this WebView. Handed to
        /// Safari it can never report back and the host stays signed out.
        /// Everything else has already gone to the system browser in
        /// decidePolicyFor above.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard AppleSignIn.isSignInPage(navigationAction.request.url),
                  CueVoteOrigin.isTrusted(navigationAction.sourceFrame),
                  let presenter = AppleSignIn.topViewController() else { return nil }
            // CueVote's bridge and marker script stay with CueVote.
            configuration.userContentController = WKUserContentController()
            let controller = AppleSignInController(configuration: configuration)
            presenter.present(controller, animated: true)
            return controller.webView
        }
        func webViewDidClose(_ webView: WKWebView) {}
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
    }
}
