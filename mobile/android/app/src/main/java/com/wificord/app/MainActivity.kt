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

class MainActivity : BridgeActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Tanto faz conceder ou negar — a permissão só controla se a
            // notificação PODE aparecer, não afeta registrar o token.
            WifiCordFirebaseMessagingService.syncTokenWithServer(applicationContext)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
