package com.cuevote.wrapper

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import android.content.Context
import android.webkit.JavascriptInterface
import android.widget.FrameLayout
import android.view.Gravity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.app.UiModeManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

import androidx.annotation.Keep

import android.os.Message
import android.app.Dialog
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.material.floatingactionbutton.FloatingActionButton

// The origins this wrapper will load. Everything else belongs in the system
// browser: the app has no address bar, so a foreign page here is
// indistinguishable from CueVote, and window.CueVoteAndroid is injected into
// whatever document happens to be loaded.
private val CUEVOTE_HOSTS = setOf("cuevote.com", "www.cuevote.com")

private fun isCueVoteUrl(uri: android.net.Uri?): Boolean {
    if (uri == null) return false
    return uri.scheme?.lowercase() == "https" && uri.host?.lowercase() in CUEVOTE_HOSTS
}

private fun isCueVoteUrl(url: String?): Boolean =
    if (url.isNullOrBlank()) false
    else try { isCueVoteUrl(android.net.Uri.parse(url)) } catch (_: Exception) { false }

// Apple Music's sign-in. MusicKit JS opens it with window.open and waits for the
// popup to post the result back to window.opener, so it has to run as a real
// popup of this WebView: handed to the system browser, it can never report back
// and the host stays signed out.
private fun isAppleSignInUrl(uri: android.net.Uri?): Boolean =
    uri != null && uri.scheme?.lowercase() == "https" &&
        uri.host?.lowercase() == "authorize.music.apple.com"

// The pages that sign-in moves through: Apple ID, two-factor, password reset.
private fun isApplePage(uri: android.net.Uri?): Boolean {
    if (uri == null || uri.scheme?.lowercase() != "https") return false
    val host = uri.host?.lowercase() ?: return false
    return host == "apple.com" || host.endsWith(".apple.com")
}

// How long a page gets to unload before its WebView is destroyed.
private const val PAGE_UNLOAD_MS = 500L

// How often the page is asked whether its Apple Music channel is playing.
private const val PLAYBACK_PROBE_MS = 1000L

// How long a page has to be open before what plays on it counts. Leaving a
// channel changes the address at once, while MusicKit takes a moment to stop:
// without this, the last second of the channel just left would start the
// service again on the page after it.
private const val PAGE_SETTLE_MS = 3000L

private const val REQUEST_NOTIFICATIONS = 1

// Asks the page about the Apple Music player on it. Null when there is none
// that could play a channel: no MusicKit (a YouTube channel has none), a
// guest's preview player (previewOnly), or one that is signed out and silent.
// Otherwise:
//   playing        MusicKit sounds a full title here
//   marked         the page says this device is the channel's player, sounding
//                  or not: data-apple-player on <html>, set by web clients that
//                  know of it. A frame cannot set it.
//   youtube        there is a YouTube player on the page
//   title, artist  of what MusicKit plays or has loaded
private const val PLAYBACK_PROBE_JS = """
(function () {
  try {
    var music = window.MusicKit && MusicKit.getInstance();
    if (!music || music.previewOnly) return null;
    var item = music.nowPlayingItem;
    var playing = !!item && music.playbackState === MusicKit.PlaybackStates.playing;
    if (!playing && !music.isAuthorized) return null;
    if (!item && music.queue && music.queue.items) item = music.queue.items[0];
    var mark = document.documentElement.getAttribute('data-apple-player');
    return {
      playing: playing,
      marked: mark === 'playing' || mark === 'paused',
      youtube: !!document.querySelector('iframe[src*="youtube"]'),
      title: item ? String(item.title || '') : '',
      artist: item ? String(item.artistName || '') : ''
    };
  } catch (e) {
    return null;
  }
})()
"""

// What the probe found on the page.
private class ApplePlayer(val playing: Boolean, val marked: Boolean, val youtube: Boolean, val title: String, val artist: String)

class MainActivity : AppCompatActivity(), QRScannerBottomSheet.QRScanListener {

    private lateinit var webView: WebView
    private lateinit var fab: FloatingActionButton
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var wasOffline = false
    private var reconnectHandler: android.os.Handler? = null
    private var reconnectRunnable: Runnable? = null

