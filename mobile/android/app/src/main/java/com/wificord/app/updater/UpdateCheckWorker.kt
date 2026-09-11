package com.wificord.app.updater

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.Constraints
import androidx.work.NetworkType
import com.wificord.app.MainActivity
import com.wificord.app.R
import java.util.concurrent.TimeUnit

/**
 * Confere periodicamente (mesmo com o app fechado) se tem uma versão nova do
 * APK no GitHub Releases e, se tiver, manda uma notificação — igual "tem
 * atualização disponível" de qualquer app de loja, só que puxando direto do
 * repositório em vez de uma loja de aplicativos.
 *
 * A checagem "de verdade" (baixar + instalar) acontece com o app aberto —
 * aqui só avisa que existe algo novo, o toque na notificação abre o app.
 */
class UpdateCheckWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    companion object {
        private const val UNIQUE_WORK_NAME = "wificord-update-check"
        private const val CHANNEL_ID = "wificord_updates"
        private const val NOTIFICATION_ID = 4821

        fun schedulePeriodic(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            // A cada 12h é suficiente pra "avisar logo" sem gastar bateria/
            // dados à toa — o WorkManager já espalha isso de forma
            // eficiente entre vários apps do aparelho.
            val request = PeriodicWorkRequestBuilder<UpdateCheckWorker>(12, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }

    override suspend fun doWork(): Result {
        val release = UpdateManager.fetchLatestRelease() ?: return Result.success()
        if (!UpdateManager.isNewer(release)) return Result.success()
        notifyUpdateAvailable(release.versionName)
        return Result.success()
    }

    private fun notifyUpdateAvailable(versionName: String) {
        val context = applicationContext
        ensureChannel(context)

        val openAppIntent = Intent(context, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            context, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(context.getString(R.string.update_notification_title))
            .setContentText(context.getString(R.string.update_notification_text) + " ($versionName)")
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS não concedida (Android 13+) — sem problema,
            // o usuário ainda vê o aviso na próxima vez que abrir o app.
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.update_channel_name),
                    NotificationManager.IMPORTANCE_DEFAULT
                )
                manager.createNotificationChannel(channel)
            }
        }
    }
}
