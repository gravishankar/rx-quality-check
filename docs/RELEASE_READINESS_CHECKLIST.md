# Release Readiness Checklist — v0.1.0 pilot (working name MedLuma; see config/brand.json)

No APK may be given to anyone outside the project team until **every** item below is satisfied and
`npm run release:gate` reports no blockers. Development APKs are for internal testing only.

Automated tests show that the code enforces its rules. They are **not** clinical validation, legal
review or regulatory clearance.

## A. Required sign-offs (recorded in `config/release_signoffs.json`)

Each sign-off needs `signed: true`, the reviewer's name, the date, and a reference to what was
reviewed (document version or commit). The release gate rejects a sign-off without a name and date.

| Key | Sign-off | Reviewer | Scope | Status |
|---|---|---|---|---|
| `regulatory_classification` | Regulatory classification | Regulatory counsel | `docs/LEGAL_REGULATORY_REVIEW.md` topics 1–3; intended-use statement | **Not signed** |
| `legal_review` | Legal review | Counsel | Five documents in `docs/legal/`; topics 4–12 | **Not signed** |
| `clinical_pharmacist_wording_review` | Clinical / pharmacist wording review | Licensed pharmacist or clinician | `mobile/src/copy/en.ts`, `docs/EVIDENCE_AND_CLAIMS_POLICY.md`, exclusion policy rationale | **Not signed** |
| `configuration_approval` | Configuration approval (OD-2) | Project team | Exact catalog and policy versions; set status `APPROVED` with effective date | **Not signed** |
| `security_testing` | Security testing | Security reviewer | Encryption at rest, key storage, backup exclusion, network allowlist, log scan, dependency review | **Not signed** |
| `android_device_testing` | Android device testing | Tester | `docs/ANDROID_DEVICE_TEST_PLAN.md` on ≥ 2 physical devices / Android versions | **Not signed** |

## B. Configuration and documents

- [ ] Product name cleared by trademark counsel; `config/brand.json` `name_status` set to
      `CLEARED_BY_COUNSEL` by the project team (currently `PROVISIONAL_CONFLICTS_FOUND` — docs/BRAND_CLEARANCE.md, OD-24)
- [ ] Decision whether to change application/bundle IDs to match the final name (before first distribution)

- [ ] `data/drug_catalog.json` status `APPROVED` (currently `DRAFT_PENDING_APPROVAL`)
- [ ] `data/exclusion_policy.json` status `APPROVED` (currently `PROPOSED_PENDING_APPROVAL`)
- [ ] `npm run config:validate` passes in release mode (no unapproved files)
- [ ] Five legal documents `Status: APPROVED`, placeholders ([LEGAL ENTITY NAME], [ADDRESS],
      [CONTACT EMAIL], governing law, liability section) completed by counsel; `npm run legal:bundle`
- [ ] Privacy Policy matches the build being released (data flows, encryption status)
- [ ] Application ID `org.rxrecallcheck.app` confirmed (cannot change after distribution)

## C. Security and privacy

- [ ] PV-4: SQLCipher encryption verified on a physical device (self-test passes **and** the database
      file pulled with `adb` is not readable as plain SQLite) → set
      `encryption_verified_on_device: true`
- [ ] Key stored in Android Keystore-backed storage; deleted by "Delete all data" (device check)
- [ ] Backup exclusion verified (`adb shell bmgr backupnow` / data extraction rules) on Android 12+
- [ ] Only permission: INTERNET (`aapt dump permissions`)
- [ ] Requests only to the three allowlisted hosts, with public identifiers only (proxy capture on device)
- [ ] No medication data in `adb logcat` for a release build
- [ ] Dependency review: each native library's network behavior documented (`docs/ARCHITECTURE.md` §Dependencies)

## D. Build

- [ ] Pilot signing key created and stored by the project team **outside the repository and outside the
      cloud environment**; properties file path passed with `-PrxrcPilotSigning=…`
- [ ] `npm run android:pilot` succeeds; SHA-256 recorded and given to testers
- [ ] All tests, typecheck, config tests, e2e (recorded and live) pass on the release commit

## E. Status at Task 4A (2026-11-12)

`npm run release:gate` → **14 blockers** (catalog, policy, five legal documents, six sign-offs,
device encryption). **A pilot build must not be produced.**

Task 4A.1 (2026-11-12): **15 blockers** — adds "product name is PROVISIONAL_CONFLICTS_FOUND, not
cleared by counsel". No sign-off or approval was changed.
