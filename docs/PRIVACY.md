# Privacy and Security Design

Principle: **the phone is the only place patient information exists.** The project operates no
servers and collects no data.

## 1. On-device OCR and image processing

- Camera frames are processed in memory by an on-device OCR and barcode engine (selection in Task 5, OD-5).
- Images are not written to disk and not uploaded. Temporary buffers are released after extraction. Saving a label photo is out of scope for v0.1.
- **Engine requirement:** the selected OCR/barcode library must run with no network access at inference time and must not transmit images, text or usage metrics. Libraries that download models or send diagnostics (some vendor SDKs do) must be configured to disable this, or be rejected. This is verified in Task 5 with a network capture during scanning (TEST_PLAN PV-3).
- Extracted text is shown to the user for confirmation and then reduced to structured fields; raw OCR text is not persisted.

## 2. Minimum necessary API queries

| Purpose | Sent to | Data sent |
|---|---|---|
| Identify product | api.fda.gov, rxnav.nlm.nih.gov | One NDC (or candidates derived from it), or an ingredient/strength name |
| Recall lookup | api.fda.gov | Ingredient keyword and/or product NDC |
| Establishment/labeling | dailymed.nlm.nih.gov | SPL set ID or package NDC |
| Freshness | all three | No identifiers |

Never sent: images, OCR text, lot or expiry, fill dates, pharmacy or prescriber names, patient names,
Rx numbers, medication lists, device identifiers, advertising IDs, app-install IDs, location.
Requests use a generic `User-Agent`, no cookies, no custom tracking headers.

Mitigation for drug-identity leakage (OD-4, recommended default): refresh recall data for **all 14
catalog drugs together** rather than only the user's medications, so recall queries do not reveal
which drug the user takes. Identity lookups (NDC → product) unavoidably reveal the scanned product
to the source operator.

## 3. Local data retention and deletion

- Stored: medications, fills (structured identity fields; optional user-entered lot), assessments, and a cache of public API responses (no patient data).
- Retention: until the user deletes. The public cache is pruned after expiry (ARCHITECTURE §9).
- Deletion: per fill, per medication, and "Delete all data" (drops and recreates the database, deletes the encryption key, clears the cache). Uninstall removes everything.
- No export of medical data in v0.1 except an explicit user-initiated share sheet (future; not in v0.1).

## 4. Encryption and secure key management

- SQLite database encrypted at rest with a SQLCipher-compatible library (choice in Task 3, OD-6).
- 256-bit random database key generated on first launch, wrapped by an Android Keystore key (hardware-backed where available), stored only in app-private storage.
- The key is never logged, exported or backed up. Losing it (e.g., after Keystore reset) means local data is unrecoverable; the app then offers a clean reset.
- Optional app lock (device biometric/PIN) is a candidate for Task 6; not required for v0.1.
- Release builds: R8/ProGuard on, debuggable off, no WebView remote debugging, cleartext traffic disabled (`usesCleartextTraffic=false`, network security config allowing only HTTPS).

## 5. Backup behavior

- `android:allowBackup="false"` and data-extraction rules excluding the database, shared preferences and caches from both cloud backup and device-to-device transfer.
- Consequence (to tell users): saved medications do not move to a new phone in v0.1.

## 6. Network privacy limitations (disclosed to users)

- The FDA and NLM operators (and their infrastructure providers) can see the device's IP address and the drug identifiers queried, as for any website.
- Network observers (Wi-Fi operator, ISP) can see that the app contacts `api.fda.gov`, `dailymed.nlm.nih.gov` and `rxnav.nlm.nih.gov` (TLS server name) but not the query contents.
- No certificate pinning in v0.1 (public government endpoints may rotate certificates; pinning risks outages). Standard Android certificate validation applies; user-installed CAs are not trusted in release builds.
- Shared or carrier IPs may cause rate limiting that the app cannot control.

## 7. No third-party telemetry

- No analytics, crash reporting, advertising, attribution or remote-config SDKs.
- Dependency policy: every new dependency's network behavior is reviewed and recorded; a CI check (Task 6) scans the dependency tree and merged Android manifest for known telemetry SDKs and unexpected `INTERNET`-using libraries.
- Study metrics come from moderated sessions and questionnaires outside the app.

## 8. Logging

- Release builds log nothing that contains identifiers, OCR text or medication data.
- Debug builds may log state transitions with identifiers redacted.

## 9. Verification

Privacy tests PV-1…PV-6 in `docs/TEST_PLAN.md` enforce these rules (request audit, backup exclusion,
OCR offline operation, deletion, logging, manifest/dependency scan).
