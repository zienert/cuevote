package com.cuevote.wrapper

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

// Keeps an Apple Music channel playing while the app is in the background or
// the screen is off. Without it Android cuts the app's network a few seconds
// after it leaves the screen (Android 15) and lets the device sleep: the title
// plays to the end of what was buffered and the next one never starts. A
// foreground service of type mediaPlayback, holding a wake lock and a Wi-Fi
// lock, is what Android expects of an app that plays music.
//
// The service knows nothing about the page. MainActivity watches MusicKit and
// reports every time it finds the channel playing (playing()); the service runs
// from the first report until none has come for GRACE_MS, or until stop(). It
// ends itself, so its notification cannot outlive whatever should have ended it.
//
// YouTube never gets here. Only MusicKit playing a full item is reported, and
// YouTube's terms do not allow playback in the background.
//
// All of it runs on the main thread.
class PlaybackService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var shown: Pair<String, String>? = null

    private val expiry = object : Runnable {
        override fun run() {
            val left = deadline - SystemClock.elapsedRealtime()
            if (left <= 0) stop() else handler.postDelayed(this, left)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android demands startForeground() for every startForegroundService(),
        // even when the channel has stopped in the meantime.
        try {
            createChannel()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION_ID, buildNotification())
            }
        } catch (e: Exception) {
            // Refused by Android (the app was no longer in the foreground): the
            // channel goes on as it would without this service.
            android.util.Log.w("CueVote", "Background playback not available: $e")
            stopSelf()
            if (wanted) {
                wanted = false
                onStopped?.invoke()
            }
            return START_NOT_STICKY
        }
        if (!wanted) {
            // Stopped before it got this far. Only this start is taken back:
            // the channel may have started playing again since, and that
            // start is then still on its way.
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        running = this
        acquireLocks()
        handler.removeCallbacks(expiry)
        expiry.run()
        return START_NOT_STICKY
    }

    // The app was swiped away: the page that played is gone with it.
    override fun onTaskRemoved(rootIntent: Intent?) {
        stop()
    }

    override fun onDestroy() {
        // Normally shutDown() has been here already. If Android ends the
        // service on its own, let go of everything just the same.
        handler.removeCallbacks(expiry)
        releaseLocks()
        if (running === this) {
            running = null
            if (wanted) {
                wanted = false
                onStopped?.invoke()
            }
        }
        super.onDestroy()
    }

    private fun shutDown() {
        if (running === this) running = null
        handler.removeCallbacks(expiry)
        releaseLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // Held exactly as long as the service runs, and the service ends itself
    // (GRACE_MS), so there is no timeout on the wake lock.
    @SuppressLint("WakelockTimeout")
    private fun acquireLocks() {
        try {
            if (wakeLock == null) {
                val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, LOCK_TAG).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
            if (wifiLock == null) {
                // Keeps Wi-Fi out of its power-saving mode with the screen off.
                // Android 14 and later no longer honour that; there the lock
                // costs nothing and does nothing.
                val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                @Suppress("DEPRECATION")
                wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, LOCK_TAG)?.apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("CueVote", "Could not hold the device awake: $e")
        }
    }

    private fun releaseLocks() {
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) { /* already released */ }
        try { wifiLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) { /* already released */ }
        wakeLock = null
        wifiLock = null
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.playback_channel_name), NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    // Title and artist only, and a tap brings the app back. No play or pause
    // button: the channel is steered by the page, and the wrapper has no
    // command for it.
    private fun buildNotification(): Notification {
        shown = title to artist
        // The activity that is already there, not a second one on top of it.
        val open = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // The wrapper has no translations of its own, so the notification has
        // no words of its own either: names only.
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_playing)
            .setContentTitle(title.ifEmpty { getString(R.string.app_name) })
            .setContentText(artist.ifEmpty { getString(R.string.playback_channel_name) })
            .setContentIntent(tap)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun showNotification(force: Boolean) {
        if (!force && shown == title to artist) return
        try {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
        } catch (_: Exception) {
            // Only the text stays behind.
        }
    }

    companion object {
        private const val CHANNEL_ID = "playback"
        private const val NOTIFICATION_ID = 1
        private const val LOCK_TAG = "CueVote:playback"

        // How long the service outlives the last report of a playing channel.
        // Long enough for what happens inside a playing channel: the gap
        // between two titles, a title that fails and is skipped, a stall, the
        // page reloading for a fresh token, a ringing phone. Short enough that
        // a paused channel does not keep the device awake or its notification
        // up for long.
        const val GRACE_MS = 60_000L

        // The channel should be kept playing (the service runs or is starting).
        private var wanted = false
        // The service, once it is in the foreground.
        private var running: PlaybackService? = null
        private var deadline = 0L
        private var title = ""
        private var artist = ""

        // Called when the service is no longer keeping the channel playing.
        var onStopped: (() -> Unit)? = null

        val isActive: Boolean get() = wanted

        // The channel is playing right now. The first report starts the
        // service, which Android allows only while the app is on screen;
        // every further one keeps it running.
        fun playing(context: Context, title: String, artist: String) {
            deadline = SystemClock.elapsedRealtime() + GRACE_MS
            this.title = title
            this.artist = artist
            if (wanted) {
                running?.showNotification(force = false)
                return
            }
            wanted = true
            try {
                ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
            } catch (e: Exception) {
                android.util.Log.w("CueVote", "Background playback not available: $e")
                wanted = false
            }
        }

        // Shows the notification again, for when it may have been hidden so
        // far (the permission was just given).
        fun refreshNotification() {
            running?.showNotification(force = true)
        }

        // Ends it at once: the channel was left or the app is closing.
        fun stop() {
            if (!wanted) return
            wanted = false
            // Not in the foreground yet: onStartCommand ends it, after the
            // startForeground() it owes Android.
            running?.shutDown()
            onStopped?.invoke()
        }
    }
}
