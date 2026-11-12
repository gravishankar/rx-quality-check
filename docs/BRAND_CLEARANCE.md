# Brand Clearance — "MedLuma" (preliminary screening)

- **Search date:** 2026-11-12
- **Performed by:** the implementer (an AI coding assistant), using a general web search engine.
- **Status:** **PRELIMINARY SCREENING ONLY — NOT A TRADEMARK CLEARANCE OPINION.** This is not legal
  advice. A trademark attorney must run a full clearance search (U.S. federal, state, common-law,
  international) before any public use of the name.
- **Result:** **Meaningful conflicts found** (below). `config/brand.json` records
  `name_status: PROVISIONAL_CONFLICTS_FOUND`, and the release gate blocks any pilot build until counsel
  sets `CLEARED_BY_COUNSEL`. No permanent rebrand was made: application IDs, bundle IDs, signing
  identities and the repository name are unchanged. MedLuma appears only in the owner-only
  development build and in draft documents.

## 1. Method and limitations

| Source | What was done | Limitation |
|---|---|---|
| USPTO Trademark Search (https://tmsearch.uspto.gov/) and TSDR (https://tsdr.uspto.gov/) | **Could not be queried**: the build environment's network policy blocks these hosts, and the search is a JavaScript application | USPTO status is **unverified**. Third-party indexes (Justia Trademarks, Markinton) were searched through a web search engine instead; they can be incomplete or out of date |
| Web search (businesses, products) | Queries for "MedLuma", "Med Luma", "Medluma" with health, pharmacy, software, app, company | Search engines do not show every business; results summarized from search snippets |
| Apple App Store / Google Play | Web search of store listings | Store search pages could not be opened directly; regional listings may be missed |
| Domains | DNS and RDAP lookups attempted | **Blocked** from the build environment (RDAP hosts not reachable; local DNS does not resolve external names). Domain availability is **unverified** |
| UK Companies House | Found through web search | Page itself could not be opened; details from the search snippet |

Nothing was purchased, filed or registered.

## 2. Findings

### 2.1 Same name, same field — **meaningful conflict**

| Finding | Field | Where | Evidence (from search results) |
|---|---|---|---|
| **MedLuma** — clinical AI knowledge platform by **Medcast** (Australia), integrated into Best Practice Software's Bp Premier for general practices; A$5.4 million investment led by Best Practice Software | Healthcare software (clinical decision information for professionals) | Australia; website medluma.ai | https://www.medluma.ai/ ; https://www.medluma.ai/about ; https://medcast.com.au/ ; https://www.talkinghealthtech.com/news/best-practice-software-and-medcast-go-live-with-medluma-australias-first-emr-embedded-governed-clinical-intelligence-platform ; https://www.mobihealthnews.com/news/anz/best-practice-integrate-clinical-ai-search ; https://tickernews.co/5-4-million-investment-in-medluma-enhances-australian-healthcare-ai/ ; https://studioldn.com.au/an-accessible-ai-platform-empowering-clinicians/ |
| **MedLuma** — consultancy for pharmaceutical medical affairs | Pharmaceutical services | website med-luma.com | https://www.med-luma.com/ |
| **MEDLUMA SKIN CLINIC LIMITED** (formerly ONPOINT AESTHETICS SHROPSHIRE LIMITED) | Aesthetics clinic company, reported dormant | United Kingdom (Companies House 14053078) | https://find-and-update.company-information.service.gov.uk/company/14053078 |

Why the first finding matters: it is the same word, used for **health-information software**, by
an established, funded company with a professional healthcare audience — the same audience named
as a possible future expansion for this app. Even without a U.S. registration, it creates a risk of
confusion, possible common-law or foreign rights, and a likely objection to a U.S. filing or app
store listing. Whether Medcast holds or has applied for U.S. or international registrations
(including Madrid Protocol extensions to the U.S.) is **unknown** and must be checked by counsel.

### 2.2 Similar names in health

| Name | Owner / use | Status found | Source |
|---|---|---|---|
| Luma Health (LUMAPAY, TOTAL PATIENT ENGAGEMENT …) | Luma Health, Inc., San Mateo CA — patient engagement software | Several live U.S. marks reported by third-party indexes | https://trademarks.justia.com/owners/luma-health-inc-4589719 ; https://markinton.com/company/luma-health-inc |
| MEDILUME (Reg. 2476213) | Medical illuminators | Cancelled 2008 | https://trademark.justia.com/755/79/medilume-75579233.html |
| MEDILUMINE (Reg. 5061765) | Classes 5 and 42 | Cancelled 2023 | https://markinton.com/trademark/medilumine-86356895 |
| Mediluma Limited | UK company incorporated Oct 2025 | Active (per index) | https://corpsignals.uk/companies/uk/mediluma-ltd-16798017.html |
| MedLumics | Spanish cardiac medical-device company | Active | https://f4.fund/startups/medlumics |
| Luma Care, Luma Wellness, Luma (haemoglobin tracker) | Health apps on the App Store | Listed | https://apps.apple.com/uy/app/luma-care/id1354965133 ; https://apps.apple.com/app/id6758512228 ; https://appadvice.com/app/luma-haemoglobin-tracker/1448515620 |

"Luma" is a crowded element in health branding; combined with "Med" it is weakly distinctive.

### 2.3 App stores

No app named exactly "MedLuma" was found on the Apple App Store or Google Play through web search
(2026-11-12). Several health apps use "Luma". Not verified by direct store search.

### 2.4 Domains

`medluma.ai` and `med-luma.com` are in use by the businesses above (search results). The status of
`medluma.com`, `.app`, `.health`, `.org`, `.co`, `.io` could **not** be verified (RDAP blocked).

## 3. Assessment (non-legal)

MedLuma has a **meaningful conflict**: an identical name for healthcare information software. A
permanent rebrand to MedLuma is **not recommended** until a trademark attorney reviews it. Options
for the owner:

1. Ask counsel for a full clearance search and opinion on MedLuma (U.S. classes 9, 42 and 44 at
   minimum; foreign rights of Medcast).
2. Shortlist alternative names and screen them the same way before investing in brand assets.
3. Keep MedLuma as an internal code name only (owner-only builds), which is the current state.

## 4. Requirements before any public use of a name (any name)

- Full trademark clearance by counsel: USPTO (federal), state registrations, common-law use, and
  the main export markets if relevant; classes 9 (downloadable software), 42 (SaaS / software
  services) and 44 (health information services).
- App store name availability (Apple App Store Connect reserves names on first use; Google Play
  checks for impersonation and confusingly similar names).
- Domain availability for the chosen name.
- Search for confusingly similar names in health and pharmacy (sound, appearance, meaning).
- Decision by the owner, recorded with the counsel opinion; then set `name_status` to
  `CLEARED_BY_COUNSEL` in `config/brand.json` and decide separately whether to change application
  IDs (Android IDs cannot change after distribution).
