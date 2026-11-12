# Privacy Policy — {{PRODUCT_NAME}}

Document ID: privacy
Version: 0.1.2-draft
Status: DRAFT — LEGAL REVIEW REQUIRED
Product name: {{PRODUCT_NAME}} is a provisional working name inserted from config/brand.json; it is not trademark-cleared (docs/BRAND_CLEARANCE.md).
Applies to: {{PRODUCT_NAME}} pilot v0.1.0 (Android). Intended audience: users in the United States.

> Draft for legal review. It describes the app's actual design (docs/PRIVACY.md) and must be checked
> against the final build before publication. Bracketed items require owner input. Some state laws
> (for example Washington's My Health My Data Act, Nevada SB 370, Connecticut's consumer health data
> provisions) may require a separate consumer health data privacy policy; counsel to confirm.

## 1. Who is responsible

**[LEGAL ENTITY NAME]**, **[ADDRESS]**, **[CONTACT EMAIL]**.

## 2. Summary

- The app has no user accounts, no backend server operated by us, no advertising, no analytics and no
  tracking.
- Medication details you enter and results you save are stored **only on your phone**.
- To look up public records, the app sends **public drug identifiers** (NDC numbers, ingredient
  names, RxNorm codes, label document IDs) directly to government services. It never sends your name,
  prescription number, label photos, lot numbers, pharmacy details or medication history.
- You can delete all app data at any time in Settings.
- If you scan a label, the photo is taken by your phone's camera app into private app storage, read
  **on your phone**, and deleted immediately. It is never uploaded, never saved to your photo
  gallery, and never shared. The app does not need the camera permission.

## 3. Information on your phone

| Information | Why | Where |
|---|---|---|
| Medication details you enter or confirm (drug, strength, form, NDC, optional lot) | To identify the product and compare recall lot lists | On your phone |
| Saved results, with the data versions used | So you can review them later | On your phone (only in builds where encrypted storage is verified; development builds keep results in memory only) |
| Cached public FDA/NLM responses | To reduce repeat requests | On your phone |
| The version of these documents you saw | To show updated documents | On your phone |
| A label photo you take with Scan | To read the drug name, strength, NDC and (on original packages) lot | Processed in memory on your phone; the photo file is deleted right after reading; nothing from the photo is saved |
| Text read from the photo (including any name, prescription number or pharmacy printed on the label) | Only the drug fields are used; the rest is kept in memory to make sure it is never sent anywhere | Discarded when you leave the check |

We do not receive this information.

## 4. Information sent to public services

| Service | Operator | What is sent | Why |
|---|---|---|---|
| openFDA (api.fda.gov) | U.S. FDA | NDC numbers; ingredient names; a fixed check query | Product identification and recall records |
| RxNav (rxnav.nlm.nih.gov) | National Library of Medicine | NDC number; RxNorm concept code | Ingredient identification |
| DailyMed (dailymed.nlm.nih.gov) | National Library of Medicine | Label document (SPL) set ID | Identify the original product of a repackaged product |

These operators and their network providers can see your phone's IP address and the drug identifiers
requested, as with any website. The app does not control their logs. See their policies:
openFDA Terms of Service (https://open.fda.gov/terms/), RxNav Terms of Service
(https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html).

## 5. Security

Saved data is intended to be stored in an encrypted database with the key held in the phone's secure
key storage. **[STATUS: encryption has not yet been verified on a physical device; the pilot build
will not save history until it is.]** Your phone's own lock screen also protects the data.

## 6. Retention and deletion

Data stays on your phone until you delete it. "Delete all data" removes saved medications, results,
cached data and the database encryption key. Uninstalling the app removes app data. App data is
excluded from device backups.

## 7. Children

The app is not directed to children under 13. [COUNSEL: confirm COPPA position.]

## 8. Your choices and rights

Because we do not receive your information, we cannot access, correct or delete it for you; you can
do so on your phone. [COUNSEL: add state-specific rights statements as required.]

## 9. Changes

New versions are shown in the app. [OWNER: effective date.]

## 10. Contact

**[CONTACT EMAIL]**
