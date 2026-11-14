# Legal and Regulatory Review — issues list for counsel

Status: **PRELIMINARY ISSUES LIST — NOT LEGAL ADVICE — QUALIFIED COUNSEL MUST REVIEW.**
Prepared 2026-11-12 by the implementer (an AI coding assistant) for Rx Recall Check v0.1.0.

This document identifies authorities that may apply, what the app currently does, and what is
unresolved. It does **not** conclude that the app is legally compliant, that it is or is not a
medical device, that any exemption or enforcement-discretion policy applies, or that any disclaimer
limits liability. Those determinations require qualified legal and regulatory review. Sources were
read on 2026-11-12; they change and must be re-checked at review time.

## Jurisdictional assumptions

- Intended audience: adults in the **United States** using an Android phone (iOS later). No other
  country is in scope; distribution outside the U.S. would need a separate review.
- Developer/operator: **[LEGAL ENTITY NAME — not yet provided]**, state of organization unknown. Some
  analyses (governing law, state privacy laws, HIPAA business-associate status) depend on this.
- Distribution for the pilot: privately shared APK ("sideloading") to a limited group of testers;
  no app-store listing yet.
- No payment, no advertising, no accounts, no backend, no data received by the developer.

## Product facts relevant to every topic

| Fact | Where verified |
|---|---|
| Users type a medication's NDC, name, strength, form and optional lot | Entry screen |
| The app retrieves public FDA recall records and shows whether a record appears to match, might match, no match was identified in the sources checked, or it could not determine | Presentation layer |
| It gives no dosing or treatment instructions; it tells users not to stop or change medication because of the app and to contact a pharmacist/HCP | Copy file |
| It does not assess some medications by policy (e.g. anticoagulants, transplant immunosuppressants) | Exclusion policy |
| All patient data stays on the phone; only public identifiers go to api.fda.gov, rxnav.nlm.nih.gov, dailymed.nlm.nih.gov | Privacy audit tests |
| Saved history is disabled until encryption is verified on a device | Build profile |

---

## 1. FDA: device software functions and intended use

- **Authority.** FD&C Act §201(h) (device definition) and §520(o) (software functions excluded from
  the device definition); FDA guidance *Policy for Device Software Functions and Mobile Medical
  Applications* (Sept. 2022):
  https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications
- **Why it may apply.** Whether software is a device depends on its intended use, shown by labeling,
  claims and functionality. The app processes information about a specific patient's medication and
  outputs whether a recall may apply to it. Statements such as "check whether your medication is safe"
  could change the analysis.
- **Implementation status.** Claims are limited to retrieving and displaying public recall records
  with evidence and uncertainty (`docs/EVIDENCE_AND_CLAIMS_POLICY.md`); no diagnosis, treatment or
  dosing; prohibited-claims tests.
- **Unresolved.** Whether any function is a device function; whether it falls within a category FDA
  describes as low risk / enforcement discretion or as not a device; effect of the exclusion policy
  (which itself reflects risk judgments).
- **Mitigation.** Keep intended-use statement narrow and consistent across app, documents and any
  marketing; no "safety" claims.
- **Counsel review required:** Yes (regulatory counsel).

## 2. Informational software vs patient-specific decision support

- **Authority.** FD&C Act §520(o)(1)(E) and FDA guidance *Clinical Decision Support Software*
  (final guidance, reissued 2026):
  https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software
  and FAQ:
  https://www.fda.gov/medical-devices/software-medical-device-samd/clinical-decision-support-software-frequently-asked-questions-faqs
