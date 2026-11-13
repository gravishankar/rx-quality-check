/**
 * All patient-facing text (English, United States). Single reviewed location (CLAUDE.md §4).
 *
 * Rules (docs/EVIDENCE_AND_CLAIMS_POLICY.md):
 *  - Never claim or imply that a medication is safe, recall-free, verified or approved.
 *  - Never give treatment instructions (stop, continue, switch). Refer to the pharmacist or
 *    healthcare professional and to the official recall notice.
 *  - Say "labeler (as listed by FDA)", never "manufacturer", for the company named in an NDC listing.
 *  - Keep sentences short (target reading level ≤ grade 8).
 *
 * `tests/unit/claims_and_copy.test.ts` scans this file and every screen for prohibited wording.
 * Sentences that must mention "safe" in a negated form are listed in REVIEWED_NEGATED_STATEMENTS
 * and are the only exceptions.
 *
 * Product and feature names come from config/brand.json via brand/brand.ts (Task 4A.1); never type
 * a product name here.
 */
import { BRAND } from '../brand/brand.ts';

const NAME = BRAND.productName;
const FEATURE = BRAND.features.recallCheck;

export const COPY = {
  app: {
    name: NAME,
    tagline: BRAND.tagline,
    feature: FEATURE,
    pilotBanner: 'Evaluation prototype. Not clinically validated. Do not use as the only basis for medication decisions.',
    devBanner: 'DEVELOPMENT BUILD — evaluation prototype for internal testing only. Not clinically validated. Saved history is turned off.',
    provisionalName: `${NAME} is a working name and may change.`,
  },

  disclaimer: {
    standing:
      'Not finding a recall does not mean a medication is safe or free of quality problems. FDA data can be incomplete or delayed. Do not stop, change or replace a prescribed medication because of this app. Talk to your pharmacist or prescriber.',
    exclusionNotSafety: 'Not checking some medications does not mean other medications are safe.',
    noTreatmentAdvice: 'This app does not give medical advice. It cannot tell you whether to take, stop or change a medication.',
    notMonitoring: 'This app checks only when you ask. It does not watch for new recalls or send alerts.',
  },

  firstLaunch: {
    title: 'Before you start',
    points: [
      `${FEATURE} in ${NAME} looks up public FDA recall records for a medication you enter.`,
      'It can tell you when a recall record appears to match, might match, or when no match was found in the records it could check.',
      'It cannot tell you whether a medication is right for you. Only your pharmacist or prescriber can.',
      'Your medication details stay on this phone. Only public drug codes are sent to FDA and the National Library of Medicine.',
      'If you scan a label, the photo is read on this phone and deleted right away. It is never uploaded.',
      'This app checks only when you ask. It does not send alerts about new recalls.',
    ],
    readTerms: 'Read the Terms of Use',
    readPrivacy: 'Read the Privacy Policy',
    readMedical: 'Read the Medical Disclaimer',
    acknowledge: 'I understand',
    acknowledgementNote: 'We record the version of these documents you saw, on this phone only.',
  },

  scan: {
    title: FEATURE,
    intro: 'Take a photo of your pharmacy label, or of the barcode on the original bottle or box.',
    button: 'Scan medication label',
    tips: [
      'Lay the bottle flat, or turn it so the drug name and NDC face the camera.',
      'Use good light and avoid glare. Fill the screen with the label.',
    ],
    privacy: 'The photo is read on this phone and deleted right away. It is never uploaded or saved to your photos.',
    typeInstead: 'Type the details instead',
    reading: 'Reading your label on this phone…',
    scannedNote: 'These details were read from your photo. Please check each one against your label.',
    rescan: 'Scan again',
    correct: 'Correct the details',
    unavailable: 'Scanning is not available on this phone yet. Please type the details.',
    cancelled: 'No photo was taken.',
    problemTitle: 'We couldn’t read your label',
    nothingRead: 'We could not find any text or barcode in the photo.',
    noDrugFields: 'We found text, but not a drug name, strength or NDC.',
    failed: 'The photo could not be read.',
    retryTips: 'Try again with more light, closer to the label, and without glare. Or type the details.',
    barcodeTextDiffer: 'The barcode and the printed NDC point to different products. We will check both against FDA records; please look at your label carefully.',
    groups: {
      VERIFIED: 'Matched in FDA records',
      READ_OR_ENTERED: 'Read from your label — please check',
      NEEDS_INPUT: 'Needs your input',
    },
    details: 'Scan details (development)',
    technical: 'Technical detail (development)',
    nothingChecked: 'Nothing was checked',
    partialRead: 'We read some details from your photo. Please check them against your label and fill in what is missing. Nothing has been checked yet.',
  },

  entry: {
    title: FEATURE,
    intro: 'Check one medication against public FDA recall records.',
    ndcLabel: 'NDC from the label (if shown)',
    ndcHelp: 'Example: 62756-142-02. Leave blank if your label has no NDC.',
    nameLabel: 'Drug name as printed',
    strengthLabel: 'Strength as printed',
    formLabel: 'Form (tablet, capsule, solution)',
    lotLabel: 'Lot number (optional)',
    lotHelp: 'Only on original packaging. Lot numbers are never sent anywhere.',
    submit: 'Find this medication',
    noCamera: 'Type the details exactly as printed on your label.',
  },

  confirm: {
    title: 'Is this your medication?',
    intro: 'Please check each detail. We show where each one came from.',
    confirmAll: 'Yes, these details match my label',
    edit: 'Change details',
    releaseQuestion: 'Does the label say ER, XR, XL, SR, DR or EC (extended or delayed release)?',
    releaseIR: 'No (regular release)',
    releaseER: 'Yes, extended release (ER, XR, XL, SR)',
    releaseDR: 'Yes, delayed release (DR, EC)',
    lotConfirm: 'I checked the lot number against my package',
    ndcNotFoundTitle: 'NDC not found',
    ndcNotFound: 'We could not find this NDC in FDA’s directory. The details below are what you typed. They were not checked against FDA records.',
  },

  evidence: {
    VERIFIED_SOURCE: 'From FDA records',
    USER_CONFIRMED: 'Entered and confirmed by you',
    SCANNED: 'Read from your label, not checked against FDA records',
    USER_ENTERED: 'Entered by you, not checked against FDA records',
    INFERRED: 'Matched by name only',
    CONFLICTING: 'FDA records disagree',
    UNVERIFIED: 'Not checked',
    UNAVAILABLE: 'Could not be determined',
  },

  fields: {
    product: 'Product (NDC)',
    ingredients: 'Ingredient and strength',
    form: 'Form',
    release: 'Release type',
    labeler: 'Labeler (as listed by FDA)',
    lot: 'Lot number',
    source: 'Repackaged from',
    ndcListingNote: 'Listed in the FDA NDC Directory. A listing is not FDA approval of this product.',
    labelerNote: 'The labeler is the company named in the FDA listing. It may not be the company that made the medication.',
    lotNote: 'Your lot number is compared with the text of recall notices only. It is not checked by FDA.',
    lotUnconfirmedNote: 'Turn on the lot number item below to use it in the check.',
    sourceVerified: 'Declared in the repackager’s FDA labeling and found in the FDA NDC Directory.',
    sourceUnknown: 'We could not confirm which product this was repackaged from.',
    sourceNotChecked: 'Not checked.',
    sourcePartial: 'Only partly confirmed: part of the chain of repackaging could not be checked.',
    conflict: 'FDA records give different information for this product. We did not choose one.',
    releaseValues: { IR: 'Regular release', ER: 'Extended release', DR: 'Delayed release', UNSPECIFIED: 'Not known' },
  },

  result: {
    /** Short label shown on every result, so the four outcomes are easy to tell apart. */
    categoryLabel: {
      CONFIRMED: 'Recall match found',
      POTENTIAL: 'Possible recall match',
      NO_MATCH: 'No matching recall found in the FDA records checked',
      UNABLE: 'Could not determine',
    },
    CONFIRMED: {
      headline: 'Available recall information matches the medication details you provided.',
      tone: 'This means a recall record names your product and its conditions appear to apply.',
    },
    POTENTIAL: {
      headline: 'This medication may be affected by a reported recall. More information is needed to determine whether your specific supply is included.',
    },
    NO_MATCH: {
      headline: (asOf: string) =>
        `No matching recall was identified in the sources successfully checked as of ${asOf}. This does not establish that the medication is free from recalls or other quality problems.`,
    },
    UNABLE: {
      headline: 'We could not reliably determine whether this medication is affected by a recall.',
    },
    qualifiers: {
      productNotIdentified: 'We could not identify your exact product, so we checked by ingredient, strength and form only.',
      sourceNotEstablished:
        'This product appears to be repackaged, and we could not confirm the original product. Recalls listed under the original product may not have been found.',
      sourceUnavailable: 'We could not check whether this product was repackaged from another product.',
      sourcePartial:
        'This product was repackaged, and we could confirm only part of where it came from. Recalls listed under the original product may not have been found.',
      sourceNotChecked:
        'We did not check whether this product was repackaged from another product. If it was, recalls listed under the original product may not have been found.',
      lotNotProvided: 'Some recalls apply only to certain lot numbers. You did not enter a lot number.',
      userEnteredIdentity: 'The medication details were entered by you and were not matched to an FDA product listing.',
    },
    downgrade: {
      staleResult: (asOf: string) => `This result is from ${asOf}. It is too old to rely on. Please check again.`,
      staleSource: (date: string) => `FDA’s recall data was last updated on ${date}, which is older than we accept. Please check again later.`,
      incomplete: 'Some FDA records could not be retrieved or read completely.',
      searchIncomplete: 'Our search of FDA’s recall records did not cover every name this medication is known by, so we cannot say no recall was found.',
      datasetDateInvalid: 'The date FDA gave for its recall data could not be read or is in the future, so we cannot rely on this search.',
      datasetDateUnknown: 'FDA did not say when its recall data was last updated.',
      controlFailed: 'Our check that FDA’s recall search is working did not pass.',
      inconsistent: 'The result did not meet our evidence rules, so we are not showing it. This has been flagged for review.',
      unreadable: 'Some recall records could not be read.',
    },
    nextSteps: {
      contactProfessional: 'Contact your pharmacist or healthcare professional about this result.',
      readNotice: 'Read the official recall record for details and any instructions.',
      doNotChange: 'Do not stop, change or replace a prescribed medication because of this app alone.',
      checkAgain: 'Check again',
    },
    record: {
      recallNumber: 'Recall number',
      classification: 'FDA classification',
      status: 'Status',
      reportDate: 'Report date',
      firm: 'Recalling firm (as published)',
      reason: 'Reason (as published)',
      lotListed: 'Your lot number appears in this recall’s list of lots.',
      lotPossiblyListed: 'A similar lot number appears in this recall. Ask your pharmacist to check.',
      lotNotFound: 'Your lot number was not found in the listed lots. That does not mean your supply is unaffected.',
      lotUnknown: 'This recall lists specific lots. Without your lot number we cannot tell if yours is included.',
      allLots: 'This recall covers all lots.',
      officialRecord: 'Official FDA record',
      // Plain-language versions of 21 CFR 7.3(m) (https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-7/subpart-A/section-7.3).
      classExplanation: {
        'Class I': 'FDA Class I: there is a reasonable chance that using the product will cause serious health problems or death.',
        'Class II': 'FDA Class II: using the product may cause temporary or medically reversible health problems, or the chance of serious health problems is remote.',
        'Class III': 'FDA Class III: using the product is not likely to cause health problems.',
        'Not Yet Classified': 'FDA has not yet classified this recall.',
      } as Record<string, string>,
      fdaRecallPages: 'FDA Enforcement Reports (official recall listings)',
      statusNote: 'Status is as published by FDA. A completed or terminated recall does not mean the product is safe, and the status does not describe your supply.',
      // Task 4C build 7: plain-language record details.
      recallStarted: 'Recall started',
      fdaReportDate: 'FDA report date',
      closedOn: 'FDA closed the recall on',
      product: 'Product (as published)',
      lots: 'Lots and codes (as published)',
      moreDetails: 'More about this record',
      lessDetails: 'Show less',
      notStated: 'Not stated in the record',
      statusExplanation: {
        Ongoing: 'Ongoing: the recall is still in progress.',
        Completed: 'Completed: the recalling firm reports that its recall actions are finished.',
        Terminated: 'Terminated: FDA has closed this recall.',
        Pending: 'Pending: FDA has not finished reviewing this recall.',
      } as Record<string, string>,
      whyExcluded: 'Why it does not apply to the product you confirmed',
      alsoDiffers: 'Also differs',
    },
    /** One-sentence summary of every record the search returned (counts only; build 7). */
    summary: {
      none: (drug: string) => `FDA's recall search returned no recall records for ${drug}.`,
      intro: (n: number, drug: string) => `We checked ${n} FDA recall record${n === 1 ? '' : 's'} for ${drug}:`,
      matches: (n: number) => `${n} ${n === 1 ? 'matches' : 'match'} your product`,
      possible: (n: number) => `${n} might match`,
      unreadable: (n: number) => `${n} could not be read`,
      excluded: (n: number) => `${n} ${n === 1 ? 'was' : 'were'} for a different product`,
    },
    limitsTitle: 'Important limits of this result',
    showMorePossible: (n: number) => `Show ${n} more record${n === 1 ? '' : 's'} that might match`,
    excluded: {
      title: 'Records for a different product',
      intro: (n: number) =>
        `${n} record${n === 1 ? '' : 's'} named a different product, so ${n === 1 ? 'it does' : 'they do'} not apply to the product you confirmed. Each record is counted once:`,
      overlap: (n: number) =>
        `${n} of ${n === 1 ? 'this record' : 'these records'} differed in more than one way; each is counted under the first difference in this list.`,
      show: (n: number) => `Show ${n === 1 ? 'this record' : `these ${n} records`}`,
      hide: 'Hide these records',
      // Primary reasons, in the fixed order used for counting (first difference wins).
      reasons: {
        COMBINATION_PRODUCT: 'A combination product (contains another medicine as well)',
        DIFFERENT_SALT: 'A different form of the ingredient (a different salt)',
        NON_ORAL_OR_NOT_FINISHED_PRODUCT: 'Not a medicine taken by mouth, or not a finished product',
        DOSE_FORM_DIFFERS: 'A different dosage form',
        RELEASE_DIFFERS: 'A different release type (for example, extended-release)',
        STRENGTH_DIFFERS: 'A different strength',
        TEXT_NDC_NAMES_OTHER_PRODUCTS: 'Lists other product codes (NDCs), not yours',
        STRUCTURED_NDC_EXCLUDES_PRODUCT: "FDA's product codes for the recall belong to other companies",
        OTHER: 'Another difference recorded by the app',
      } as Record<string, string>,
    },
    groups: {
      matches: 'Recalls that match your product',
      possible: 'Recalls that might match',
      unreadable: 'Records we could not read',
    },
    sources: {
      title: 'What we checked',
      retrieved: (at: string) => `Retrieved on this phone: ${at}`,
      datasetUpdated: (d: string) => `FDA recall data last updated: ${d}`,
      queries: (n: number, complete: number) => `${complete} of ${n} searches completed fully`,
      control: (passed: boolean) => (passed ? 'Search check passed' : 'Search check did not pass'),
      refresh: 'This result is not updated automatically.',
      perMedication: 'We searched for this medication only. Other medications were not checked.',
    },
  },

  notAssessed: {
    cardLabel: 'No recall check was done',
    EXCLUDED: {
      headline: 'We don’t check this medication.',
      body: 'This is a policy choice, not a finding about the medication. No recall check was done.',
    },
    UNSUPPORTED: {
      headline: 'This medication or form is not covered by this version of the app.',
      body: 'No recall check was done.',
    },
    NEEDS_CLARIFICATION: {
      headline: 'We need more information before we can continue.',
      body: 'We could not tell whether this medication is covered. No recall check was done.',
    },
    configBlocked: {
      headline: 'Recall checks are turned off in this build.',
      body: 'The app’s drug list or policy has not been approved for this build, so no recall check can be done.',
    },
  },

  working: {
    identify: 'Looking up your medication in the FDA NDC Directory…',
    search: 'Searching FDA recall records… This can take up to a minute.',
    other: 'Working…',
  },

  errors: {
    sourceUnavailable: { headline: 'We couldn’t reach FDA’s data.', body: 'Nothing was checked. Please try again later.' },
    rateLimited: { headline: 'FDA’s service asked us to wait.', body: 'Nothing was checked. Please try again in a few minutes.' },
    offline: (asOf: string) => `You are seeing a saved result from ${asOf}. It was not updated.`,
    notFound: 'We could not find this NDC in FDA’s directory. Please check the number, or leave it blank.',
    missing: 'Please enter the drug name, strength and form.',
    ambiguous: 'This number matches more than one product. Please choose yours.',
    generic: 'Something went wrong. Nothing was checked.',
    retry: 'Try again',
  },

  history: {
    title: 'Saved checks',
    empty: 'No saved checks.',
    disabled: 'Saving is turned off in this build because storage encryption has not been verified on a device.',
    madeUnder: (v: string) => `Checked with drug list and policy version ${v}`,
    outdated: 'Made with an older drug list or policy. Check again for a current result.',
    deleteOne: 'Delete',
    storageFailed: {
      KEY: 'Saved checks cannot be opened: the phone’s secure key for them is not available. Nothing new will be saved.',
      OPEN: 'Saved checks cannot be opened on this phone right now. Nothing new will be saved.',
      MIGRATION: 'Saved checks were made by a newer or different version of the app and cannot be opened. Nothing new will be saved.',
      DELETE: 'Deleting the data on this phone did not finish. Please try again, or remove the app’s storage in the phone’s settings.',
    },
    /** Which bottle a saved check was made for (review item 6). */
    fillLine: (ndc: string, lot: string | null, checkedAt: string) => `Bottle: NDC ${ndc}${lot ? `, lot ${lot}` : ', no lot entered'}. Checked ${checkedAt}.`,
  },

  about: {
    title: 'About and privacy',
    version: (v: string, build: number, profile: string) => `${NAME} version ${v} (build ${build}) — ${profile}`,
    deleteAll: 'Delete all data on this phone',
    deleteAllConfirm: 'Delete all saved medications and results from this phone? This cannot be undone.',
    deleted: 'All data on this phone was deleted.',
    sources: 'Data sources and limitations',
    documents: 'Legal documents',
    draftNotice: 'These documents are drafts pending legal review.',
    attribution:
      'Data from the U.S. Food and Drug Administration (openFDA) and the National Library of Medicine (RxNorm, DailyMed). Neither FDA nor NLM endorses this app.',
  },
} as const;

/**
 * Reviewed sentences that mention safety only to deny it. They are the only places where the word
 * "safe" may appear in patient-facing text.
 */
// Build 7: the recall-status note says a completed or terminated recall does not mean the product is safe.
export const REVIEWED_NEGATED_STATEMENTS: readonly string[] = [COPY.disclaimer.standing, COPY.disclaimer.exclusionNotSafety, COPY.result.record.statusNote];

/** Every string in COPY (for wording tests). Functions are sampled with a placeholder. */
export function allCopyStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)('[x]', '[x]')));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(COPY);
  return out;
}
