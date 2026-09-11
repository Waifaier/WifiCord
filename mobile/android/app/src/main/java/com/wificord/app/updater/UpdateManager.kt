package com.wificord.app.updater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import com.wificord.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * Verifica, baixa e instala atualizações do APK direto dos Releases do
 * GitHub do próprio projeto — sem loja de aplicativos, sem servidor próprio.
 *
 * Como funciona (ver .github/workflows/android-release.yml pro outro lado
 * disso): toda vez que o workflow builda e assina um APK novo, ele cria um
 * Release no GitHub com:
 *  - tag_name = o versionCode (um número, ex: "7")
 *  - um asset cujo nome termina em ".apk"
 *
 * Esse updater só compara esse número com o BuildConfig.VERSION_CODE da
 * versão instalada — mais simples que manter um servidor de update separado,
 * e funciona em qualquer repositório público sem configuração extra.
 */
object UpdateManager {

    data class ReleaseInfo(
        val versionCode: Int,
        val versionName: String,
        val apkUrl: String,
        val apkSizeBytes: Long,
        val notes: String
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun apiUrl() = "https://api.github.com/repos/${BuildConfig.GITHUB_OWNER}/${BuildConfig.GITHUB_REPO}/releases/latest"

    /** Consulta o Release mais recente. Retorna null se não achar nada usável
     * (repositório sem releases ainda, sem asset .apk, rede fora do ar, etc). */
    suspend fun fetchLatestRelease(): ReleaseInfo? = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url(apiUrl())
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "WifiCord-Android-Updater")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                val json = JSONObject(body)
                val tagName = json.optString("tag_name", "")
                val versionCode = tagName.trim().toIntOrNull() ?: return@withContext null
                val versionName = json.optString("name", tagName).ifBlank { tagName }
                val notes = json.optString("body", "")
                val assets = json.optJSONArray("assets") ?: return@withContext null
                var apkUrl: String? = null
                var apkSize = 0L
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name", "")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        apkUrl = asset.optString("browser_download_url", null)
                        apkSize = asset.optLong("size", 0L)
                        break
                    }
                }
                val url = apkUrl ?: return@withContext null
                ReleaseInfo(versionCode, versionName, url, apkSize, notes)
            }
        } catch (e: Exception) {
            null
        }
    }

    fun isNewer(release: ReleaseInfo): Boolean = release.versionCode > BuildConfig.VERSION_CODE

    private fun updatesDir(context: Context): File {
        val dir = File(context.cacheDir, "updates")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /** Baixa o APK do Release pra dentro do cache do app, chamando
     * [onProgress] (0f..1f, ou -1f se o tamanho não for conhecido) enquanto
     * baixa. Lança exceção em caso de erro — quem chamar decide como avisar
     * o usuário. */
    suspend fun downloadApk(
        context: Context,
        release: ReleaseInfo,
        onProgress: (Float) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val outFile = File(updatesDir(context), "wificord-update.apk")
        val request = Request.Builder()
            .url(release.apkUrl)
            .header("User-Agent", "WifiCord-Android-Updater")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw java.io.IOException("HTTP ${response.code}")
            val bodyStream = response.body?.byteStream() ?: throw java.io.IOException("corpo vazio")
            val total = response.body?.contentLength() ?: release.apkSizeBytes
            FileOutputStream(outFile).use { out ->
                val buffer = ByteArray(64 * 1024)
                var downloaded = 0L
                while (true) {
                    val read = bodyStream.read(buffer)
                    if (read == -1) break
                    out.write(buffer, 0, read)
                    downloaded += read
                    if (total > 0) onProgress(downloaded.toFloat() / total.toFloat()) else onProgress(-1f)
                }
            }
        }
        outFile
    }

    /** true se o Android já deixa este app instalar pacotes de fora da Play
     * Store (permissão que precisa ser concedida manualmente, uma vez, a
     * partir do Android 8). */
    fun canRequestPackageInstalls(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else true
    }

    /** Abre a tela do sistema pra o usuário permitir "instalar apps
     * desconhecidos" vindo do WifiCord — só é pedida uma vez por instalação. */
    fun requestInstallPermissionIntent(context: Context): Intent {
        return Intent(
            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.packageName)
        )
    }

    /** Dispara o instalador do sistema com o APK baixado — o usuário só
     * confirma "Instalar", sem precisar desinstalar a versão antiga antes
     * (contanto que esteja assinado com a MESMA chave). */
    fun installApk(context: Context, file: File) {
        val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
    }
}
