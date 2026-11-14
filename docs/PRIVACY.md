# Privacy and Security Design

Principle: **the phone is the only place patient information exists.** The project operates no
servers and collects no data.

## 1. On-device OCR and image processing

**Task 4C (implemented, Android):** *Scan medication label* opens the phone's camera app through
`ACTION_IMAGE_CAPTURE`, which writes one photo into the app's private cache (`cache/scans/`, shared
with the camera app only through a non-exported FileProvider for that photo). The app decodes it into
memory, deletes the file immediately and checks that it is gone (also on failure, cancel and camera
launch failure; a file that cannot be deleted is emptied; leftovers from an interrupted process are
cleared at the next start), revokes the camera app's access to the file when it returns,
runs text recognition (PaddleOCR PP-OCRv3 on ONNX Runtime 1.28.0) and barcode decoding (ZXing-cpp) on
the phone, and returns only recognized lines and barcode payloads to the app. The app holds **no
CAMERA permission**, writes nothing to the gallery, uploads nothing and logs nothing. All label text
not used for identity (patient, prescriber, pharmacy, directions, Rx number) is passed to the request
guard as private text and never transmitted (tested). Library telemetry: ML Kit not used (Google usage
logging); ONNX Runtime pinned to 1.28.0 (later versions add Microsoft telemetry); the build fails if
any permission other than INTERNET or any known telemetry component appears in the APK.


- Camera frames are processed in memory by an on-device OCR and barcode engine (selection in Task 5, OD-5).
- **Trust boundary (review item 8):** the photo is taken by the phone's camera app, a separate app this app does not control. It writes the photo into this app's private cache; some camera apps may also keep their own copy or use the network on their own. This app cannot verify or prevent that (device check, per camera app). An in-app camera would remove this boundary; it is assessed as a future option, not implemented.
- The photo is briefly written to the app's private cache (above), then deleted; it is never uploaded or saved by this app. Temporary buffers are released after extraction. Saving a label photo is out of scope for v0.1.
- **Engine requirement:** the selected OCR/barcode library must run with no network access at inference time and must not transmit images, text or usage metrics. Libraries that download models or send diagnostics (some vendor SDKs do) must be configured to disable this, or be rejected. This is verified in Task 5 with a network capture during scanning (TEST_PLAN PV-3).
- Extracted text is shown to the user for confirmation and then reduced to structured fields; raw OCR text is not persisted.

## 2. Minimum necessary API queries

| Purpose | Sent to | Data sent |
|---|---|---|
| Identify product | api.fda.gov | Candidate package NDCs (`packaging.package_ndc`), product NDCs (`product_ndc`) |
| Ingredient RxCUIs | rxnav.nlm.nih.gov | 11-digit NDC (`ndcstatus`), clinical-drug RxCUI (`related?tty=IN PIN`) |
| Recall lookup | api.fda.gov | Ingredient names, product NDC, verified source product NDCs, and the fixed control query (recall D-0325-2021) |
| Repackager source product | dailymed.nlm.nih.gov | SPL set ID (from the NDC Directory record) |

Implemented in Task 3 (`mobile/src/services/`):
- **Request shapes.** Clients refuse to build a request from anything except a public identifier:
  - NDC patterns, RxCUI digits and SPL set-id UUIDs;
  - recall searches built only by `planRecallQueries`.
- **Privacy guard.** Every request passes through `guardedTransport`. It allows only HTTPS GET to the three hosts, with no credentials and no redirects. It **refuses** any URL containing a patient-specific value read from the label: lot, expiry, and other label text such as patient name, Rx number, pharmacy, prescriber and directions (`LabelExtraction.privateText`). A refused request is never sent; it becomes `SOURCE_UNAVAILABLE` (`REQUEST_BLOCKED`).
- **Request audit.** Every request is recorded in an in-memory audit log (never persisted or transmitted). The end-to-end tests assert that, across all scenarios, every request matches one of four public-identifier URL shapes, and that the synthetic patient name, Rx number, directions, pharmacy and lot never appear (`tests/integration/e2e_scenarios.test.ts`).

Never sent: images, OCR text, lot or expiry, fill dates, pharmacy or prescriber names, patient names,
Rx numbers, medication lists, device identifiers, advertising IDs, app-install IDs, location.
Requests use a generic `User-Agent`, no cookies, no custom tracking headers.

**What the API operators can still see.** FDA (openFDA) and NLM (RxNav, DailyMed), and their
infrastructure providers, see the device's public IP address and the drug identifiers queried. In
Task 3, recall lookups are made per scanned medication, so the operators can infer which drugs are
looked up from an IP address. **OD-4 decided (Task 4A, ADR-0001): per-medication lookup is kept** and
disclosed in the Privacy Policy draft; no monitoring or batch refresh. Identity lookups (NDC →
product) unavoidably reveal the checked product.

**Order of lookups (OD-19, Task 4A).** The NDC Directory is queried first (product identity). The
local exclusion policy is then applied; RxNav and DailyMed are queried **only** for medications the
policy found eligible. Excluded, unsupported and configuration-blocked medications cause no RxNav,
DailyMed or recall request (tested in `tests/integration/app_screens.test.ts`).

## 3. Local data retention and deletion

