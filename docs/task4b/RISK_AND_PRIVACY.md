# Risk and Privacy Assessment (Task 4B, proposal only)

Not legal advice; items marked ⚖ need counsel (`docs/LEGAL_REGULATORY_REVIEW.md`).

## Product and evidence risks

| Risk | Example | Mitigation | Residual |
|---|---|---|---|
| Implying a facility made the patient's supply | Showing one site's OAI for a 3-site product | Candidate framing; all sites shown equally; no aggregation; tests | Low–medium |
| Misattribution company ↔ facility | Warning letter to a corporate parent shown on a plant | Scope field; FEI-exact joins only; separate section | Low |
| Stale or incomplete regulatory data | Inspection after snapshot; pending OAI | Snapshot date on every card; STALE threshold; standing "may not be included" note | Medium |
| Alarm or false reassurance | OAI read as "dangerous"; no records read as "clean" | FDA definitions verbatim; neutral styling; "not included ≠ not inspected"; pharmacist referral; wording review | Medium |
| Defamation / unfair characterization of firms ⚖ | Old or resolved findings without context | Only verbatim first-party facts with dates, outcomes and links; no commentary; correction contact | Medium (counsel) |
| Regulatory classification of the app ⚖ | Facility evidence for a patient's own medication may be seen as patient-specific decision support | No recommendations or verdicts; intended-use statement update; regulatory review before pilot | Medium (counsel) |
| Scanner misreads | Digit error yields another product | Directory lookup + cross-validation (existing); confirmation per item; manual correction | Low |
| Rx number taken as NDC | Pharmacy label numbers | Anchored extraction, structure checks, directory + cross-validation, Rx-pattern exclusion; tests | Low |
| Data-source terms ⚖ | Scraping import alerts; Data Dashboard terms | No scraping in v1; downloads only; counsel reviews terms and attribution | Low–medium |

## Privacy assessment

| Data | Where | Leaves the phone? | Control |
|---|---|---|---|
| Camera frames / label photo | Memory only | No | Not written to disk/gallery/cache; discarded after recognition |
| OCR text (patient name, Rx number, pharmacy, directions) | Memory | No | Kept only to arm the request guard, then discarded |
| Product NDC, ingredient, SPL set ID | Requests to api.fda.gov, dailymed, rxnav | Yes (public identifiers, as today) | Allowlist + guard + audit tests |
| Lot, expiry, serial | Memory / encrypted record (if saved) | No | Serial not stored; lot only when confirmed |
| Regulatory snapshot | Bundled in app | No (download is part of app install) | Public data only |
| Scanner engine | Native library | **ML Kit: usage/diagnostic metrics may be sent to Google** | OD-27; traffic capture gate; disclosure or open-source engine |
| CAMERA permission | Android/iOS | — | Requested at first scan only; app fully usable without it |

New disclosures required: camera use, on-device processing, no image retention, engine telemetry
(if ML Kit), snapshot dates. Play Data safety and Apple privacy labels must match.

## Security

- Native scanner libraries expand the attack surface (image parsing): pin exact versions, review
  release notes, prefer maintained engines, keep R8 off until device-verified (unchanged).
- Snapshot integrity: SHA-256 in manifest, verified by tests at build time.
