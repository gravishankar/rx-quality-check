# Data Sources and Limitations — Rx Recall Check

Document ID: sources
Version: 0.1.0-draft
Status: DRAFT — LEGAL REVIEW REQUIRED

## Sources

| Source | Operator | Used for | Terms / license |
|---|---|---|---|
| openFDA Drug Enforcement Reports | U.S. Food and Drug Administration | Recall records | Data CC0 1.0; attribution requested (https://open.fda.gov/license/); Terms of Service (https://open.fda.gov/terms/) |
| openFDA NDC Directory | U.S. Food and Drug Administration | Product identification (NDC listing) | As above |
| RxNorm via RxNav | National Library of Medicine | Ingredient identifiers | https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html |
| DailyMed SPL | National Library of Medicine | Repackaged-product source | https://dailymed.nlm.nih.gov/dailymed/about-dailymed.cfm |

Data provided by the U.S. Food and Drug Administration (https://open.fda.gov) and the National
Library of Medicine. FDA and NLM do not endorse this app. openFDA states that its results are
unvalidated and should not be relied on for medical care decisions.

## Limitations

- **Incomplete or delayed data.** FDA Enforcement Reports may not include every recall, and entries
  can appear after a delay. FDA states that not all recalls have press releases.
- **Free-text records.** Recall records describe products and lots in free text. The app reads them
  conservatively: when it cannot read a record exactly, it treats the record as a possible match.
- **NDC listing is not approval.** A product's listing in the NDC Directory does not mean FDA
  approved that product.
- **Labeler is not necessarily the maker.** The company named in an NDC listing (the labeler) may not
  be the company that manufactured the medication. The app does not identify manufacturing sites.
- **Repackaged products.** A recall of an original product may not name the NDC of a repackaged
  product. The app links them only when official records confirm the relationship, and otherwise says
  the original product could not be determined.
- **Lot numbers.** Lot numbers you enter are compared with recall text only; they are not verified by
  FDA. A lot not found in a recall's list does not mean your supply is unaffected.
- **Your entries.** Results depend on the details you enter. Errors in entry can lead to wrong results.
- **Point in time.** Each result shows when it was retrieved. Results are not updated automatically
  and the app does not send recall alerts.
- **Per medication.** The app searches for the medication you check, not for all medications.
- **Excluded medications.** Some medications are not assessed by policy.
