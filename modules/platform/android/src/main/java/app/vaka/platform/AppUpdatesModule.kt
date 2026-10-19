package app.vaka.platform

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.github.expo.modules.v2.Event
import io.github.expo.modules.v2.ExpoModule
import io.github.expo.modules.v2.JS
import io.github.expo.modules.v2.Module
import io.github.expo.modules.v2.Record
import io.github.expo.modules.v2.react.androidContext
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** How an install is going, for `onInstallStatus`. */
@Record
data class InstallStatus(val status: String, val message: String?)

/**
 * Installs the app's own updates: checks a downloaded APK and hands it to Android's installer,
 * which asks the listener to confirm unless Android lets an app update itself without asking.
 */
@ExpoModule("AppUpdates")
class AppUpdatesModule : Module() {
  @Event(name = "onInstallStatus")
  private val onInstallStatus = event<InstallStatus>()

  init {
    InstallReceiver.listener = { status, message -> onInstallStatus(InstallStatus(status, message)) }
  }

  override fun onDestroy() {
    InstallReceiver.listener = null
  }

  /** The CPU architectures the phone runs, the one it prefers first. */
  @JS
  fun supportedAbis(): List<String> = Build.SUPPORTED_ABIS.toList()

  /** Whether the listener has let the app install apps, which updating itself needs. */
  @JS
  fun canInstall(): Boolean = androidContext.packageManager.canRequestPackageInstalls()

  /** Opens the system setting that lets the app install apps. */
  @JS
  fun openInstallSettings() {
    val intent = Intent(
      Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
      Uri.parse("package:${androidContext.packageName}")
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    androidContext.startActivity(intent)
  }

  /** A file's SHA-256 checksum in lowercase hex, read in chunks off the JavaScript thread. */
  @JS
  suspend fun sha256(uri: String): String = withContext(Dispatchers.IO) {
    val digest = MessageDigest.getInstance("SHA-256")

    fileOf(uri).inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)

      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }

    digest.digest().joinToString("") { "%02x".format(it) }
  }

  /** Hands an APK to Android's installer; how it goes arrives as `onInstallStatus` events. */
  @JS
  suspend fun install(uri: String): Unit = withContext(Dispatchers.IO) {
    val context = androidContext
    val file = fileOf(uri)
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(context.packageName)
      setSize(file.length())
      // Android 12 and later let an app update itself without asking, once it may install apps.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
      }
    }
    val sessionId = installer.createSession(params)

    try {
      installer.openSession(sessionId).use { session ->
        file.inputStream().use { input ->
          session.openWrite("update.apk", 0, file.length()).use { output ->
            input.copyTo(output)
            session.fsync(output)
          }
        }

        // Mutable, so the installer can add how the install went; explicit, so only it is told.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        val status = PendingIntent.getBroadcast(
          context,
          sessionId,
          Intent(context, InstallReceiver::class.java),
          flags
        )

        session.commit(status.intentSender)
      }
    } catch (error: Exception) {
      installer.abandonSession(sessionId)
      throw error
    }
  }

  private fun fileOf(uri: String) =
    File(Uri.parse(uri).path ?: throw IllegalArgumentException("Not a file: $uri"))
}
