# Vaka

An Android app for listening to audiobooks and reading their e-books, in one place.

Vaka finds audiobooks on AudioBookBay, adds covers, series and details from Hardcover, and
streams them through your own TorBox account. It plays in the background with chapters,
bookmarks, a sleep timer and playback speed, and books can be downloaded to play offline. A
book's e-book, from Anna's Archive or Library Genesis, opens in a built-in reader, and listening
and reading can pick up where the other left off.

It is built with Expo and React Native, with the interface in Jetpack Compose, and runs only on
Android.

## Getting started

You need:

- [Vite+](https://viteplus.dev) (`vp`), which runs every command in the project;
- Node.js, the version in `.node-version`;
- pnpm, the version in `package.json` (`packageManager`), which `vp install` uses;
- JDK 17, and the Android SDK from Android Studio with platform 36 (Gradle adds the NDK and build
  tools it needs);
- an Android phone or emulator on Android 7 or newer.

```sh
vp install
vp run android      # builds the development app and installs it on the connected device
```

`vp run start` starts Metro on its own once the development app is installed. Expo Go cannot run
Vaka, since it has native modules of its own.

On first start the app asks for a TorBox API key (torbox.app → Settings → API) and, optionally, a
Hardcover API key with `read:catalog` access (hardcover.app → Settings → Hardcover API) and an
HTTP proxy for AudioBookBay, or restores a backup instead. All of them can be added later in
Settings.

## Developing

```sh
vp run check          # formats, lints, type-checks and runs the tests
vp run export         # bundles the app's JavaScript, to confirm it builds
vp run i18n:extract   # collects new strings; translate them in src/locales/sv/messages.po
vp run generate       # regenerates android/ after native changes
```

Every task is defined in `vite.config.ts`; `vp run` on its own lists them. JavaScript changes
reload over Metro. Native changes (modules, config plugins, native dependencies) need
`vp run generate` and a new build.

- `src/` holds the app: routes in `src/app`, screens in `src/screens`, shared UI in `src/ui`, and
  the data, player and service clients beside them.
- `modules/` holds the app's own native modules: the Compose components and e-book reader, the
  proxy client and offline speech recognition.
- `docs/architecture.md` explains how the app works.
- `AGENTS.md` lists the conventions to follow when changing it.

## Releases

Releases are built and published by GitHub Actions, and the app updates itself from them, on the
Stable or Nightly channel chosen in Settings. Push a tag to release the commit it is on:

```sh
git tag v1.1.0 nightly-20261001.42   # promote a nightly you have been using
git push origin v1.1.0
```

`main` becomes a nightly once a day when it has changed, or at once from Actions → Release → Run
workflow. `docs/architecture.md` explains the channels and versions.

To build a signed release locally instead, create a signing key once:

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore ~/.android/vaka-upload.jks \
  -alias vaka -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Vaka"
```

Then name it in `~/.gradle/gradle.properties`, outside the project:

```properties
VAKA_UPLOAD_STORE_FILE=/Users/you/.android/vaka-upload.jks
VAKA_UPLOAD_STORE_PASSWORD=…
VAKA_UPLOAD_KEY_ALIAS=vaka
VAKA_UPLOAD_KEY_PASSWORD=…
```

```sh
vp run android:release   # builds, signs and installs the production app
```

A release makes one APK per CPU architecture in `android/app/build/outputs/apk/release/`; phones
from recent years take `app-arm64-v8a-release.apk`. Keep the key and its passwords backed up, and
use the same key for GitHub's `release` environment: without it, the installed app cannot be
updated. A local build is version 0.0.1 with version code 1, so it installs over a published
release only after that is uninstalled.

The app comes in three variants, chosen with `APP_VARIANT`, which install side by side:

| Variant     | App name     | Package                  |
| ----------- | ------------ | ------------------------ |
| development | Vaka Dev     | app.vaka.android.dev     |
| preview     | Vaka Preview | app.vaka.android.preview |
| production  | Vaka         | app.vaka.android         |

## Licence

MIT; see [LICENSE](LICENSE).