    // User agent for Apple's sign-in page: the WebView's own, minus the WebView marker.
    private var appleUserAgent: String? = null

    // The Apple Music sign-in currently on screen, if any.
    internal var appleSignIn: AppleSignInWindow? = null

    // Whether this device has any camera (front, back, or external/USB). Since the TV
    // change relaxed the camera uses-features to required="false", the app also installs
    // on camera-less devices (Android TV, some Wi-Fi tablets). The QR scanner needs a live
    // camera, so it must be suppressed on these devices rather than opening a dead preview.
    // Evaluated once — camera hardware does not change at runtime.
    private val hasCamera: Boolean by lazy {
        packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }

    // An Apple Music channel that this device plays goes on in the background,
    // and stays ready there while it is paused (see PlaybackService). Android
    // lets that service start only while the app is on screen, so whether this
    // device is the channel's player has to be known before the app leaves it:
    // the page is asked every second while the app is on screen, and on for as
    // long as the service runs.
    //
    // It is asked through evaluateJavascript, which runs in the main frame.
    // The CueVoteAndroid interface would be the wrong way: it is reachable from
    // every frame, the YouTube player included, and no frame may switch
    // background playback on.
    private var isTelevision = false
    private var resumed = false
    private var probing = false
    private val playbackHandler = Handler(Looper.getMainLooper())
    private val playbackProbe = object : Runnable {
        override fun run() {
            playbackHandler.postDelayed(this, PLAYBACK_PROBE_MS)
            probePlayback()
        }
    }
    // The page being watched, and since when. Playback belongs to one page:
    // when the address changes, the channel has been left.
    private var watchedUrl: String? = null
    private var watchedSince = 0L
    // Whether this page has marked its player (see PLAYBACK_PROBE_JS). A page
    // that does is taken at its word from then on; one that never does comes
    // from a web client without the mark.
    private var markSeen = false
    private var askedForNotifications = false

    // The service gave up while the app is in the background: from here on the
    // page is paused like any other.
    private val onPlaybackServiceStopped: () -> Unit = {
        if (!resumed && ::webView.isInitialized) pauseWebView()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep Screen On
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        PlaybackService.onStopped = onPlaybackServiceStopped

        // 1. Setup Layout Container (FrameLayout)
        val container = FrameLayout(this)
        container.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )

