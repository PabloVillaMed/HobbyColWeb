# GlowApp — Android build

A thin native shell around the web app in [`../habits`](../habits). The web files
are copied into the APK at build time, so `../habits` stays the single source of
truth — edit the app there, rebuild, and the APK picks the changes up.

## The built APK

`GlowApp-2.0.apk` sits at the repository root. It is signed with the release key
in `keystore/` (not committed), targets API 35 (Android 15), and needs Android
7.0 or newer.

The target matters. The first build targeted API 32 and Google Play Protect
refused to install it — "This app was built for an older version of Android and
doesn't include the latest privacy protections." Play Protect gates sideloads on
`targetSdkVersion`, so the fix was to build against a current platform rather
than to click past the warning.

## Native features

Three things live in the shell rather than the page, because a web page cannot
do them:

- **Per-habit reminders.** A time set on a habit schedules a daily *inexact*
  alarm — inexact on purpose, since exact alarms need the SCHEDULE_EXACT_ALARM
  special access on API 31+, which a habit nudge does not warrant. The
  notification carries a **Mark done** action. `BootReceiver` re-arms alarms
  after a restart, and notification permission is requested the first time a
  reminder is set, not at launch.
- **Home-screen widget.** `GlowWidgetProvider` plus `GlowWidgetService` list
  today's habits, each tappable to complete.
- **The bridge between them.** See below — it is the part worth understanding.

### How the widget and reminders see your data

Habit data lives in the WebView's local storage, which native code cannot read.
So the page pushes a compact snapshot of today into `SharedPreferences` after
every save (`GlowStore`), and anything ticked from the widget or a notification
is **queued** rather than written directly.

That makes widget ticks *eventually consistent*: the widget updates immediately
and optimistically, and the real change is applied through the page's own write
path the next time GlowApp opens, so streaks and charts stay correct. Making it
instant would mean moving the database out of local storage — a much larger
change than this feature justifies.

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
committed. The build needs JDK 17 and an SDK with platform 35 and build-tools
35.0.1, driven by Gradle 8.7 and Android Gradle Plugin 8.6.1.

To bump the version, edit `versionCode` and `versionName` in `app/build.gradle`.
The package ID changed from `com.pablo.habitos` to `com.pablo.glowapp` with
the rename, so this installs as a new app rather than updating the old one.
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

## Testing the widget

Binding a widget to a launcher needs the signature-level BIND_APPWIDGET
permission, so a home screen cannot be scripted. Debug builds therefore carry a
`WidgetPreviewActivity` that inflates the **real** provider views and factory
rows, which is what makes the widget's layout verifiable at all. It is in
`src/debug` and never reaches a release APK, as is the WebView DevTools hook.

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

### Window insets

From targetSdk 35 Android stops insetting the window and apps draw behind the
system bars. `MainActivity` pads its root view by the window insets to handle
that, and the page reports its own background colour over a JavaScript bridge so
the bar areas match the active theme.

That path could not be exercised here — the installed emulator binary predates
API 35 images and cannot boot one — so this build also sets
`windowOptOutEdgeToEdgeEnforcement`, keeping the system's own insetting and
therefore the layout that was actually tested. The attribute is ignored from
targetSdk 36 onwards; whoever raises the target next should drop it and verify
the inset code on a real API 35+ device.

## Where the data lives

In the WebView's local storage inside the app's private directory. It is not
shared with the same app opened in Chrome — those are separate storage areas, so
installing the APK does not import anything you already logged in the browser.
Move history across with **Ajustes → Exportar JSON** and *Importar JSON*.

Uninstalling deletes it. Android's auto-backup covers the WebView directory
(see `res/xml/backup_rules.xml`), but treat the JSON export as the real backup.
