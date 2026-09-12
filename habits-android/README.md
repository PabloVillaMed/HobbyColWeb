# Hábitos — Android build

A thin native shell around the web app in [`../habits`](../habits). The web files
are copied into the APK at build time, so `../habits` stays the single source of
truth — edit the app there, rebuild, and the APK picks the changes up.

## The built APK

`Habitos-1.0.apk` sits at the repository root. It is signed with the release key
in `keystore/` (not committed), targets API 32, and needs Android 7.0 or newer.

## Installing on a phone

Copy the APK to the phone (USB, Drive, email to yourself) and tap it. Android
will ask you to allow installs from whichever app is opening it — that prompt is
expected for an app that does not come from the Play Store.

Over USB with developer options and USB debugging on:

```sh
adb install Habitos-1.0.apk
```

## Rebuilding

```sh
cd habits-android
./gradlew assembleRelease      # -> app/build/outputs/apk/release/app-release.apk
```

`local.properties` points at the Android SDK; it is machine-specific and not
committed. The build needs JDK 17 and an SDK with platform 32 and build-tools 32.

To bump the version, edit `versionCode` and `versionName` in `app/build.gradle`.
Android only replaces an installed app when the new APK is signed with the same
key **and** has a higher `versionCode`.

## The signing key

`keystore/habitos.jks` (alias `habitos`) and its `keystore.properties` are
gitignored, so neither the key nor its password is published here.
Keep it: Android refuses to update an installed app with a differently-signed
APK. Lose it and the only way forward is uninstalling first, which erases the
habit history stored inside the app. Export a JSON backup before doing that.

To recreate one from scratch:

```sh
keytool -genkeypair -keystore keystore/habitos.jks -alias habitos \
  -keyalg RSA -keysize 2048 -validity 10000
```

then write `keystore/keystore.properties` with `storeFile`, `storePassword`,
`keyAlias` and `keyPassword`.

## How the shell works

`MainActivity` hosts a single WebView and answers every request to
`https://appassets.androidplatform.net` from the APK's assets — nothing touches
the network. Serving from a synthetic https origin rather than `file://` is
deliberate: local storage on `file://` is treated as an opaque origin by some
WebView versions and can be discarded, and service workers refuse to register
outside a secure context.

Service worker requests bypass `WebViewClient`, so they get their own
interceptor via `ServiceWorkerController`.

The back button returns to the Today tab first and leaves the app only from
there.

## Where the data lives

In the WebView's local storage inside the app's private directory. It is not
shared with the same app opened in Chrome — those are separate storage areas, so
installing the APK does not import anything you already logged in the browser.
Move history across with **Ajustes → Exportar JSON** and *Importar JSON*.

Uninstalling deletes it. Android's auto-backup covers the WebView directory
(see `res/xml/backup_rules.xml`), but treat the JSON export as the real backup.
