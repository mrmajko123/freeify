# Freeify mobile builds

The Android and iPhone apps wrap the same web app with [Capacitor](https://capacitorjs.com).
The native projects are generated fresh by the release workflow (`.github/workflows/release.yml`),
so only this folder's config and artwork live in the repository.

Build locally (needs Node 20+, plus Android Studio / JDK 21 for Android or Xcode for iOS):

```bash
cd mobile
npm install
npm run android   # then: cd android && ./gradlew assembleDebug
npm run ios       # then open ios/App/App.xcworkspace in Xcode
```

## Android signing

Android only installs updates signed with the same key as the installed app. Without a key the
workflow signs with a temporary debug key, so installing a newer APK may require uninstalling the
old one first (which clears the library on the phone). To get smooth updates, add these repository
secrets once (Settings → Secrets and variables → Actions):

- `ANDROID_KEYSTORE_BASE64`: the keystore file, base64 encoded
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

## iPhone

Apple only allows signed apps on iPhones. The release includes an unsigned `.ipa` that you can
sign and install for free with your own Apple ID using a sideloading tool such as AltStore or
Sideloadly. Easiest alternative: open the web version in Safari and choose
**Share → Add to Home Screen**.