- **Why it may apply.** The §520(o)(1)(E) criteria address software intended for health care
  professionals. FDA's CDS guidance indicates that software intended for patients or caregivers is
  not within that statutory exclusion; patient-facing software is analyzed under other policies.
  Rx Recall Check is patient-facing and produces patient-specific outputs ("matches the details you
  provided").
- **Implementation status.** Outputs are framed as record retrieval with stated uncertainty; next
  steps always refer to a pharmacist/HCP and the official FDA notice.
- **Unresolved.** Whether patient-specific recall matching is "information" or a "recommendation";
  whether the CONFIRMED/POTENTIAL categories are a form of risk classification for regulatory
  purposes.
- **Mitigation.** No individualized advice; wording review by a pharmacist/clinician.
- **Counsel review required:** Yes.

## 3. Mobile medical app guidance (enforcement discretion categories)

- **Authority.** Same Sept. 2022 guidance (Appendices A–C list examples of software that is not a
  device, that FDA intends to exercise enforcement discretion for, and that is a device).
- **Why it may apply.** Examples include apps that help patients organize and track health
  information and apps that provide easy access to information related to health conditions.
- **Implementation status.** None; classification not determined.
- **Unresolved.** Which example, if any, describes this app; whether the guidance's examples remain
  current.
- **Counsel review required:** Yes.

## 4. FTC Act §5: truthful claims, privacy and security

- **Authority.** FTC Act §5 (unfair or deceptive acts); FTC *Health Products Compliance Guidance*
  (2022): https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance ;
  *Mobile Health Apps Interactive Tool*:
  https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool
- **Why it may apply.** Health-related claims need competent and reliable support; privacy and
  security statements must match actual practices; disclaimers do not cure a misleading net
  impression.
- **Implementation status.** Claims matrix ties each statement to evidence; privacy policy draft
  describes actual data flows; automated privacy audit of requests; no analytics/ads.
- **Unresolved.** Substantiation standard for "matches"/"may be affected" given free-text recall
  records; adequacy of security (encryption not yet verified on device).
- **Mitigation.** Do not ship persistence without verified encryption; keep privacy policy in sync
  with the build (checklist item).
- **Counsel review required:** Yes.

## 5. FTC Health Breach Notification Rule

- **Authority.** 16 CFR Part 318 (amended 2024):
  https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule ;
  https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318
- **Why it may apply.** The amended rule covers vendors of personal health records, including many
  health apps that draw information from multiple sources; a "breach" includes unauthorized
  disclosures, not only security incidents.
- **Implementation status.** The developer receives no data; requests carry only public identifiers
  to government APIs; no third-party SDKs.
- **Unresolved.** Whether the app is a "personal health record" (it draws data from more than one
  source: user entry and FDA/NLM); whether IP address + NDC queries to government services could be
  analyzed as a disclosure; incident response plan.
- **Counsel review required:** Yes.

## 6. HIPAA

- **Authority.** 45 CFR Parts 160 and 164. Covered entities:
  https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html ; apps and the right of
  access: https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html
- **Why it may apply.** Only if the developer is a covered entity or acts as a business associate
  (e.g., if a pharmacy or health plan offers the app to its patients).
- **Implementation status.** Consumer app, no covered-entity relationship known.
- **Unresolved.** Pilot recruitment channel (if through a pharmacy, clinic or health system, a BAA
  analysis is needed). Do **not** describe the app as "HIPAA compliant".
- **Counsel review required:** Yes, if any covered entity is involved.

## 7. State consumer health-data laws

- **Authority.** Washington My Health My Data Act, RCW 19.373:
  https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true ; Nevada SB 370 (2023):
  https://www.leg.state.nv.us/Session/82nd2023/Bills/SB/SB370_EN.pdf ; Connecticut Data Privacy Act as
  amended by PA 23-56 (consumer health data):
  https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act ; other states'
  comprehensive privacy laws.
- **Why it may apply.** Medication information is consumer health data. These laws can apply
  regardless of company size (e.g., WA MHMDA), require a consumer health data privacy policy, consent
  for collection/sharing, and provide a private right of action (WA).
- **Implementation status.** Data stays on device; developer does not "collect" in the ordinary
  sense; separate consumer-health-data policy not yet drafted.
- **Unresolved.** Whether on-device processing by the developer's software is "collection";
  whether transmitting public identifiers to government APIs is "sharing"; consent mechanics.
- **Counsel review required:** Yes.

## 8. Google Play health policies (if distributed through Google Play)

- **Authority.** Health apps declaration:
  https://support.google.com/googleplay/android-developer/answer/14738291 ; Health Content and
  Services policy: https://support.google.com/googleplay/android-developer/answer/16679511 ; Data
  safety section; Developer Program Policies.
- **Why it may apply.** Health apps must complete the declaration; medical-functionality and
  misleading-claims rules apply; Data safety disclosures must match behavior.
- **Implementation status.** Not distributed on Google Play. No ads ID, single INTERNET permission.
- **Unresolved.** Category choice; whether Play requires regulatory documentation for this category.
- **Counsel review required:** Yes, before any Play listing.

## 9. Product liability, negligence, misrepresentation

- **Authority.** State tort law (product liability, negligence, negligent misrepresentation),
  state consumer-protection (UDAP) statutes. No single official URL.
- **Why it may apply.** A false "no match" or false "match" could lead to harm (continuing a recalled
  product, or stopping a needed medication). Whether software is a "product" varies by state.
- **Implementation status.** Fail-closed design; uncertainty never becomes reassurance (tests);
  explicit "do not stop or change medication because of this app"; exclusion of high-risk drugs.
  The Terms of Use draft **does not** include a liability limitation — counsel must decide.
- **Unresolved.** Insurance; limitation of liability enforceability; pilot participant agreement;
  incident/complaint handling.
- **Mitigation.** Disclaimers are not relied on to make unsafe behavior acceptable.
- **Counsel review required:** Yes.

## 10. Third-party data attribution and API terms

- **Authority.** openFDA Terms of Service: https://open.fda.gov/terms/ ; openFDA license (CC0 1.0;
  attribution requested; no implied endorsement): https://open.fda.gov/license/ ; RxNav Terms of
  Service (rate limit 20 requests/second per IP; caching guidance):
  https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html ; DailyMed:
  https://dailymed.nlm.nih.gov/dailymed/about-dailymed.cfm ; FDA Enforcement Reports definitions:
  https://www.fda.gov/safety/enforcement-reports/enforcement-report-information-and-definitions ;
  recall classes 21 CFR 7.3: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-7/subpart-A/section-7.3
