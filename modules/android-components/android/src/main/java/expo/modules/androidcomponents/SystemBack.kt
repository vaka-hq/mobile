package expo.modules.androidcomponents

import androidx.activity.OnBackPressedCallback
import com.facebook.react.ReactActivity
import com.facebook.react.modules.systeminfo.ReactNativeVersion

/**
 * React Native registers one always-enabled back callback, which hides Android's predictive
 * back-to-home animation. At the root screen the app turns it off, so the system owns Back there.
 * The field is private, so the React Native version whose `ReactActivity` was reviewed is pinned:
 * an upgrade fails loudly here rather than quietly losing Back.
 */
private const val reviewedReactNative = "0.86.3"

private val callbackField by lazy {
  val version = ReactNativeVersion.VERSION
  val actual = "${version["major"]}.${version["minor"]}.${version["patch"]}"
  check(actual == reviewedReactNative) {
    "React Native $actual: review ReactActivity.mBackPressedCallback before upgrading (reviewed $reviewedReactNative)"
  }
  ReactActivity::class.java.getDeclaredField("mBackPressedCallback").apply {
    check(OnBackPressedCallback::class.java.isAssignableFrom(type)) { "Unexpected back callback type $type" }
    isAccessible = true
  }
}

internal fun setReactNativeBack(activity: ReactActivity, enabled: Boolean) {
  val callback = callbackField.get(activity) as? OnBackPressedCallback
    ?: error("ReactActivity has no back callback")
  activity.runOnUiThread {
    callback.isEnabled = enabled
    check(callback.isEnabled == enabled) { "React Native's back callback ignored isEnabled = $enabled" }
  }
}
