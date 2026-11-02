
### Which file should I download?

| Device | File | Good to know |
| --- | --- | --- |
| Windows 10 / 11 | `Freeify-Setup-…-Windows-x64.exe` | The installer isn't code-signed yet, so Windows may say "Windows protected your PC". Click **More info → Run anyway**. |
| Mac with Apple chip (M1 and newer) | `Freeify-…-macOS-arm64.dmg` | Drag Freeify to Applications. The app isn't signed by Apple, so run `xattr -cr /Applications/Freeify.app` once in Terminal, then open it. |
| Mac with Intel chip | `Freeify-…-macOS-x64.dmg` | Same as above. |
| Linux | `Freeify-…-Linux-x86_64.AppImage` (any distro) or `…-Linux-amd64.deb` (Ubuntu, Debian, Mint) | For the AppImage: `chmod +x Freeify-*.AppImage`, then run it. |
| Android | `Freeify-…-Android.apk` | Open the file on your phone and allow "Install unknown apps" when asked. |
| iPhone / iPad | `Freeify-…-iPhone-unsigned.ipa` | Apple requires signing: install it with your Apple ID using AltStore or Sideloadly. Simpler: open the web version in Safari, then **Share → Add to Home Screen**. |
| Any computer, no install | `Freeify-…-Web.zip` | Unzip it and open `index.html` in your browser. |

Your music stays on your device: each app keeps its own library.
