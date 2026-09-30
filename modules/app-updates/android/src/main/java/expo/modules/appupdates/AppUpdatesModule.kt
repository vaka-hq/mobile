package expo.modules.appupdates

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest

/**
 * Installs the app's own updates: checks a downloaded APK and hands it to Android's installer,
 * which asks the listener to confirm unless Android lets an app update itself without asking.
 */
class AppUpdatesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AppUpdates")

    Events("onInstallStatus")

    OnCreate {
      InstallReceiver.listener = { status, message ->
        sendEvent("onInstallStatus", mapOf("status" to status, "message" to message))
      }
    }

    OnDestroy {
      InstallReceiver.listener = null
    }

    // The CPU architectures the phone runs, the one it prefers first.
    Function("supportedAbis") {
      Build.SUPPORTED_ABIS.toList()
    }

    // Whether the listener has let the app install apps, which updating itself needs.
    Function("canInstall") {
      context.packageManager.canRequestPackageInstalls()
    }

    // Opens the system setting that lets the app install apps.
    Function("openInstallSettings") {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

      context.startActivity(intent)
    }

    // A file's SHA-256 checksum in lowercase hex, read in chunks.
    AsyncFunction("sha256") { uri: String ->
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

    // Hands an APK to Android's installer; how it goes arrives as `onInstallStatus` events.
    AsyncFunction("install") { uri: String ->
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
  }

  private fun fileOf(uri: String) =
    File(Uri.parse(uri).path ?: throw IllegalArgumentException("Not a file: $uri"))
}
