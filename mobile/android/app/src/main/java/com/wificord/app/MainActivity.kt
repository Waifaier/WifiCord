package com.wificord.app

import android.Manifest
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.getcapacitor.BridgeActivity
import com.wificord.app.push.WifiCordFirebaseMessagingService
import com.wificord.app.updater.UpdateCheckWorker
import com.wificord.app.updater.UpdateManager
import kotlinx.coroutines.launch
import com.wificord.app.nativebridge.WifiCordNativePlugin
import com.getcapacitor.BridgeWebChromeClient
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.content.res.Configuration
import androidx.activity.OnBackPressedCallback

class MainActivity : BridgeActivity() {
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var immersiveRequested = false
    private var fullscreenExit: (() -> Unit)? = null
    private val fullscreenBack = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() { fullscreenExit?.invoke() }
    }
    override fun setImmersive(enabled: Boolean) {
        immersiveRequested = enabled
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (enabled || fullscreenView != null) controller.hide(WindowInsetsCompat.Type.systemBars())
        else controller.show(WindowInsetsCompat.Type.systemBars())
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) setImmersive(immersiveRequested)
    }
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        WifiCordNativePlugin.resizeScreen()
        setImmersive(immersiveRequested)
    }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Tanto faz conceder ou negar — a permissão só controla se a
            // notificação PODE aparecer, não afeta registrar o token.
            WifiCordFirebaseMessagingService.syncTokenWithServer(applicationContext)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(WifiCordNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        // O APK não usa @capacitor/app. Encaminha o botão físico à navegação
        // real do cliente, sem finalizar a Activity nem interromper chamadas.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                bridge.webView.evaluateJavascript(
                    "(function(){if(window.WCMobileNavigation){window.WCMobileNavigation.back();}" +
                        "else if(document.fullscreenElement){document.exitFullscreen();}})();",
                    null
                )
            }
        })
        // Registrado depois: sair do vídeo em tela cheia tem prioridade.
        onBackPressedDispatcher.addCallback(this, fullscreenBack)
        // O cliente padrão do Capacitor 6 recusa CustomView. Mantém suas
        // permissões de mídia, mas implementa a apresentação em tela cheia.
        bridge.webView.webChromeClient = object : BridgeWebChromeClient(bridge) {
            override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return }
                fullscreenView = view; fullscreenCallback = callback
                fullscreenExit = { onHideCustomView() }; fullscreenBack.isEnabled = true
                bridge.webView.visibility = View.GONE
                (window.decorView as FrameLayout).addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                setImmersive(true)
            }
            override fun onHideCustomView() {
                fullscreenView?.let { (it.parent as? ViewGroup)?.removeView(it) }
                fullscreenView = null
                fullscreenExit = null; fullscreenBack.isEnabled = false
                bridge.webView.visibility = View.VISIBLE
                fullscreenCallback?.onCustomViewHidden(); fullscreenCallback = null
                setImmersive(false)
            }
        }

        requestNotificationPermissionIfNeeded()
        UpdateCheckWorker.schedulePeriodic(applicationContext)
        checkForUpdateInForeground()
        WifiCordFirebaseMessagingService.syncTokenWithServer(applicationContext)
    }

    override fun onResume() {
        super.onResume()
        // Cobre o caso mais comum de token nunca registrado: a pessoa abriu
        // o app pela primeira vez (onCreate rodou sem sessão ainda), fez
        // login, e só volta a passar por aqui quando reabre o app depois —
        // é nesse reabrir que finalmente existe cookie de sessão.
        WifiCordFirebaseMessagingService.syncTokenWithServer(applicationContext)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    /** Checa update assim que o app abre e, se tiver algo novo, mostra um
     * diálogo simples perguntando se quer baixar agora — sem precisar ir a
     * lugar nenhum fora do app. */
    private fun checkForUpdateInForeground() {
        lifecycleScope.launch {
            val release = UpdateManager.fetchLatestRelease() ?: return@launch
            if (!UpdateManager.isNewer(release)) return@launch
            if (isFinishing || isDestroyed) return@launch

            AlertDialog.Builder(this@MainActivity)
                .setTitle(getString(R.string.update_available_title))
                .setMessage(getString(R.string.update_available_message, release.versionName))
                .setPositiveButton(getString(R.string.update_download_now)) { _, _ ->
                    startDownloadFlow(release)
                }
                .setNegativeButton(getString(R.string.update_later), null)
                .setCancelable(true)
                .show()
        }
    }

    private fun startDownloadFlow(release: UpdateManager.ReleaseInfo) {
        // Pede a permissão de "instalar apps desconhecidos" ANTES de baixar
        // — não adianta baixar se depois o sistema for bloquear a instalação.
        if (!UpdateManager.canRequestPackageInstalls(this)) {
            startActivity(UpdateManager.requestInstallPermissionIntent(this))
            return
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        val label = TextView(this).apply { text = "0%" }
        val progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
        }
        container.addView(label)
        container.addView(progressBar)

        val progressDialog = AlertDialog.Builder(this)
            .setTitle(getString(R.string.update_downloading_title))
            .setView(container)
            .setCancelable(false)
            .show()

        lifecycleScope.launch {
            try {
                val file = UpdateManager.downloadApk(applicationContext, release) { progress ->
                    runOnUiThread {
                        if (progress >= 0f) {
                            val pct = (progress * 100).toInt()
                            progressBar.isIndeterminate = false
                            progressBar.progress = pct
                            label.text = "$pct%"
                        } else {
                            progressBar.isIndeterminate = true
                        }
                    }
                }
                progressDialog.dismiss()
                UpdateManager.installApk(applicationContext, file)
            } catch (e: Exception) {
                progressDialog.dismiss()
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(getString(R.string.update_download_failed))
                    .setPositiveButton("OK", null)
                    .show()
            }
        }
    }
}
