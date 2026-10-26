package com.wificord.app.nativebridge

import android.content.Intent
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.wificord.app.BuildConfig
import com.wificord.app.MainActivity
import com.wificord.app.push.WifiCordFirebaseMessagingService
import java.lang.ref.WeakReference
import android.app.Activity
import android.media.projection.MediaProjectionManager
import android.content.Context
import android.util.DisplayMetrics
import androidx.activity.result.ActivityResult
import com.getcapacitor.annotation.ActivityCallback
import android.os.Looper

@CapacitorPlugin(name = "WifiCordNative")
class WifiCordNativePlugin : Plugin() {
    companion object {
        private var current = WeakReference<WifiCordNativePlugin>(null)
        @Volatile var foreground = false
        @Volatile var realtimeReady = false
        fun serviceError() {
            current.get()?.let { plugin -> plugin.activity.runOnUiThread {
                plugin.notifyListeners("serviceError", JSObject(), true)
            } }
        }
        fun resizeScreen() { current.get()?.resizeCapture() }
        fun callAction(action: String) {
            current.get()?.let { plugin ->
                plugin.activity.runOnUiThread {
                    plugin.notifyListeners("callAction", JSObject().put("action", action), true)
                }
            }
        }
    }
    private var immersive = false
    private var screen: NativeScreenSession? = null
    private var requestingScreen = false
    private fun captureSize(): Pair<Int, Int> {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        activity.windowManager.defaultDisplay.getRealMetrics(metrics)
        val pixels = (metrics.widthPixels.toDouble() * metrics.heightPixels).coerceAtLeast(1.0)
        val scale = minOf(1.0, kotlin.math.sqrt(921600.0 / pixels))
        return Pair(((metrics.widthPixels * scale).toInt() / 2 * 2).coerceAtLeast(2), ((metrics.heightPixels * scale).toInt() / 2 * 2).coerceAtLeast(2))
    }
    private fun resizeCapture() { val (width, height) = captureSize(); screen?.resize(width, height) }
    override fun load() { current = WeakReference(this) }
    private fun trusted(call: PluginCall): Boolean {
        // Os métodos Capacitor chegam pela thread do bridge; WebView e
        // janela só podem ser consultadas/alteradas na thread principal.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            activity.runOnUiThread {
                when (call.methodName) {
                    "setImmersive" -> setImmersive(call)
                    "syncPush" -> syncPush(call)
                    "setRealtime" -> setRealtime(call)
                    "updateCall" -> updateCall(call)
                    "startScreen" -> startScreen(call)
                    "answerScreen" -> answerScreen(call)
                    "stopScreen" -> stopScreen(call)
                    else -> call.reject("Método inválido")
                }
            }
            return false
        }
        val expected = Uri.parse(BuildConfig.SERVER_BASE_URL)
        val actual = Uri.parse(bridge.webView.url ?: "")
        if (actual.scheme != expected.scheme || actual.host != expected.host || actual.port != expected.port) {
            call.reject("Origem não autorizada"); return false
        }
        return true
    }
    private fun applyImmersive() {
        (activity as? MainActivity)?.let { it.setImmersive(immersive); return }
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars())
        else controller.show(WindowInsetsCompat.Type.systemBars())
    }
    @PluginMethod fun setImmersive(call: PluginCall) {
        if (!trusted(call)) return
        immersive = call.getBoolean("enabled", false) == true
        activity.runOnUiThread { applyImmersive(); call.resolve() }
    }
    @PluginMethod fun syncPush(call: PluginCall) {
        if (!trusted(call)) return
        WifiCordFirebaseMessagingService.syncTokenWithServer(context)
        call.resolve()
    }
    @PluginMethod fun setRealtime(call: PluginCall) {
        if (!trusted(call)) return
        realtimeReady = call.getBoolean("connected", false) == true
        call.resolve()
    }
    @PluginMethod fun updateCall(call: PluginCall) {
        if (!trusted(call)) return
        val active = call.getBoolean("active", false) == true
        val intent = Intent(context, CallForegroundService::class.java)
        if (!active) { screen?.stop(); screen = null; context.stopService(intent); call.resolve(); return }
        if (!foreground && !CallForegroundService.running) { call.reject("Abra o aplicativo para iniciar o serviço da chamada"); return }
        intent.action = CallForegroundService.UPDATE
        intent.putExtra("muted", call.getBoolean("muted", false))
        intent.putExtra("camera", call.getBoolean("camera", false))
        try { ContextCompat.startForegroundService(context, intent); call.resolve() }
        catch (e: Exception) { call.reject("Não foi possível manter a chamada em segundo plano", e) }
    }
    @PluginMethod fun startScreen(call: PluginCall) {
        if (!trusted(call)) return
        if (!foreground || !CallForegroundService.running) { call.reject("Entre na chamada com o aplicativo aberto antes de apresentar"); return }
        if (requestingScreen || screen != null) { call.reject("Já existe uma captura em andamento"); return }
        requestingScreen = true
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(call, manager.createScreenCaptureIntent(), "screenPermissionResult")
    }
    @ActivityCallback private fun screenPermissionResult(call: PluginCall?, result: ActivityResult) {
        requestingScreen = false
        if (call == null) return
        if (!CallForegroundService.running) { call.reject("A chamada terminou antes da autorização"); return }
        val grant = result.data
        if (result.resultCode != Activity.RESULT_OK || grant == null) { call.reject("Compartilhamento cancelado", "CAPTURE_CANCELLED"); return }
        val (width, height) = captureSize()
        val capture = NativeScreenSession(context.applicationContext, grant, width, height,
            offered = { id, sdp -> activity.runOnUiThread { call.resolve(JSObject().put("id", id).put("sdp", sdp)) } },
            failed = { message -> activity.runOnUiThread { call.reject(message) } },
            stopped = { id -> activity.runOnUiThread {
                if (screen?.id == id) screen = null
                CallForegroundService.projectionReady = null
                CallForegroundService.projectionFailed = null
                if (CallForegroundService.running) context.startService(Intent(context, CallForegroundService::class.java).setAction(CallForegroundService.UPDATE).putExtra("projection", false))
                notifyListeners("screenStopped", JSObject().put("id", id), true)
            } })
        screen = capture
        CallForegroundService.projectionReady = { capture.start() }
        CallForegroundService.projectionFailed = { capture.stop(); call.reject("O Android recusou o serviço de captura") }
        try { ContextCompat.startForegroundService(context, Intent(context, CallForegroundService::class.java).setAction(CallForegroundService.UPDATE).putExtra("projection", true)) }
        catch (e: Exception) { capture.stop(); call.reject("Não foi possível iniciar a captura", e) }
    }
    @PluginMethod fun answerScreen(call: PluginCall) {
        if (!trusted(call)) return
        val session = screen
        val sdp = call.getString("sdp")
        if (session == null || session.id != call.getString("id") || sdp.isNullOrBlank() || sdp.length > 100000) { call.reject("Sessão de captura inválida"); return }
        session.answer(sdp, { call.resolve() }, { call.reject(it) })
    }
    @PluginMethod fun stopScreen(call: PluginCall) {
        if (!trusted(call)) return
        if (screen?.id == call.getString("id")) { screen?.stop(); screen = null }
        call.resolve()
    }
    override fun handleOnResume() { foreground = true; applyImmersive() }
    override fun handleOnPause() { foreground = false }
    override fun handleOnDestroy() {
        foreground = false
        realtimeReady = false
        screen?.stop(); screen = null
        context.stopService(Intent(context, CallForegroundService::class.java))
        current.clear()
    }
}
