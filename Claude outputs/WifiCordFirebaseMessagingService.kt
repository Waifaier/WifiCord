package com.wificord.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
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
 * manda quando chega uma ligação e a pessoa não está com nenhum socket
 * conectado no momento (app fechado ou tela bloqueada). Isso roda mesmo
 * com o app totalmente fechado — é o sistema Android que acorda esse
 * serviço, sem precisar do app estar aberto.
 *
 * Só funciona de verdade depois que mobile/android/app/google-services.json
 * for adicionado ao projeto (ver LEIA-ME de push) — sem ele, o Firebase
 * nunca entrega nada aqui, mas o app continua funcionando normal.
 */
class WifiCordFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val SERVER_BASE_URL = "https://wificord.onrender.com"
        private const val CHANNEL_ID = "wificord_incoming_calls"
        private val http = OkHttpClient()
    }

    // Token novo (primeira instalação ou renovação periódica do FCM) —
    // manda pro servidor guardar, associado à conta logada nessa WebView.
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        postToServer("/api/push/register", "{\"token\":\"${escape(token)}\",\"platform\":\"android\"}")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        if (data["type"] != "incoming_call") return

        val fromUserId = data["fromUserId"] ?: return
        val fromName = data["fromName"]?.takeIf { it.isNotBlank() } ?: "Alguém"
        val fromAvatar = data["fromAvatar"] ?: ""
        val callType = data["callType"] ?: "video"

        showIncomingCallNotification(fromUserId, fromName, fromAvatar, callType)
    }

    private fun showIncomingCallNotification(fromUserId: String, fromName: String, fromAvatarUrl: String, callType: String) {
        ensureChannel()

        val notificationId = fromUserId.hashCode()

        // Toque na notificação (ou no corpo dela) = abre o app normal. Ao
        // reconectar, o servidor reenvia a mesma oferta de chamada
        // pendente pro socket — a telinha de "fulano ligando" já existente
        // no app cuida do resto, sem precisar de nada especial aqui.
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val openAppPending = PendingIntent.getActivity(this, notificationId, openAppIntent, piFlags)

        val rejectIntent = Intent(this, CallRejectReceiver::class.java).apply {
            putExtra("fromUserId", fromUserId)
            putExtra("notificationId", notificationId)
        }
        val rejectPending = PendingIntent.getBroadcast(this, notificationId, rejectIntent, piFlags)

        val avatarBitmap = fromAvatarUrl.takeIf { it.isNotBlank() }?.let { downloadBitmap(it) }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
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

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val audioAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channel = NotificationChannel(CHANNEL_ID, "Ligações recebidas", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Avisa quando alguém te liga pelo WifiCord com o app fechado."
            setSound(ringtone, audioAttrs)
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun downloadBitmap(url: String): Bitmap? = try {
        URL(url).openStream().use { BitmapFactory.decodeStream(it) }
    } catch (_: Exception) {
        null
    }

    // Manda um POST autenticado pro servidor usando o mesmo cookie de
    // sessão que a WebView do app já tem — sem isso não daria pra provar
    // quem é a pessoa sem abrir o app inteiro de novo.
    private fun postToServer(path: String, jsonBody: String) {
        val cookie = CookieManager.getInstance().getCookie(SERVER_BASE_URL) ?: return
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
