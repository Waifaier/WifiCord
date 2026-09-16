package com.wificord.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.wificord.app.MainActivity
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URL

/**
 * Recebe as notificações push (Firebase Cloud Messaging) que o servidor
 * manda quando chega uma ligação, mensagem ou aviso e a pessoa não está com
 * nenhum socket conectado no momento (app fechado ou tela bloqueada). Isso
 * roda mesmo com o app totalmente fechado — é o sistema Android que acorda
 * esse serviço, sem precisar do app estar aberto.
 *
 * Só funciona de verdade depois que mobile/android/app/google-services.json
 * for adicionado ao projeto E a variável FIREBASE_SERVICE_ACCOUNT_JSON
 * estiver configurada no servidor (ver LEIA-ME de push) — sem isso, o app
 * continua funcionando normal, só sem essas notificações.
 */
class WifiCordFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val SERVER_BASE_URL = "https://wificord.onrender.com"
        private const val CHANNEL_ID_CALLS = "wificord_incoming_calls"
        private const val CHANNEL_ID_MESSAGES = "wificord_messages"
        private const val CHANNEL_ID_ANNOUNCEMENTS = "wificord_announcements"
        private val http = OkHttpClient()

        /**
         * Pega o token FCM atual e garante que o servidor tem ele
         * registrado. Chamado em vários momentos (abrir o app, voltar pro
         * primeiro plano, ligar o celular) porque o único gatilho antigo
         * (onNewToken, que só dispara na instalação ou numa raríssima
         * renovação) não cobre o caso mais comum: o token já existir mas a
         * pessoa só ter logado DEPOIS, quando aquele primeiro envio já
         * tinha sido descartado silenciosamente por falta de cookie de
         * sessão.
         */
        fun syncTokenWithServer(context: Context) {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                registerTokenWithRetry(context.applicationContext, token, 0)
            }
        }

        private fun registerTokenWithRetry(context: Context, token: String, attempt: Int) {
            val cookie = CookieManager.getInstance().getCookie(SERVER_BASE_URL)
            if (cookie.isNullOrBlank()) {
                // Ainda não logou (ex: acabou de abrir o app pela primeira
                // vez) — tenta de novo por até 1 minuto, tempo mais que
                // suficiente pra alguém terminar de fazer login.
                if (attempt < 6) {
                    Handler(Looper.getMainLooper()).postDelayed({
                        registerTokenWithRetry(context, token, attempt + 1)
                    }, 10_000L)
                }
                return
            }
            postToServer(context, cookie, "/api/push/register", "{\"token\":\"${escape(token)}\",\"platform\":\"android\"}")
        }

        private fun postToServer(context: Context, cookie: String, path: String, jsonBody: String) {
            val body = jsonBody.toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url(SERVER_BASE_URL + path)
                .addHeader("Cookie", cookie)
                .post(body)
                .build()
            http.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { /* silencioso — tenta de novo no próximo evento */ }
                override fun onResponse(call: Call, response: okhttp3.Response) { response.close() }
            })
        }

        private fun escape(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")
    }

    // Token novo (primeira instalação ou renovação periódica do FCM).
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        syncTokenWithServer(applicationContext)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        when (data["type"]) {
            "incoming_call" -> {
                val fromUserId = data["fromUserId"] ?: return
                val fromName = data["fromName"]?.takeIf { it.isNotBlank() } ?: "Alguém"
                val fromAvatar = data["fromAvatar"] ?: ""
                val callType = data["callType"] ?: "video"
                showIncomingCallNotification(fromUserId, fromName, fromAvatar, callType)
            }
            "new_message" -> {
                val fromName = data["fromName"]?.takeIf { it.isNotBlank() } ?: "Alguém"
                val preview = data["preview"] ?: ""
                val channelName = data["channelName"]?.takeIf { it.isNotBlank() }
                val notificationKey = data["fromUserId"] ?: data["channelId"] ?: "msg"
                showMessageNotification(notificationKey, fromName, preview, channelName)
            }
            "announcement" -> {
                val title = data["title"]?.takeIf { it.isNotBlank() } ?: "Aviso do WifiCord"
                val body = data["message"] ?: ""
                showAnnouncementNotification(title, body)
            }
        }
    }

    private fun openAppPendingIntent(notificationId: Int): PendingIntent {
        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(this, notificationId, intent, flags)
    }

    private fun showIncomingCallNotification(fromUserId: String, fromName: String, fromAvatarUrl: String, callType: String) {
        ensureCallChannel()

        val notificationId = fromUserId.hashCode()
        val openAppPending = openAppPendingIntent(notificationId)

        val rejectIntent = Intent(this, CallRejectReceiver::class.java).apply {
            putExtra("fromUserId", fromUserId)
            putExtra("notificationId", notificationId)
        }
        val rejectPending = PendingIntent.getBroadcast(
            this, notificationId, rejectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val avatarBitmap = fromAvatarUrl.takeIf { it.isNotBlank() }?.let { downloadBitmap(it) }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID_CALLS)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("$fromName está ligando")
            .setContentText(if (callType == "audio") "Chamada de voz" else "Chamada de vídeo")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setOngoing(true)
            .setContentIntent(openAppPending)
            .setFullScreenIntent(openAppPending, true)
            .addAction(0, "Rejeitar", rejectPending)
            .addAction(0, "Aceitar", openAppPending)
            .setTimeoutAfter(45_000)

        if (avatarBitmap != null) builder.setLargeIcon(avatarBitmap)

        getSystemService(NotificationManager::class.java)?.notify(notificationId, builder.build())
    }

    private fun showMessageNotification(key: String, fromName: String, preview: String, channelName: String?) {
        ensureMessageChannel()
        val notificationId = ("msg-$key").hashCode()
        val openAppPending = openAppPendingIntent(notificationId)
        val title = if (channelName != null) "$fromName em #$channelName" else fromName
        val builder = NotificationCompat.Builder(this, CHANNEL_ID_MESSAGES)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openAppPending)
        getSystemService(NotificationManager::class.java)?.notify(notificationId, builder.build())
    }

    private fun showAnnouncementNotification(title: String, body: String) {
        ensureAnnouncementChannel()
        val notificationId = ("announcement-" + System.currentTimeMillis()).hashCode()
        val openAppPending = openAppPendingIntent(notificationId)
        val builder = NotificationCompat.Builder(this, CHANNEL_ID_ANNOUNCEMENTS)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppPending)
        getSystemService(NotificationManager::class.java)?.notify(notificationId, builder.build())
    }

    private fun ensureCallChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID_CALLS) != null) return
        val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val audioAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channel = NotificationChannel(CHANNEL_ID_CALLS, "Ligações recebidas", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Avisa quando alguém te liga pelo WifiCord com o app fechado."
            setSound(ringtone, audioAttrs)
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun ensureMessageChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID_MESSAGES) != null) return
        val channel = NotificationChannel(CHANNEL_ID_MESSAGES, "Mensagens", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Avisa quando chega uma mensagem nova pelo WifiCord com o app fechado."
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun ensureAnnouncementChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID_ANNOUNCEMENTS) != null) return
        val channel = NotificationChannel(CHANNEL_ID_ANNOUNCEMENTS, "Avisos do WifiCord", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Avisos da administração do WifiCord."
        }
        manager.createNotificationChannel(channel)
    }

    private fun downloadBitmap(url: String): Bitmap? = try {
        URL(url).openStream().use { BitmapFactory.decodeStream(it) }
    } catch (_: Exception) {
        null
    }
}
