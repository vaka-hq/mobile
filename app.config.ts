import type { ConfigContext, ExpoConfig } from 'expo/config'
import {
  type ConfigPlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
  withProjectBuildGradle,
} from 'expo/config-plugins'
import { appIdentity } from './config/app-identity.ts'

const withAndroidReleaseShrinking: ConfigPlugin = (config) => {
  config = withGradleProperties(config, (gradleConfig) => {
    const releaseProperties = {
      'android.r8.optimizedResourceShrinking': 'true',
      'org.gradle.jvmargs': '-Xmx4096m -XX:MaxMetaspaceSize=1024m',
    }

    for (const [key, value] of Object.entries(releaseProperties)) {
      const existing = gradleConfig.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      )

      if (existing?.type === 'property') {
        existing.value = value
      } else {
        gradleConfig.modResults.push({ key, type: 'property', value })
      }
    }

    return gradleConfig
  })

  return withAppBuildGradle(config, (gradleConfig) => {
    const standardDefault = 'getDefaultProguardFile("proguard-android.txt")'
    const optimizedDefault = 'getDefaultProguardFile("proguard-android-optimize.txt")'

    if (gradleConfig.modResults.contents.includes(standardDefault)) {
      return gradleConfig
    }

    if (!gradleConfig.modResults.contents.includes(optimizedDefault)) {
      throw new Error('Unable to configure the standard Android release rules')
    }

    gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
      optimizedDefault,
      standardDefault,
    )

    return gradleConfig
  })
}

const releaseSigningMarker = '// Vaka: release signing'

/**
 * Signs release builds with the owner's upload key when `~/.gradle/gradle.properties` names it
 * (`VAKA_UPLOAD_STORE_FILE`, `VAKA_UPLOAD_STORE_PASSWORD`, `VAKA_UPLOAD_KEY_ALIAS`,
 * `VAKA_UPLOAD_KEY_PASSWORD`). Without it, a release of the production app is refused rather
 * than signed with the debug key, which no properly signed update could replace; development
 * and preview releases fall back to the debug key.
 */
const withReleaseSigning =
  (production: boolean): ConfigPlugin =>
  (config) =>
    withAppBuildGradle(config, (gradleConfig) => {
      let contents = gradleConfig.modResults.contents

      if (contents.includes(releaseSigningMarker)) {
        return gradleConfig
      }

      const signingConfigs = '    signingConfigs {\n'

      const releaseSigning =
        '            signingConfig signingConfigs.debug\n            def enableShrinkResources'

      if (!contents.includes(signingConfigs) || !contents.includes(releaseSigning)) {
        throw new Error('Unable to configure release signing')
      }

      contents = contents.replace(
        signingConfigs,
        `${signingConfigs}        ${releaseSigningMarker}: the upload key named in gradle.properties.
        release {
            if (findProperty('VAKA_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('VAKA_UPLOAD_STORE_FILE'))
                storePassword findProperty('VAKA_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('VAKA_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('VAKA_UPLOAD_KEY_PASSWORD')
            }
        }
`,
      )

      contents = contents.replace(
        releaseSigning,
        `            signingConfig findProperty('VAKA_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug
            def enableShrinkResources`,
      )

      if (production) {
        contents += `
${releaseSigningMarker}: a production release is never signed with the debug key.
gradle.taskGraph.whenReady { graph ->
  def releasing = graph.allTasks.any { it.name ==~ /(assemble|bundle|package)Release/ }

  if (releasing && !findProperty('VAKA_UPLOAD_STORE_FILE')) {
    throw new GradleException('Set VAKA_UPLOAD_STORE_FILE and its passwords in ~/.gradle/gradle.properties to sign a production release.')
  }
}
`
      }

      gradleConfig.modResults.contents = contents

      return gradleConfig
    })

const abiSplitsMarker = '// Vaka: one release APK per CPU architecture'

/**
 * Splits a release build into one APK per CPU architecture, such as
 * `app-arm64-v8a-release.apk`, each with only that architecture's native libraries, so a phone
 * installs a third of the size of one holding them all. Debug builds stay whole, and
 * `-PreactNativeArchitectures` narrows the split as it narrows what is compiled. Every split
 * keeps the same version code: they are installed by hand, not offered side by side in a store.
 */
