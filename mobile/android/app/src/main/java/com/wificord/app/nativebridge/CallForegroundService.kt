package com.wificord.app.nativebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.wificord.app.MainActivity

class CallForegroundService : Service() {
    companion object { const val UPDATE = "com.wificord.CALL_UPDATE"; const val ID = 4101; const val CHANNEL = "wificord_active_call"; @Volatile var running = false; var projectionReady: (() -> Unit)? = null; var projectionFailed: (() -> Unit)? = null }
    private var muted = false
    private var camera = false
    private var projection = false
    override fun onCreate() { super.onCreate(); running = true }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) { stopSelf(); return START_NOT_STICKY }
        if (intent.action == "mute" || intent.action == "unmute" || intent.action == "leave") {
            WifiCordNativePlugin.callAction(intent.action!!)
            return START_NOT_STICKY
        }
        muted = intent.getBooleanExtra("muted", muted)
        camera = intent.getBooleanExtra("camera", camera)
        projection = intent.getBooleanExtra("projection", projection)
        val manager = (getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Chamada em andamento", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
        val open = PendingIntent.getActivity(this, ID, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        fun action(name: String, code: Int) = PendingIntent.getService(this, code,
            Intent(this, CallForegroundService::class.java).setAction(name), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle("WifiCord · chamada em andamento")
            .setContentText(if (muted) "Microfone silenciado" else "Microfone ativo")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .addAction(0, if (muted) "Desmutar" else "Mutar", action(if (muted) "unmute" else "mute", 1))
            .addAction(0, "Sair da chamada", action("leave", 2)).build()
        var types = 0
        if (Build.VERSION.SDK_INT >= 30) {
            types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (camera) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }
        if (Build.VERSION.SDK_INT >= 29 && projection) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        try { ServiceCompat.startForeground(this, ID, notification, types) }
        catch (_: Exception) {
            running = false
            val failed = projectionFailed; projectionReady = null; projectionFailed = null
            failed?.invoke(); WifiCordNativePlugin.serviceError(); stopSelf()
            return START_NOT_STICKY
        }
        if (projection) { val ready = projectionReady; projectionReady = null; ready?.invoke() }
        return START_NOT_STICKY
    }
    override fun onDestroy() { running = false; ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); super.onDestroy() }
}
