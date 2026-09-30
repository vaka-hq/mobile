package expo.modules.appupdates

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * Hears from Android's installer how an update is going: it asks for the listener's confirmation
 * by handing back an activity to start, and reports the outcome. A successful update replaces the
 * app, so its process usually ends before anything is heard of it.
 */
class InstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }

        if (confirm == null) {
          listener?.invoke("failed", "The installer asked for confirmation without a way to give it")
        } else {
          context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
      }
      PackageInstaller.STATUS_SUCCESS -> listener?.invoke("installed", null)
      PackageInstaller.STATUS_FAILURE_ABORTED -> listener?.invoke("cancelled", null)
      else -> listener?.invoke("failed", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
    }
  }

  companion object {
    /** Set while the module is loaded; reports an install's outcome to the app. */
    @Volatile var listener: ((status: String, message: String?) -> Unit)? = null
  }
}