- Stored (schema: `mobile/src/storage/migrations.ts`):
  - `medication`: name and catalog id;
  - `fill`: structured identity fields, plus the lot only when the user confirmed it;
  - `assessment` and `assessment_evidence`: findings and the catalog, policy and rule-set versions used;
  - `source_cache`: public API responses only, never failures;
  - `config_snapshot`: public configuration.
- Never stored: images, OCR text, patient name, Rx number, pharmacy, prescriber or directions. A test asserts that no such column exists.
- Retention: until the user deletes. The public cache is pruned after expiry (ARCHITECTURE §9).
- Deletion: per medication (cascades to fills, assessments and evidence) and "Delete all data". Delete-all is `deleteAllData`: it closes and deletes the database file and its WAL/SHM/journal files, then deletes the encryption key; tested. Uninstall removes everything.
- No export of medical data in v0.1 except an explicit user-initiated share sheet (future; not in v0.1).

## 4. Encryption and secure key management

- **Library (OD-6, decided in Task 3):**
  - Database: `@op-engineering/op-sqlite` 19.0.5 (MIT, released 2026-11-05) with its SQLCipher build (`"op-sqlite": { "sqlcipher": true }`). The **whole database** is encrypted, including the WAL.
  - Key storage: `react-native-keychain` 11.0.0, which encrypts stored secrets with an Android Keystore key.
- **Key:** 256 bits from a CSPRNG (`crypto.getRandomValues`), generated on first use (`storage/keys.ts`). It is stored with `AccessibleAfterFirstUnlockThisDeviceOnly`, so it never migrates to another device or a backup.
- **What remains in app files:** the encrypted database file only. Configuration JSON is bundled and public.
- **Status: not verified on a device.** Both native libraries are installed in the app since Task 4A (`mobile/package.json`) and linked into the development APK. The adapters (`storage/drivers/opSqlite.ts`, `storage/keys.ts`) are written against their documented APIs and tested only with fakes. Tests and the command-line integration use Node's built-in SQLite, **unencrypted**, which is never bundled into the app. Encryption at rest must be verified on a physical Android device by inspecting the database file (PV-4). Task 4A adds an on-device self-test (About screen of the development build, `storage/encryptionSelfTest.ts`) and the device steps in `docs/ANDROID_DEVICE_TEST_PLAN.md` §3.
- **Consequence (Task 4A rule):** no build persists medication history until encryption is verified on a device. Development builds keep everything in memory only; pilot builds enable history only when `encryption_verified_on_device` is set after PV-4 passes.
- The key is never logged, exported or backed up. Losing it (e.g., after Keystore reset) means local data is unrecoverable; the app then offers a clean reset.
- Optional app lock (device biometric/PIN) is a candidate for Task 6; not required for v0.1.
- Release builds: R8/ProGuard on, debuggable off, no WebView remote debugging, cleartext traffic disabled (`usesCleartextTraffic=false`, network security config allowing only HTTPS).

## 5. Backup behavior

- Set in Task 4A (`mobile/android/app/src/main/AndroidManifest.xml`): `android:allowBackup="false"`, `android:fullBackupContent="false"` and `res/xml/data_extraction_rules.xml` excluding all domains from cloud backup and device-to-device transfer. HTTPS only (`network_security_config.xml`, system CAs only). Verification on a device: `docs/ANDROID_DEVICE_TEST_PLAN.md` D-32.
- iOS: op-sqlite stores databases under `Library/`, which iCloud backs up by default; excluding the file is an open iOS item (B-iOS-1, `docs/IOS_BUILD.md`).
- Consequence (to tell users): saved medications do not move to a new phone in v0.1.

## 6. Network privacy limitations (disclosed to users)

- The FDA and NLM operators (and their infrastructure providers) can see the device's IP address and the drug identifiers queried, as for any website.
- Network observers (Wi-Fi operator, ISP) can see that the app contacts `api.fda.gov`, `dailymed.nlm.nih.gov` and `rxnav.nlm.nih.gov` (TLS server name) but not the query contents.
- No certificate pinning in v0.1 (public government endpoints may rotate certificates; pinning risks outages). Standard Android certificate validation applies; user-installed CAs are not trusted in release builds.
- Shared or carrier IPs may cause rate limiting that the app cannot control.

Permissions: the Android app declares only `INTERNET` (test in `architecture_boundaries.test.ts`); the advertising-ID permission is explicitly removed. Text fields disable autofill and autocorrect so medication details are not added to keyboard dictionaries.

## 7. No third-party telemetry

- No analytics, crash reporting, advertising, attribution or remote-config SDKs.
- Dependency policy: every new dependency's network behavior is reviewed and recorded; a CI check (Task 6) scans the dependency tree and merged Android manifest for known telemetry SDKs and unexpected `INTERNET`-using libraries.
- Study metrics come from moderated sessions and questionnaires outside the app.

## 8. Logging

- Release builds log nothing that contains identifiers, OCR text or medication data.
- Debug builds may log state transitions with identifiers redacted.

## 9. Verification

Privacy tests PV-1…PV-6 in `docs/TEST_PLAN.md` enforce these rules (request audit, backup exclusion,
OCR offline operation, deletion, logging, manifest/dependency scan). Done in Task 3 at library
level:
- PV-1: the request audit and guard.
- PV-4: delete-all removes the database files and the key (Node SQLite).

Device-level verification (encryption at rest, backup exclusion, packet capture) remains for Task 6.