        // 2. Create WebView programmatically
        webView = WebView(this)
        // Enable Debugging only in Debug builds
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )
        
        // Configure Settings
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // CRITICAL: Allow autoplay without user gesture
            mediaPlaybackRequiresUserGesture = false 
            
            // Layout settings
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            
            // Popup settings
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            
            cacheMode = WebSettings.LOAD_DEFAULT

            // Custom User Agent for detection
            val defaultUserAgent = userAgentString
            val sanitizedUserAgent = defaultUserAgent.replace("; wv", "")
            val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
            isTelevision = uiModeManager.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
            val tvSuffix = if (isTelevision) " AndroidTV" else ""
            userAgentString = "$sanitizedUserAgent CueVoteWrapper/1.0$tvSuffix"
            appleUserAgent = sanitizedUserAgent
        }

        // 3. Inject Offline Layout
        val inflater = android.view.LayoutInflater.from(this)
        val offlineView = inflater.inflate(R.layout.layout_offline, container, false)
        offlineView.visibility = android.view.View.GONE
        container.addView(offlineView)
        
        // 4. Inject Loading Layout
        val loadingView = inflater.inflate(R.layout.layout_loading, container, false)
        loadingView.visibility = android.view.View.VISIBLE // Show initially
        container.addView(loadingView)
        
        // Retry Button Logic
        val btnRetry = offlineView.findViewById<android.widget.Button>(R.id.btn_retry)
        btnRetry.setOnClickListener {
            offlineView.visibility = android.view.View.GONE
             loadingView.visibility = android.view.View.VISIBLE // Show loader
            webView.visibility = android.view.View.VISIBLE
            webView.reload()
        }

        // Web Client to keep links internal & Handle Errors
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // Sub-frames (the YouTube player) are the page's own business and
                // are governed by the server's CSP; only main-frame navigation is
                // gated here.
                if (request?.isForMainFrame != true) return false
                if (isCueVoteUrl(request.url)) return false

                // Same routing as onCreateWindow below, which already did this for
                // popups: hand it to the system browser, where the user can see
                // the real origin and the JS interface does not exist.
                this@MainActivity.openExternally(request.url)
                return true
            }
            
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Hide Loader when done
                loadingView.visibility = android.view.View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return
                runOnUiThread {
                    loadingView.visibility = android.view.View.GONE
                    webView.visibility = android.view.View.GONE
                    offlineView.visibility = android.view.View.VISIBLE
                }
            }
        }

        // Web Chrome Client for Popups
        //
        // Popups are intercepted: everything (legal links, YouTube, Google
        // docs) is handed to the system browser, except Apple Music's sign-in,
        // which opens in a window of its own (see AppleSignInWindow). Previously
        // every popup landed in a full-screen dialog WebView that would happily
        // load any URL — a compromised first-party page could have used it to
        // load an attacker-controlled origin with the CueVoteWrapper user-agent
        // in front of the user.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean {
                val message = resultMsg ?: return false
                val transport = message.obj as? WebView.WebViewTransport ?: return false
                // The popup's first navigation decides what it becomes. Until
                // then it is never attached to the view hierarchy; anything but
                // Apple's sign-in goes to the system browser and the WebView is
                // destroyed. It never gets the CueVoteAndroid interface.
                val popup = WebView(this@MainActivity)
                popup.settings.apply {
                    // Apple's sign-in is a script-driven page, and like CueVote
                    // it should see a plain Chrome rather than a WebView.
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    userAgentString = appleUserAgent
                }
                var signIn: AppleSignInWindow? = null
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        val url = request?.url
                        val window = signIn
                        if (window == null) {
                            if (isAppleSignInUrl(url) && isCueVoteUrl(webView.url)) {
                                signIn = AppleSignInWindow(this@MainActivity, popup).also { it.show() }
                                return false
                            }
                            this@MainActivity.openExternally(url)
                            popup.destroy()
                            return true
                        }
                        // Inside the sign-in, Apple's own pages only.
                        if (request?.isForMainFrame != true || isApplePage(url)) return false
                        this@MainActivity.openExternally(url)
                        return true
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                        super.onPageStarted(view, url, favicon)
                        signIn?.showAddress(url)
                    }
                }
                popup.webChromeClient = object : WebChromeClient() {
                    // Apple's page closes itself once MusicKit has the result.
                    override fun onCloseWindow(window: WebView?) {
                        val open = signIn
                        if (open != null) open.close() else popup.destroy()
                    }
                }
                transport.webView = popup
                message.sendToTarget()
                return true
            }

            // Apple Music's full songs are DRM-protected (Widevine); without this
            // grant MusicKit gets no license and nothing but previews would play.
            // Granted to CueVote's own pages only, and nothing else is.
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val wanted = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                if (isCueVoteUrl(request.origin) && request.resources.contains(wanted)) {
                    request.grant(arrayOf(wanted))
                } else {
                    request.deny()
                }
            }
        }

        // Inject JS Interface for Detection
        // webView.addJavascriptInterface(...) -> Moved down to have access to FAB

        // Load the production URL
        webView.loadUrl("https://cuevote.com")

        // Add WebView to container
        container.addView(webView)

        // 4. Create Floating Action Button (QR Scan)
        fab = FloatingActionButton(this)
        val fabParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        )
        // Revert to Bottom Right (Standard)
        fabParams.gravity = Gravity.BOTTOM or Gravity.END 
        fabParams.setMargins(0, 0, 40, 40) // Bottom-Right Margin
        fab.layoutParams = fabParams
        
        // Style the FAB
        fab.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FF8C00")) // Orange
        // Use custom QR Icon
        fab.setImageResource(R.drawable.ic_qr_code)
        
        // Initially HIDDEN
        fab.visibility = android.view.View.GONE
        
        fab.setOnClickListener {
            startQRScan()
        }

        container.addView(fab)

        // Set Content View
        setContentView(container)
        
        // Pass WebView and FAB reference to Interface
        webView.addJavascriptInterface(WebAppInterface(this, webView, fab, hasCamera), "CueVoteAndroid")
        // Handle Back Press properly
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        reconnectHandler = android.os.Handler(mainLooper)
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (::webView.isInitialized) {
                        offlineView.visibility = android.view.View.GONE
                        webView.visibility = android.view.View.VISIBLE
                        // Only reconnect if we were actually offline, debounced
                        if (wasOffline) {
                            wasOffline = false
                            reconnectRunnable?.let { reconnectHandler?.removeCallbacks(it) }
                            val runnable = Runnable {
                                webView.evaluateJavascript("window.cuevoteReconnect && window.cuevoteReconnect()", null)
                            }
                            reconnectRunnable = runnable
                            reconnectHandler?.postDelayed(runnable, 1000)
                        }
                    }
                }
            }
            override fun onLost(network: Network) {
                runOnUiThread {
                    // Only show offline if no other network is available
                    val activeNetwork = cm.activeNetwork
                    val capabilities = activeNetwork?.let { cm.getNetworkCapabilities(it) }
                    if (capabilities == null || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                        wasOffline = true
                        if (::webView.isInitialized) {
                            offlineView.visibility = android.view.View.VISIBLE
                        }
                    }
                }
            }
        }
        cm.registerNetworkCallback(request, networkCallback!!)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (::webView.isInitialized) {
            webView.onResume()
            webView.evaluateJavascript("window.cuevoteReconnect && window.cuevoteReconnect()", null)
            startPlaybackProbe()
            // Back from the system settings, where notifications may just have
            // been switched on: one posted before that was dropped.
            PlaybackService.refreshNotification()
        }
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        if (::webView.isInitialized) {
            // An Apple Music channel that this device plays goes on in the
            // background, and its page has to stay live for that. Everything
            // else, YouTube above all, is paused as it always was.
            if (!PlaybackService.isActive) pauseWebView()
        }
    }

    private fun pauseWebView() {
        stopPlaybackProbe()
        webView.onPause()
    }

    private fun startPlaybackProbe() {
        // Not on a TV: nothing there turns the screen off or leaves the app
        // while a channel plays.
        if (isTelevision || probing) return
        probing = true
        playbackProbe.run()
    }

    private fun stopPlaybackProbe() {
        probing = false
        playbackHandler.removeCallbacks(playbackProbe)
    }

    private fun probePlayback() {
        val url = webView.url
        if (url != watchedUrl) {
            // Another page: whatever played has been left. No grace period.
            watchedUrl = url
            watchedSince = SystemClock.elapsedRealtime()
            markSeen = false
            PlaybackService.stop()
        }
        if (!isCueVoteUrl(url)) return
        webView.evaluateJavascript(PLAYBACK_PROBE_JS) { result ->
            // Stopped or moved on since it was asked: the next probe looks again.
            if (!probing || webView.url != url) return@evaluateJavascript
            if (SystemClock.elapsedRealtime() - watchedSince < PAGE_SETTLE_MS) return@evaluateJavascript
            // No Apple player on the page: a service that runs gives up after
            // its grace period.
            val player = parseApplePlayer(result) ?: return@evaluateJavascript
            // Nothing goes on in the background on a page with a YouTube
            // player, whatever else is on it.
            if (player.youtube) {
                PlaybackService.stop()
                return@evaluateJavascript
            }
            if (player.marked) markSeen = true
            // This device is the channel's player although nothing sounds
            // (paused, or nothing to play): the page says so itself, or, on a
            // web client without the mark, MusicKit is still signed in on the
            // page that played.
            val standingBy = !player.playing && (player.marked || !markSeen)
            if (!player.playing && !standingBy) return@evaluateJavascript
            // Android lets the service start only while the app is on screen.
            // It starts on sound or on the page's own word, never on a guess.
            if (!PlaybackService.isActive && !(resumed && (player.playing || player.marked))) return@evaluateJavascript
            if (player.playing) PlaybackService.playing(this, player.title, player.artist)
            else PlaybackService.standingBy(this, player.title, player.artist, onScreen = resumed)
            askForNotificationsOnce()
        }
    }

    // The probe's answer, with title and artist ready for the notification.
    private fun parseApplePlayer(result: String?): ApplePlayer? {
        if (result.isNullOrEmpty() || result == "null") return null
        return try {
            val found = org.json.JSONObject(result)
            ApplePlayer(
                playing = found.optBoolean("playing"),
                marked = found.optBoolean("marked"),
                youtube = found.optBoolean("youtube"),
                title = notificationText(found.optString("title")),
                artist = notificationText(found.optString("artist")),
            )
        } catch (_: org.json.JSONException) {
            null
        }
    }

    // Text from the page, on its way into a notification: one plain, short line.
    private fun notificationText(text: String): String =
        text.filterNot { it.isISOControl() }.trim().take(120)

    // Android 13 and later show no notification until the user has allowed it.
    // The service runs either way, but its notification is how the user sees
    // what plays and gets back to the app, so it is asked for: once per start,
    // at the moment this device plays an Apple Music channel, and never again
    // after a "no" (which Android reports as wanting an explanation).
    private fun askForNotificationsOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || askedForNotifications || !resumed) return
        askedForNotifications = true
        val permission = Manifest.permission.POST_NOTIFICATIONS
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) return
        if (shouldShowRequestPermissionRationale(permission)) return
        requestPermissions(arrayOf(permission), REQUEST_NOTIFICATIONS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Posted before the permission was there, the notification was dropped.
        if (requestCode == REQUEST_NOTIFICATIONS) PlaybackService.refreshNotification()
    }

    override fun onDestroy() {
        // The page that played goes with the activity.
        if (PlaybackService.onStopped === onPlaybackServiceStopped) PlaybackService.onStopped = null
        stopPlaybackProbe()
        PlaybackService.stop()
        appleSignIn?.close()
        reconnectRunnable?.let { reconnectHandler?.removeCallbacks(it) }
        reconnectHandler = null
        networkCallback?.let {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.unregisterNetworkCallback(it)
        }
        // End the page with the activity. A WebView that is only dropped lives
        // on as long as the process does, and plays on. That used to be moot:
        // swiping the app away killed the process on the spot. With the
        // playback service running at that moment Android lets the process
        // live, and the channel was heard for seconds after the app was gone.
        //
        // The page is unloaded first, the way a browser tab closes. Destroyed
        // under a playing page, MusicKit takes the loss of its player for a
        // playback error and reports it while it still can, and the server
        // pauses the channel over a problem that is none. A page that simply
        // goes leaves the channel waiting for its host, to play on when the
        // app is opened again.
        if (::webView.isInitialized) {
            val page = webView
            (page.parent as? ViewGroup)?.removeView(page)
            page.stopLoading()
            page.loadUrl("about:blank")
            playbackHandler.postDelayed({ page.destroy() }, PAGE_UNLOAD_MS)
        }
        super.onDestroy()
    }

    private fun startQRScan() {
        // Defensive: the FAB is already withheld from camera-less devices (see
        // WebAppInterface.toggleQRButton), so this path should be unreachable there. If it
        // is somehow reached, no-op instead of opening the scanner against hardware that
        // does not exist. Deliberately no user-facing string — the wrapper has no native
        // i18n, and all localized copy lives in the web layer's translation system.
        if (!hasCamera) {
            android.util.Log.w("CueVote", "QR scan requested on a device without a camera; ignoring")
            return
        }
        val scannerFragment = QRScannerBottomSheet()
        scannerFragment.show(supportFragmentManager, "QRScanner")
    }

    // Hand a URL to whatever app the system has for it.
    //
    // Restricted to schemes a web page may legitimately link to. Firing
    // ACTION_VIEW for anything at all would let a page in the WebView reach
    // arbitrary other apps by their custom scheme.
    internal fun openExternally(uri: android.net.Uri?) {
        if (uri == null) return
        when (uri.scheme?.lowercase()) {
            "http", "https", "mailto", "tel" -> {}
            else -> return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (_: Exception) {
            // No app installed for it — silently drop.
        }
    }

    // QRScanListener Implementation
    override fun onScanComplete(contents: String) {
        var finalUrl: String? = null

        // 1. Check if it's a URL
        if (contents.startsWith("http://") || contents.startsWith("https://")) {
            try {
                val uri = android.net.Uri.parse(contents)
                // A QR code is attacker-supplied input — same allowlist the
                // WebView enforces, so a scan cannot be what loads a foreign
                // origin next to the JS interface.
                if (isCueVoteUrl(uri)) {
                    finalUrl = contents
                } else {
                     android.widget.Toast.makeText(this, "Invalid QR Code: Domain not trusted", android.widget.Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
               // Invalid URI
            }
        }

        finalUrl?.let {
            // webView.loadUrl triggers a full page reload, which tears down the JS
            // context before the Lobby useEffect cleanup can call toggleQRButton(false).
            // Hide the FAB from Kotlin so it doesn't linger over the room view.
            fab.hide()
            webView.loadUrl(it)
        }
    }

    override fun onScanCancelled() {
        // Handle cancellation if needed
    }

    // Removed onActivityResult as we don't use IntentIntegrator anymore
}

// Apple Music's sign-in, shown over CueVote in a window of its own: a bar with
// the address of the page and a close button, Apple's page underneath. The page
// is a popup of CueVote's WebView, so MusicKit gets its answer the regular way.
// Closing the window cancels the sign-in: the popup is destroyed, MusicKit sees
// its window closed and stops waiting.
internal class AppleSignInWindow(
    private val activity: MainActivity,
    private val popup: WebView,
) {
    private val dialog = Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar)
    private val address = TextView(activity)
    private var destroyed = false

    init {
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        address.apply {
            setTextColor(Color.parseColor("#A3A3A3"))
            textSize = 14f
            gravity = Gravity.CENTER_VERTICAL
            isSingleLine = true
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val close = ImageButton(activity).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(Color.TRANSPARENT)
            // The wrapper has no translations of its own; the system's word is localized.
            contentDescription = activity.getString(android.R.string.cancel)
            setOnClickListener { dialog.dismiss() }
        }
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0A0A0A"))
            setPadding(dp(16), 0, dp(4), 0)
            addView(address, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
            addView(close, LinearLayout.LayoutParams(dp(48), dp(48)))
        }
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
            addView(popup, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        dialog.setContentView(root)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        // Back walks Apple's pages first, then cancels.
        dialog.setOnKeyListener { _, keyCode, event ->
            if (keyCode != KeyEvent.KEYCODE_BACK) return@setOnKeyListener false
            if (event.action == KeyEvent.ACTION_UP) {
                if (popup.canGoBack()) popup.goBack() else dialog.dismiss()
            }
            true
        }
        dialog.setOnDismissListener {
            if (activity.appleSignIn === this) activity.appleSignIn = null
            destroyPopup()
        }
    }

    fun show() {
        if (activity.isFinishing || activity.isDestroyed) {
            destroyPopup()
            return
        }
        activity.appleSignIn?.close()
        activity.appleSignIn = this
        dialog.show()
    }

    fun showAddress(url: String?) {
        address.text = try { android.net.Uri.parse(url).host } catch (_: Exception) { null } ?: ""
    }

    fun close() {
        if (dialog.isShowing) dialog.dismiss() else destroyPopup()
    }

    private fun destroyPopup() {
        if (destroyed) return
        destroyed = true
        (popup.parent as? ViewGroup)?.removeView(popup)
        popup.stopLoading()
        popup.destroy()
    }
}

@Keep
class WebAppInterface(
    private val mContext: Context,
    private val webView: WebView,
    private val fab: FloatingActionButton,
    private val hasCamera: Boolean
) {
    @JavascriptInterface
    fun isNative(): Boolean {
        return true
    }

    @JavascriptInterface
    fun toggleQRButton(show: Boolean) {
        val activity = mContext as? MainActivity ?: return
        activity.runOnUiThread {
            // addJavascriptInterface is not origin-bound — the object is exposed
            // to whatever document is loaded, so the check belongs here.
            if (!isCueVoteUrl(webView.url)) return@runOnUiThread

            // Only surface the scan button where a camera exists. The web layer requests it
            // without knowing the hardware; withholding it here keeps camera-less devices
            // (Android TV, some tablets) from opening a scanner that cannot work — and adds
            // no native string, so the wrapper's lack of i18n is not a concern.
            if (show && hasCamera) {
                fab.show()
            } else {
                fab.hide()
            }
        }
    }
}
