package com.wificord.app.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Assim que o celular liga, garante que o token de notificação push esteja
 * registrado no servidor — assim, mesmo que o WifiCord nunca seja aberto
 * depois do boot, uma ligação/mensagem/aviso ainda consegue "acordar" o
 * app via notificação. (O Android não deixa nenhum app comum abrir a
 * própria tela sozinho no boot, por privacidade/bateria — isso aqui só
 * deixa o mecanismo de notificação pronto pra funcionar na hora que
 * precisar, sem precisar abrir o app manualmente primeiro.)
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        WifiCordFirebaseMessagingService.syncTokenWithServer(context.applicationContext)
    }
}
