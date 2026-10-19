import { type NativeModule, requireOptionalNativeModule } from 'expo'

/**
 * How an install is going: `installed` rarely arrives, since the update replaces the running app;
 * `cancelled` when the listener declined Android's confirmation.
 */
export type InstallStatus = {
  status: 'installed' | 'cancelled' | 'failed'
  message: string | null
}

type AppUpdatesEvents = {
  onInstallStatus: (event: InstallStatus) => void
}

declare class AppUpdatesModule extends NativeModule<AppUpdatesEvents> {
  /** The CPU architectures the phone runs, such as `arm64-v8a`, the one it prefers first. */
  supportedAbis(): string[]
  /** Whether the listener has let the app install apps, which updating itself needs. */
  canInstall(): boolean
  /** Opens the system setting that lets the app install apps. */
  openInstallSettings(): void
  /** A file's SHA-256 checksum in lowercase hex. */
  sha256(uri: string): Promise<string>
  /** Hands a downloaded APK to Android's installer; the outcome arrives as `onInstallStatus`. */
  install(uri: string): Promise<void>
}

/** Null where the native module is not linked, such as in tests; callers then do without. */
export const AppUpdates = requireOptionalNativeModule<AppUpdatesModule>('AppUpdates')
