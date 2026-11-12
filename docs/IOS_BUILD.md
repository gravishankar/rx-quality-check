# iOS Build (future) — Rx Recall Check

Status: **not built.** Task 4A prepares the architecture only; no IPA is produced. The iOS project
(`mobile/ios/`, from the React Native 0.88.1 template) shares all JavaScript/TypeScript with Android:
`mobile/src/` (logic, engine, catalog, policy, API clients, presentation, copy, legal) and
`mobile/app/` (screens). Platform-specific code is limited to `mobile/app/platform/native.ts`, which
uses cross-platform libraries only.

## Cross-platform readiness

| Area | Android | iOS equivalent | Status |
|---|---|---|---|
| Encrypted database | op-sqlite 19.0.5 with SQLCipher (`"op-sqlite": {"sqlcipher": true}`), OpenSSL from Maven | Same library; podspec uses SQLCipher with the `OpenSSL-Universal` pod | Same JS API; verify on device |
| Key storage | react-native-keychain 11.0.0 → Android Keystore-backed storage | react-native-keychain → iOS Keychain, `AccessibleAfterFirstUnlockThisDeviceOnly` (not migrated to other devices or backups) | Same JS API |
| Random key | react-native-get-random-values 2.0.0 | Same library (SecRandomCopyBytes) | Same |
| Network | React Native `fetch`; HTTPS only via network security config | `fetch`; App Transport Security (`NSAllowsArbitraryLoads` false) | Same allowlist in code |
| Backup exclusion | `allowBackup=false`, data extraction rules | **Open item (B-iOS-1):** op-sqlite stores databases in `Library/`, which iCloud backs up by default. The database must be excluded (`NSURLIsExcludedFromBackupKey`) or placed in a non-backed-up location. Needs a small native helper or a library option. The backed-up file would be encrypted with a key that is not backed up, but exclusion is still required by our privacy policy. | **Blocker for iOS persistence** |
| Display name / version | `app_name`, versionName 0.1.0 | `CFBundleDisplayName` "Rx Recall Check", `MARKETING_VERSION` 0.1.0 | Set |
| Bundle ID | `org.rxrecallcheck.app` (+ `.dev`) | `org.rxrecallcheck.app` | Placeholder; must be registered with Apple |
| Dev vs pilot profile | Product flavors + `build_profile.json` | Xcode schemes/configurations must read the same `build_profile.json` (written by a build script) | **Open item (B-iOS-2)**: add a "Dev" configuration with a separate bundle ID suffix and app name |
| Local networking | — | `NSAllowsLocalNetworking` true in template (Metro in debug). Remove from release configuration. | **Open item (B-iOS-3)** |
| Recents/app switcher privacy | Not handled (D-33) | Not handled | Decision for Task 4B |

No other architectural blocker was found: shared code has no Android-only imports (enforced by
`tests/unit/architecture_boundaries.test.ts` for `rules/` and `state/`; `mobile/app/` imports native
modules only in `platform/native.ts`).

## Build on a MacBook Pro with Xcode

Prerequisites: macOS with a current Xcode (from the Mac App Store), Xcode command-line tools,
Node ≥ 22.11, Ruby with Bundler (or Homebrew CocoaPods). An Apple ID is enough for running on your
own iPhone; TestFlight and the App Store need a paid Apple Developer Program membership.

1. Clone the repository and install JavaScript dependencies:

```bash
npm ci
```

```bash
cd mobile && npm ci
```

2. Install CocoaPods dependencies (this compiles op-sqlite with SQLCipher and pulls OpenSSL-Universal):

```bash
cd mobile && bundle install
```

```bash
cd mobile/ios && bundle exec pod install
```

3. Open the workspace (not the project):

```bash
open mobile/ios/RxRecallCheck.xcworkspace
```

4. In Xcode: select the *RxRecallCheck* target → Signing & Capabilities → choose your Team; change the
   bundle identifier if `org.rxrecallcheck.app` is not available to you.
5. Run on the simulator (Product → Run) with Metro running (`cd mobile && npx react-native start`), or
   build a standalone Release configuration (the JS bundle is embedded by the "Bundle React Native code
   and images" build phase).
6. To run on your iPhone: connect it, trust the computer, enable Developer Mode on the phone
   (Settings → Privacy & Security), select the device in Xcode and Run.

Before any iOS build is shared with anyone, the same release gate applies (`npm run release:gate`)
and items B-iOS-1 to B-iOS-3 must be closed.

## Signing, TestFlight and App Store (roadmap)

1. **Apple Developer Program** membership for the legal entity (organization enrollment needs a D-U-N-S
   number). Register the bundle ID.
2. **Signing**: automatic signing in Xcode with the team's distribution certificate; certificates and
   provisioning profiles stay in the owner's keychain/Apple account, never in the repository.
3. **Archive**: Product → Archive (Release configuration, pilot profile), then *Distribute App →
   App Store Connect*.
4. **TestFlight**: internal testers (team members) need no review; external testers require Beta App
   Review. Provide the privacy policy URL, test notes and the pilot tester notice.
5. **App Store**: App Privacy ("nutrition label") must match `docs/PRIVACY.md`; review guidelines
   1.4.1 (medical apps; regulatory documentation may be requested) and 5.1.3 (health data) apply; see
   `docs/LEGAL_REGULATORY_REVIEW.md`.
