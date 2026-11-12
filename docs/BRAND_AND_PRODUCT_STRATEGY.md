# Brand and Product Strategy

Status: working draft (Task 4A.1, 2026-11-12). The product name is **provisional** and has a known
conflict (`docs/BRAND_CLEARANCE.md`); nothing here is trademark clearance or legal advice.

| Item | Working value | Source of truth |
|---|---|---|
| Product name | **MedLuma** (provisional, conflicts found) | `config/brand.json` → `product_name`, `name_status` |
| Tagline | *Know your medication. Understand the evidence.* | `config/brand.json` → `tagline` |
| First feature | **Medication Recall Check** | `config/brand.json` → `features.recall_check` |
| Version | 0.1.0 | `config/brand.json` → `app_version` (Android `versionName`, app About screen) |
| Legal entity | `[LEGAL ENTITY NAME]` — not yet provided | `config/brand.json` → `legal_entity` |
| Unchanged identifiers | Android/iOS ID `org.rxrecallcheck.app`, repository `rx-quality-check`, signing keys | Not derived from the brand; change only after owner approval of a final name |

## 1. Positioning: consumer first

The app helps **patients and caregivers** understand public FDA recall information about the
medications they hold, with honest evidence and clear limits. It is a calm, private, on-device
helper, not a clinical tool and not a monitoring service.

- **Promise:** show what public records say about *your* product, where the information came from,
  and what could not be determined.
- **Not promised:** safety, accuracy guarantees, completeness, alerts, or treatment advice.

## 2. Personas

| Persona | Situation | Needs | Design response |
|---|---|---|---|
| **Maria, 58, managing her own medicines** (metformin, a statin) | Heard about a recall on the news; anxious | Quick, clear answer about *her* bottle; what to do next | Manual entry, confirmation of each detail, plain headline, "contact your pharmacist", no alarm styling |
| **James, 44, caregiver for his father** (several prescriptions, different pharmacies) | Checks medicines on his father's behalf | Confidence about which product was checked; something to show the pharmacist | Evidence labels (from FDA vs entered by you), official record links, recall number |
| **Priya, 31, cautious and privacy-minded** | Doesn't want health data online | Proof that nothing personal leaves the phone | No accounts, local-only data, clear privacy summary, delete-all |

Out of scope for v0.1: professional users (pharmacists, clinicians) — see §6.

## 3. Brand voice

**Warm, clear, credible, non-alarmist.**

| Do | Don't |
|---|---|
| Short sentences (grade ≤ 8), plain words ("lot number", "label") | Jargon without explanation |
| State what was checked and when | Imply completeness ("all recalls") |
| Name uncertainty plainly ("We could not determine…") | Hide uncertainty in fine print |
| Neutral, steady tone for every result | Red alarms for possible matches, green ticks for no match |
| Point to the pharmacist and the official notice | Tell people to stop, continue or switch medicines |
| "Labeler (as listed by FDA)" | "Manufacturer" for a labeler |

## 4. Evidence-based messaging standards

Every marketing line, store listing, screen and document follows
`docs/EVIDENCE_AND_CLAIMS_POLICY.md`:

- No claim stronger than the evidence; no "safe", "verified", "recall-free", "guaranteed",
  "100%", "FDA-approved app", "clinically validated" — enforced by tests for app text.
- The tagline promises understanding, not safety. "Know your medication" refers to identifying the
  product the user holds (from FDA listings and the user's own confirmation), not to clinical
  knowledge.
- Marketing copy (future website, store listing) must be reviewed against the same policy and by
  counsel before publication (FTC truthful-claims standard; `docs/LEGAL_REGULATORY_REVIEW.md` §4).
- Data attribution: "Neither FDA nor NLM endorses this app" wherever data sources are named.

## 5. Capabilities

| Stage | Capability | Status |
|---|---|---|
| v0.1 (now) | **Medication Recall Check**: manual entry, identity confirmation, FDA recall evidence with sources and limitations, exclusions, delete-all | Development build; pilot blocked by release gate |
| Next (Task 4B, not started) | Encrypted history once verified on device; device-test fixes | Planned |
| Later (Task 5, not started) | Label scanning (camera/OCR on device), refill comparison | Planned |
| Candidate | Additional consumer features under the same brand (e.g., label information lookups), each added as a new `features.*` entry with its own claims review | Not approved |

Architecture: the brand is presentation-only configuration; a new feature adds a feature entry
and screens without changing the core identity or the engine.

## 6. Possible professional expansion (not now)

Pharmacists and healthcare organizations are a **possible** future audience, only with demonstrated
demand and appropriate regulatory review (professional decision-support may change the FDA analysis;
`docs/LEGAL_REGULATORY_REVIEW.md` §1–3). No professional workflows, accounts, integrations or
dependencies are introduced now. Note: the identical name "MedLuma" is already used by a
professional clinical-AI product (Australia), which makes this expansion path especially sensitive
for the current working name.

## 7. Naming clearance requirements

See `docs/BRAND_CLEARANCE.md` §4. In short: counsel clearance (USPTO, state, common law; classes 9,
42, 44), app-store and domain availability, similar-name review, owner decision. Until then the
name is used only in owner-only builds and draft documents, and the release gate blocks a pilot.
