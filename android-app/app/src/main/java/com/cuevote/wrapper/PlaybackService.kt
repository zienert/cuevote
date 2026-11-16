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
// The service knows nothing about the page. MainActivity watches the page and
// reports what it finds: the channel sounding here (playing()), or this device
// being its player while nothing sounds (standingBy()). The service runs from
// the first report for as long as reports come, up to IDLE_LIMIT_MS off screen
// without playback; once they stop it is gone after GRACE_MS, and at once on
// stop(). It ends itself, so its notification cannot outlive whatever should
// have ended it.
//
// YouTube never gets here. Only an Apple Music player is reported, and
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
    // (GRACE_MS, IDLE_LIMIT_MS), so there is no timeout on the wake lock.
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
            .setColor(ACCENT_COLOR)
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
        // CueVote's orange (colorPrimary in themes.xml), behind the icon.
        private const val ACCENT_COLOR = 0xFFF97316.toInt()

        // How long the service outlives the last report from the page. Long
        // enough for a live player that says nothing for a moment: the gap
        // between two titles, a title that fails and is skipped, the page
        // reloading for a fresh token. A page that is gone, signed out or no
        // longer the channel's player says nothing at all, and the service
        // does not sit on it.
        const val GRACE_MS = 60_000L

        // How long the service stays off screen while this device is the
        // channel's player but nothing sounds: the channel is paused from
        // another device, or its queue is empty. The phone has to remain what
        // the channel plays on until the next play or the next title, and
        // awake: the page tells the server every few seconds that it can play,
        // and a player that falls silent loses the channel to the owner's next
        // device. It still ends, so a channel left paused does not keep the
        // device awake for good.
        const val IDLE_LIMIT_MS = 2 * 60 * 60 * 1000L

        // The channel should be kept going (the service runs or is starting).
        private var wanted = false
        // The service, once it is in the foreground.
        private var running: PlaybackService? = null
        // The service ends at the earlier of the two: GRACE_MS after the last
        // report, IDLE_LIMIT_MS after the channel last sounded or the app was
        // last on screen.
        private var heardUntil = 0L
        private var idleUntil = 0L
        private val deadline: Long get() = minOf(heardUntil, idleUntil)
        private var title = ""
        private var artist = ""

        // Called when the service is no longer keeping the channel going.
        var onStopped: (() -> Unit)? = null

        val isActive: Boolean get() = wanted

        // The channel sounds here right now.
        fun playing(context: Context, title: String, artist: String) {
            val now = SystemClock.elapsedRealtime()
            heardUntil = now + GRACE_MS
            idleUntil = now + IDLE_LIMIT_MS
            keep(context, title, artist)
        }

        // This device is the channel's player, but nothing sounds: the channel
        // is paused or has nothing to play. On screen the wait costs nothing,
        // so the idle limit counts from the moment the app left the screen.
        fun standingBy(context: Context, title: String, artist: String, onScreen: Boolean) {
            val now = SystemClock.elapsedRealtime()
            heardUntil = now + GRACE_MS
            if (onScreen) idleUntil = now + IDLE_LIMIT_MS
            keep(context, title, artist)
        }

        // The first report starts the service, which Android allows only
        // while the app is on screen (the caller sees to that); every further
        // one keeps it running.
        private fun keep(context: Context, title: String, artist: String) {
            // A player with nothing loaded names no title: the last one stays up.
            if (title.isNotEmpty() || !wanted) {
                this.title = title
                this.artist = artist
            }
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
