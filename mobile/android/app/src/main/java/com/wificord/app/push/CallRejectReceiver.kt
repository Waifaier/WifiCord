package com.wificord.app.push

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.webkit.CookieManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * Botão "Rejeitar" da notificação de ligação recebida — dá pra recusar
 * direto dali, sem precisar nem abrir o app. Avisa o servidor (que por sua
 * vez avisa quem ligou) usando o mesmo cookie de sessão que a WebView do
 * app já guarda.
 */
class CallRejectReceiver : BroadcastReceiver() {

    companion object {
        private const val SERVER_BASE_URL = "https://wificord.onrender.com"
        private val http = OkHttpClient()
    }

    override fun onReceive(context: Context, intent: Intent) {
        val fromUserId = intent.getStringExtra("fromUserId")
        val notificationId = intent.getIntExtra("notificationId", 0)

        context.getSystemService(NotificationManager::class.java)?.cancel(notificationId)

        if (fromUserId.isNullOrBlank()) return
        val cookie = CookieManager.getInstance().getCookie(SERVER_BASE_URL) ?: return

        val pendingResult = goAsync()
        val body = "{\"fromUserId\":\"${fromUserId.replace("\"", "")}\"}".toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("$SERVER_BASE_URL/api/push/reject-call")
            .addHeader("Cookie", cookie)
            .post(body)
            .build()
        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { pendingResult.finish() }
            override fun onResponse(call: Call, response: okhttp3.Response) {
                response.close()
                pendingResult.finish()
            }
        })
    }
}