const withAbiSplits: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (gradleConfig) => {
    const contents = gradleConfig.modResults.contents

    if (contents.includes(abiSplitsMarker)) {
      return gradleConfig
    }

    const android = '\nandroid {\n'

    if (!contents.includes(android)) {
      throw new Error('Unable to configure ABI splits')
    }

    gradleConfig.modResults.contents = contents.replace(
      android,
      `${android}    ${abiSplitsMarker}, in release builds only.
    splits {
        abi {
            enable gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
            reset()
            include(*((findProperty('reactNativeArchitectures') ?: 'armeabi-v7a,arm64-v8a,x86,x86_64').split(',')))
            universalApk false
        }
    }

`,
    )

    return gradleConfig
  })

const expoModuleCacheMarker = '// Vaka: the expo module compiles this app’s module list'

/**
 * Keeps the `expo` module out of Gradle's build cache. It compiles the list of this app's native
 * modules, generated at build time, and Expo CLI builds with `--build-cache`: a cached compile
 * came back without that list, so the app crashed at start with `ExpoModulesPackageList` missing.
 */
const withFreshExpoModuleList: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.contents.includes(expoModuleCacheMarker)) {
      return gradleConfig
    }

    gradleConfig.modResults.contents += `
${expoModuleCacheMarker}, which a cached compile has restored without; it
// always compiles afresh so the app never starts without its modules.
subprojects { subproject ->
  if (subproject.name == 'expo') {
    subproject.tasks.configureEach { task ->
      task.outputs.doNotCacheIf('It compiles the generated list of this app’s modules') { true }
    }
  }
}
`

    return gradleConfig
  })

/**
 * Leaves out the settings Expo's prebuild writes for over-the-air updates, which this app does not
 * use: without `expo-updates` nothing reads them.
 */
const withoutUpdatesSettings: ConfigPlugin = (config) =>
  withAndroidManifest(config, (manifestConfig) => {
    for (const application of manifestConfig.modResults.manifest.application ?? []) {
      application['meta-data'] = application['meta-data']?.filter(
        (item) => !item.$['android:name'].startsWith('expo.modules.updates.'),
      )
    }

    return manifestConfig
  })

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = appIdentity(process.env.APP_VARIANT)

  return withAbiSplits(
    withReleaseSigning(variant.variant === 'production')(
      withoutUpdatesSettings(
        withFreshExpoModuleList(
          withAndroidReleaseShrinking({
            ...config,
            name: variant.name,
            slug: 'vaka',
            version: '1.0.0',
            platforms: ['android'],
            orientation: 'portrait',
            icon: './assets/images/icon.png',
            scheme: variant.scheme,
            userInterfaceStyle: 'automatic',
            android: {
              package: variant.androidPackage,
              // Raised with every release: Android installs an update only over a lower version code.
              versionCode: 1,
              allowBackup: false,
              // Pulled in by libraries for things the app does not use: biometric unlock of the
              // keystore, the Play install referrer and vibration, which haptic feedback does not need.
              blockedPermissions: [
                'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
                'com.google.android.gms.permission.AD_ID',
                'android.permission.USE_BIOMETRIC',
                'android.permission.USE_FINGERPRINT',
                'android.permission.VIBRATE',
                'android.permission.READ_EXTERNAL_STORAGE',
                'android.permission.RECORD_AUDIO',
                'android.permission.SYSTEM_ALERT_WINDOW',
                'android.permission.WRITE_EXTERNAL_STORAGE',
              ],
              predictiveBackGestureEnabled: true,
              // Built by `vp run icons:generate`; the colour is the field's, which it prints.
              adaptiveIcon: {
                backgroundColor: '#182445',
                backgroundImage: './assets/images/android-icon-background.png',
                foregroundImage: './assets/images/android-icon-foreground.png',
                monochromeImage: './assets/images/android-icon-monochrome.png',
              },
            },
            plugins: [
              [
                'expo-audio',
                {
                  enableBackgroundPlayback: true,
                  microphonePermission: false,
                  recordAudioAndroid: false,
                },
              ],
              [
                'expo-build-properties',
                {
                  android: {
                    enableMinifyInReleaseBuilds: true,
                    enableShrinkResourcesInReleaseBuilds: true,
                    usePrecompiledHeaders: true,
                  },
                },
              ],
              ['expo-localization', { supportedLocales: ['en', 'sv'] }],
              ['expo-secure-store', { faceIDPermission: false }],
              // The icon's mark on its midnight field, in light and dark mode alike.
              [
                'expo-splash-screen',
                {
                  image: './assets/images/splash-icon.png',
                  imageWidth: 200,
                  backgroundColor: '#182445',
                  dark: { image: './assets/images/splash-icon.png', backgroundColor: '#182445' },
                },
              ],
              'expo-router',
              'expo-sqlite',
              'expo-status-bar',
            ],
            experiments: { typedRoutes: true, reactCompiler: true },
          }),
        ),
      ),
    ),
  )
}
