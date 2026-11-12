# Patient-Facing Screen Designs (Task 4B, proposal only)

Text wireframes. Values in angle brackets are placeholders, not real data. All wording follows `docs/EVIDENCE_AND_CLAIMS_POLICY.md`: no scores, rankings,
safety verdicts, green/success styling or treatment advice; every evidence item shows source, date
and scope. Product name in wireframes: `[App]` (naming deferred).

## S. Scan (Task 4C, first)

```
┌ Scan your medication ─────────────────────────┐
│  [ live camera preview ]                      │
│  "Point at the barcode on the bottle or box." │
│  ( Take photo of pharmacy label )             │
│  ( Type it instead )                          │
│  Photos stay on this phone and are not saved. │
└───────────────────────────────────────────────┘
```
Detection → haptic + spoken "Barcode found". Failure after 10 s → "We couldn't read it. Try more light,
or type it instead." Camera denied → manual entry with no nagging.

## A. Identification with manual verification

```
┌ Is this your medication? ─────────────────────┐
│ ■ Matched in FDA records                      │
│   Product (NDC) 62756-142-02                  │
│   Metformin HCl 500 mg · tablet · extended rel│
│   Labeler (as listed by FDA): Sun Pharmaceutic│
│ ■ Read from your label — please check         │
│   Lot JKU4639A                     [ Edit ]   │
│ ■ Needs your input                            │
│   We could not read the strength. [ Type it ] │
│ ─────────                                     │
│ [switch] Product details match my label       │
│ [switch] I checked the lot number             │
│ ( Yes, these details match my label )         │
│ ( Rescan )   ( Change details )               │
└───────────────────────────────────────────────┘
```
Conflicts (e.g., scanned NDC belongs to a different strength than the printed text): box
**"Your label and FDA records disagree"** — "The NDC we read is listed for 1000 mg; your label says
500 mg. We did not use the NDC. Please check the label." (existing cross-validation behavior).

Imprint (later, 4D) — only when one labeler has several products: "Which marking is on your tablet?"
with options from RxNav; never asked to choose a factory.

## B. Regulatory evidence viewer (4D for provenance; 4E for inspections/letters, conditional)

```
┌ What public records say ──────────────────────┐
│ About your product (product-level)            │
│   Recall check: [existing result card]        │
│                                               │
│ Who is involved (from labeling, as listed)    │
│   Labeler: Bryant Ranch Prepack (repackager)  │
│   Repackaged from: NDC <source NDC> ✱         │
│   ✱ Declared in the repackager's FDA labeling.│
│                                               │
│ Facilities listed in the labeling (2)         │
│   These are the sites the labeling lists for  │
│   making this product. Public records do not  │
│   show which one made your supply.            │
│   ▸ Site A, City, Country (DUNS …)            │
│   ▸ Site B, City, Country (DUNS …)            │
│                                               │
│ Company-level records (not specific to a site)│
│   ▸ Warning letter to <Company>, 2025-03-04   │
│                                               │
│ Data: DailyMed label version …; FDA inspection│
│ data in this app as of 2026-11-01.            │
└───────────────────────────────────────────────┘
```

Facility detail (each candidate shown the same way, no ordering by severity):

```
┌ Site A — City, Country ───────────────────────┐
│ Listed in the labeling for: manufacture       │
│ FDA facility ID (FEI): 30xxxxxxx (matched by  │
│ registration number)                          │
│ FDA inspections (final classifications)       │
│   2025-06-12  Drugs  Official Action Indicated│
│     "FDA found objectionable conditions and   │
│      considered regulatory action." [What's   │
│      this?] [FDA record]                      │
│   2023-02-01  Drugs  No Action Indicated      │
│ Warning letters for this site                 │
│   2025-09-30  cGMP  [FDA letter]              │
│ ─────────                                     │
│ What this does and doesn't mean               │
│ • This site is one of 2 listed. Your supply   │
│   may have been made at another listed site.  │
│ • Inspections cover the site at a point in    │
│   time and may concern other products.        │
│ • Recent or pending inspections may not be    │
│   included yet.                               │
│ • Talk to your pharmacist if you have         │
│   questions. Do not stop or change a          │
│   medication because of this information.     │
└───────────────────────────────────────────────┘
```

States that must look different (wording):

| State | Text |
|---|---|
| No manufacturer listed | "The labeling for this product does not list a manufacturing site." |
| Facility not matched to FDA records | "We could not match this site to FDA inspection records." |
| No records in snapshot | "This version of the app has no FDA inspection records for this site (data as of …). This does not mean the site has not been inspected." |
| Source unavailable | "We couldn't reach the source. Nothing was checked." |
| Conflicting | "FDA records give different information about this site. We did not choose one." |
| Stale | "This information is from …, which is older than we accept. Please update the app." |

Unfavorable findings are shown in full, with date, scope and meaning, never hidden or softened; OAI and
warning letters use the neutral card style (no red alarm) and plain definitions from FDA.

## C. Refill comparison (after encrypted storage is verified)

```
┌ Compare with your last fill ──────────────────┐
│                Last fill        This fill     │
│ Medication     Metformin ER     Metformin ER  │
│ Strength       500 mg           500 mg        │
│ Form/release   tablet, ER       tablet, ER    │
│ Labeler        <labeler 1>      <labeler 2>   │  ← "Changed"
│ Product NDC    <NDC 1>          <NDC 2>       │  ← "Changed"
│ ─────────                                     │
│ The labeler and product changed. This is      │
│ common with generics. If you have questions,  │
│ ask your pharmacist.                          │
│ ( View records for this fill )                │
└───────────────────────────────────────────────┘
```
Strength, form or release change → "This is different from your last fill. Ask your pharmacist before
taking it." (identity difference, not a quality verdict; pharmacist wording review required).
