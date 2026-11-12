<!--
Reference document PRD-Q. Supplied by the project owner as pasted text in the Task 4C message on
2026-11-12 ("adding the original PRD as chatgpt asked me to"). Saved verbatim as received; tables and
two diagrams ("bottle to factory chain", "proposed phases") were flattened or missing in the paste and
could not be reproduced. Design reference, not implementation instructions (see README.md).
-->

Drug Quality Score App: PRD
Oct 22, 2026 ·
Summary and problem
A patient app that tells you, in one glance, how much to trust the factory that made your pill: green, yellow, red or gray (can't verify), with the next step to take.
The problem. Generic drugs carry the labeler's name, not the factory's. One product can come from several plants, production can move between them without the NDC changing, and inspection results arrive late, unposted, or not at all. A motivated patient with an engineering background needed two full days, five data sources and several corrections to reach a defensible answer for six drugs.
The founder story. Three years of unexplained thyroid swings traced to a levothyroxine maker with a low-potency recall. Doctors kept changing the dose; nobody looked at the factory.
Why now. Public data finally exists in usable form (ProPublica Rx Inspector, FDA Data Dashboard downloads, WHO and UK inspection reports), and AI can do the cross-referencing a patient cannot. Public attention to generic drug quality is high.
Users and use cases
The first user is an adult on several long-term generics who has noticed a drug "not working the same" after a refill.
User
Situation
What they need from the app
Patient on a narrow-margin drug
Thyroid, warfarin, seizure drugs, lithium; lab values swing after refills
Which maker to lock in, and when to ask for a lab recheck
Patient on a drug with no lab check
Anastrozole, other cancer or hormone drugs
The best-documented maker, since no blood test confirms it works
Patient on many generics
Statin, blood pressure, HRT, supplements
One screen showing which bottles to worry about
Caregiver
Managing a parent's or partner's medications
The same view for someone else, shareable
Friend helping a friend
Like the anastrozole check
A plain summary to send

Core jobs:
Tell me who really made this bottle, down to the factory if it can be known.
Tell me how worried to be, and how sure you are.
Tell me what to ask my pharmacist or doctor, with the exact NDC to request.
Tell me when anything changes.
Goals, non-goals and success metrics
The app succeeds when a patient can go from pill bottle to a sourced, honest verdict and a pharmacist script in under 5 minutes.
Goals
Identify the product, maker and candidate factories from a label photo.
Score each factory on its full recent history, not its latest inspection.
Show data confidence separately, and never show green on weak or stale data.
Recommend better makers with NDCs a pharmacy can order.
Re-check monthly and alert only on changes that affect the user's factory.
Non-goals
Medical advice, dosing, or telling anyone to stop a drug.
Steering users to a pharmacy for commission (it would undermine trust).
Lab testing of pills 
Success metrics (targets to be set)
Share of scanned bottles resolved to a confirmed factory.
Share of verdicts with high data confidence.
Users who act: asked a pharmacist, switched makers, or got a lab recheck.
Zero verdicts later found wrong because of a data error (every error logged and fixed).
User experience
Five steps, each one screen: scan, confirm, verdict, act, monitor.
Scan. Photo of the pharmacy label and, if available, the manufacturer's bottle or box. The app reads NDC, MFR line, strength, lot number and pharmacy. A pill photo reads the imprint.
Confirm. The app shows what it found ("Rosuvastatin 10 mg, Novadoz label, made by MSN") and flags conflicts, for example an imprint that doesn't match the NDC. The user corrects anything wrong.
Verdict. One card per drug: color, a one-line reason, data confidence, and the factory (or "one of 2 possible factories"). Tap for the evidence: last 5 inspections with finding types, recalls, warning letters, foreign regulator actions, each with a source link and date.
Act. Better makers ranked the same way, with the NDC to request; a pharmacist script; a doctor note when a prescription change is needed; a lab recheck suggestion where a lab test exists (TSH, INR, LDL).
Monitor. Monthly re-score. Alerts only when something new touches the user's factory, drug or lot. A prompt to rescan when a refill arrives, since the maker can change.
Data model
The app resolves each bottle through five links to its factory, and stores what it knows and does not know at each link.

bottle to factory chain · 5 links, 1 gap
The dashed link is the one gap no public source closes: which factory made this lot. Until a maker or pharmacy partner supplies it, the app scores every candidate factory.
Facts stored per drug
Fact
Why it matters
Narrow-margin drug or not
Small differences matter more (thyroid, warfarin, some seizure drugs, lithium)
Lab test that confirms it works
TSH, INR, LDL: a recheck can catch a weak batch; anastrozole has none
Dosage form difficulty
Extended-release, patches, softgels and sterile products are harder to make well
Active ingredient (API) plant
A second factory in the chain; later phase

Data sources and their limits
No single source is complete or current, so the app must merge several and record where each fact came from and when.
Source
What it gives
Limits found in testing
DailyMed / FDA NDC Directory
NDC, labeler, strength, imprint, "Manufactured by" line, application number
Imprint data can conflict across sources (JSP 515 vs 523); brands often omit the maker
ProPublica Rx Inspector
NDC to candidate factories, inspection history per factory
Generics only; lags (missed a March 2025 inspection); cannot say which plant made a lot
FDA Data Dashboard
Inspection classifications, dates, findings (citations), downloadable datasets
Findings often never posted ("Posted Citations: No"); classification can lag 15+ months
FDA warning letters, import alerts, enforcement reports
Serious actions, import bans with exempted drugs, recalls by NDC and lot
Import alert exemptions must be matched drug by drug
Form 483 PDFs
Inspector's list of findings
Mostly scanned images; need OCR; many unpublished
Keypedia (formerly Global Key Solutions)
Newer inspections and 483 summaries
Third party; licensing and accuracy to confirm
WHO, UK MHRA, EU, Health Canada, TGA
Foreign inspections and GMP certificates
Often cover a different production line (sterile vs tablets) or are expired
FOIA requests
Full 483s and inspection reports
Months of delay; brand manufacturing sites usually redacted
Lot number to plant
Which factory made this bottle
Not public. Only the manufacturer knows

Scoring methodology
Every verdict has two parts, risk and data confidence, and low confidence shows gray, never green.
Risk (green, yellow, red) comes from the factory's evidence. Confidence (high, medium, low) comes from how complete and current that evidence is. The card shows both, for example "Yellow, medium confidence: plant unconfirmed."
Rules (draft; thresholds to be agreed)
#
Rule
Effect
1
Plant unconfirmed (several candidates)
Score by the worst candidate; confidence medium at most
2
Official Action (OAI), warning letter, import alert, or recall of this product within N years
Red
3
Recall of a different product at the same plant within N years
Yellow at least
4
Repeated VAI in the last 5 inspections, even if the latest is clean
Yellow
5
No FDA inspection on record in 3+ years
Cap at yellow; confidence low
6
Inspection held but unclassified for 6+ months
Flag "pending"; cap at yellow
7
Findings not posted for a VAI or OAI
Confidence medium at most; offer the FOIA template
8
Brand with undisclosed factory
Gray, not green
9
Foreign regulator non-compliance for this product line
Red; for a different line, yellow
10
Trend: improving (clean after VAIs) vs worsening (VAIs in a row)
Moves the score one step within its band

Finding weights, most to least serious: product test failures (dissolution, potency) and data integrity; uninvestigated failures; sterility and contamination control; cleaning; written procedures; paperwork and reporting only.
Every verdict stores its sources, their dates, the rules that fired, and the date it was computed, so it can be explained and audited.
Recommendations and safety guardrails
The app recommends conversations and makers, never medical decisions.
What it recommends
Up to 3 better makers for the same drug and strength, scored by the same rules, each with the NDC to request.
A pharmacist script: "Please order [drug] made by [maker], NDC [x], and keep dispensing it."
A doctor note when the prescription must change (brand only, "dispense as written").
A lab recheck about 6 weeks after a maker change, where a test exists (TSH, INR, LDL and ApoB, home blood pressure).
Brand option only when its factory can be named; otherwise shown as "can't verify."
Guardrails
Never say stop, skip or change a dose. Every red card says "keep taking it and talk to your pharmacist."
Say what is unknown in plain words ("plant unconfirmed," "findings not public").
A recall card states whether it matches the user's NDC, strength and lot; never alarm on other products.
Distinguish a verified fact from an inference, and show the source date on every fact.
Country-neutral language: score factories on evidence, never on geography.
Acceptance test cases
Any release must get all of these real cases right, from October 2026 research.
Case
Trap
Correct verdict
Levothyroxine, Jerome Stevens (Bohemia, NY)
Latest inspection clean (2024); 10 of 12 inspections VAI
Yellow, with trend "improving"; suggest TSH recheck
Rosuvastatin, MSN (NDC 72205-003)
Two candidate plants; one has a July 2025 inspection still unclassified
Yellow, medium confidence; "plant unconfirmed, result pending"
Telmisartan, Inventia (Ambernath)
Own product not recalled; same plant recalled chlorthalidone twice in 2026 for dissolution
Yellow; flag the plant-level recall
Progesterone, Bionpharma
Two plants; one plant's findings were on its sterile line, not capsules; ProPublica missed a 2025 inspection
Yellow; finding-line distinction shown
Anastrozole, Zydus (Ahmedabad)
Latest inspection a VAI; OAI in 2019, 2014, 2011; no inspection since 2022
Red (switch), not "monitor"
Brand Arimidex (ANI)
Famous name, factory undisclosed
Gray, can't verify
Estradiol patch, Mylan (St. Albans, VT)
None: 7 of 7 inspections clean
Green, high confidence
Imprint check
Sources disagree (JSP 515 vs 523)
Use the official label; flag the conflict

Legal, privacy and compliance
Scoring named companies and holding people's medication lists are the two biggest legal exposures; both need counsel before launch.
Scoring named manufacturers
Yuka, the model for this app, was taken to court by French meat processors over its ratings. Expect pushback from manufacturers.
Defenses to build in: every score traces to public, dated sources; the method is published; wording is factual ("FDA classified this inspection OAI"), never "unsafe" or "bad."
A correction process manufacturers and users can use, with response times.
Health data privacy
A medication list is health data. Most consumer health apps are not covered by HIPAA, but the FTC Health Breach Notification Rule applies, and several states have health-data laws.
Minimum: encryption, no selling or ad-sharing of health data, deletion on request, optional on-device or anonymous mode.
Medical device question
Software that gives treatment advice can fall under FDA device rules. Keeping to manufacturer information and "ask your pharmacist" guidance is meant to stay outside that; confirm with counsel.
Data licensing
Check terms of use for ProPublica, Keypedia and any paid data before commercial use.
MVP scope and phases
Start as a hand-run pilot that proves the scoring rules on real bottles, then build the app around rules that have survived review.

proposed phases · 3 phases, 2 gates
Phase 1 needs no code: the monthly prompt and scheduled check already in use, a shared sheet of scored factories, and the acceptance cases above. Version 1 of the app covers generics only; brands show gray until their factories can be named.
Risks and open questions
The largest risk is a confident wrong answer; the design leans toward "can't verify" over a guess.
Risks
Wrong factory match from stale or conflicting data, leading to a wrong color.
False alarm causes a patient to stop a drug despite the guardrails.
Manufacturer legal challenge to a score.
Data sources change terms, format or access.
Users treat green as a guarantee; inspection records cannot prove a single bottle is good.
Open questions
☐ What is N, the look-back for red (5 years? 7?), and does an old OAI fade with later clean inspections?
☐ How to weight foreign regulators against the FDA?
☐ Can we get lot-to-plant data from manufacturers or pharmacies through partnerships?
☐ Should active-ingredient (API) plants be scored in version 1 or later?
☐ Free, paid, or nonprofit model, given the no-commission rule?
☐ Pharmacist or pharmacologist advisor to review the rules?
☐ Build on an AI assistant plus a curated database, or a fully curated database?
