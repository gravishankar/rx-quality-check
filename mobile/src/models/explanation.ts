/**
 * Explanation model: which patient-facing templates a result screen must show. Copy itself is
 * written in Task 4 (mobile/src/copy/); this model only selects template keys, so every screen
 * carries sources, dates, limitations and the standing disclaimer (RG-5).
 */

export type ExplanationTemplate =
  | 'RESULT_CONFIRMED_MATCH'
  | 'RESULT_POTENTIAL_MATCH'
  | 'RESULT_NO_MATCH_FOUND'
  | 'RESULT_UNRESOLVED'
  | 'IDENTITY_PRODUCT_LEVEL'
  | 'IDENTITY_INGREDIENT_LEVEL_ONLY'
  | 'LOT_NEEDED_FOR_LOT_SPECIFIC_RECALL'
  | 'LOT_NOT_FOUND_IN_LISTING'
  | 'COVERAGE_INCOMPLETE'
  | 'POSITIVE_CONTROL_FAILED'
  | 'RECORDS_UNREADABLE'
  | 'NEXT_STEP_CONTACT_PHARMACIST'
  | 'SOURCES_AND_DATES'
  | 'STANDING_DISCLAIMER';

export interface Explanation {
  headline: ExplanationTemplate;
  sections: ExplanationTemplate[];
}