- **Why it may apply.** Attribution, no-endorsement statements, rate limits, and openFDA's statement
  that its data are not validated for clinical use.
- **Implementation status.** Attribution and "Neither FDA nor NLM endorses this app" in About and
  Data Sources document; client rate limiting and caching (Task 3); no API key used.
- **Unresolved.** Whether UMLS/RxNorm license terms apply to the RxNav data used (counsel to confirm).
- **Counsel review required:** Recommended.

## 11. Accessibility and disclosures

- **Authority.** No specific federal accessibility statute is confirmed to apply to a free private
  app; ADA Title III applicability to apps is unsettled; WCAG 2.2 is the common benchmark. FTC
  guidance on clear and conspicuous disclosures (e.g., .com Disclosures).
- **Implementation status.** System font scaling, ≥ 48 dp targets, labels for screen readers, tone
  stated in words (not color only), key disclosures on the same screen as results. Not yet tested
  with TalkBack on a device.
- **Unresolved.** Reading-level review; TalkBack testing; Spanish or other languages.
- **Counsel review required:** Recommended.

## 12. Private APK vs Google Play distribution

- **Authority.** Android developer verification requirements for apps installed on certified
  devices (rollout beginning 2026, with sideloading via an advanced flow / ADB for unverified apps):
  https://developer.android.com/developer-verification/guides ; Google Play policies (topic 8).
- **Why it may apply.** Private distribution avoids store review but not FDA/FTC/state law; future
  Android verification may require registering the developer identity and package name.
- **Implementation status.** Development APK only; pilot blocked by release gate; SHA-256 published
  with each build; application ID `org.rxrecallcheck.app` (placeholder domain — **must be confirmed
  before any distribution because it cannot be changed later**).
- **Unresolved.** Developer verification registration; tester agreement; IRB/human-subjects
  question if the pilot is research.
- **Counsel review required:** Yes.

## iOS (future)

Apple App Review Guidelines 1.4.1 (medical apps; regulatory clearance documentation may be
requested; inaccurate data) and 5.1.3 (health data):
https://developer.apple.com/app-store/review/guidelines/ — to be reviewed before TestFlight external
testing.

## Summary of required reviews

| Review | Responsible | Status |
|---|---|---|
| Regulatory classification (topics 1–3) | Regulatory counsel | Not started |
| Privacy (4–7) and consumer health data policy | Privacy counsel | Not started |
| Terms, liability, pilot agreement (9, 12) | Counsel | Not started |
| Data source terms (10) | Counsel | Not started |
| Wording (all patient-facing text) | Pharmacist/clinician | Not started |
