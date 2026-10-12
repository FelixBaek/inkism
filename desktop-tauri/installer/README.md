# OS protocol registration

The installer fragments register the `note://` URL scheme on each target:

- Windows: include `windows/inkism-protocol.nsh` in the NSIS install and
  uninstall hooks. The command passes `--open "%1"` to the desktop host.
- macOS: merge `macos/Info.plist.url-types.xml` into the app bundle plist.
- Android: merge `android/intent-filter.xml` into the generated main activity.
- iOS: `src-tauri/Info.ios.plist` contains the URL type directly.

The host validates that the value begins with `note://` before dispatching it
to the renderer. Physical installer registration still needs one package
smoke test per OS.
