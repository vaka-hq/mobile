# SystemBack reads React Native's back callback by its name.
-keepclassmembers class com.facebook.react.ReactActivity {
  private ** mBackPressedCallback;
}
