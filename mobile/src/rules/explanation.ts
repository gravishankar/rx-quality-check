/**
 * Explanation template selection for a recall finding. Deterministic; contains no patient-facing
 * text. Every explanation ends with SOURCES_AND_DATES and STANDING_DISCLAIMER (RG-5), and no finding
 * maps to wording that implies safety (RG-4 is enforced on the copy in Task 4).
 */
import type { RecallFinding } from '../models/evidence.ts';
import type { Explanation, ExplanationTemplate } from '../models/explanation.ts';
import type { MedicationIdentity } from '../models/identity.ts';

export function selectExplanation(identity: MedicationIdentity, finding: RecallFinding): Explanation {
  const headline: ExplanationTemplate = (() => {
    switch (finding.finding) {
      case 'CONFIRMED_MATCH':
        return 'RESULT_CONFIRMED_MATCH';
      case 'POTENTIAL_MATCH':
        return 'RESULT_POTENTIAL_MATCH';
      case 'NO_MATCH_FOUND':
        return 'RESULT_NO_MATCH_FOUND';
      case 'UNRESOLVED':
        return 'RESULT_UNRESOLVED';
      default: {
        const never: never = finding.finding;
        return never;
      }
    }
  })();

  const sections: ExplanationTemplate[] = [];
  sections.push(identity.level === 'PRODUCT' ? 'IDENTITY_PRODUCT_LEVEL' : 'IDENTITY_INGREDIENT_LEVEL_ONLY');
  const pot = finding.potential;
  if (pot.some((r) => r.reasons.includes('LOT_REQUIRED'))) sections.push('LOT_NEEDED_FOR_LOT_SPECIFIC_RECALL');
  if (pot.some((r) => r.reasons.includes('LOT_NOT_FOUND_IN_LISTING'))) sections.push('LOT_NOT_FOUND_IN_LISTING');
  if (finding.limitations.includes('SOME_QUERIES_INCOMPLETE')) sections.push('COVERAGE_INCOMPLETE');
  if (finding.limitations.includes('POSITIVE_CONTROL_NOT_PASSED')) sections.push('POSITIVE_CONTROL_FAILED');
  if (finding.limitations.includes('SOME_RECORDS_UNPARSEABLE')) sections.push('RECORDS_UNREADABLE');
  if (finding.finding === 'CONFIRMED_MATCH' || finding.finding === 'POTENTIAL_MATCH') sections.push('NEXT_STEP_CONTACT_PHARMACIST');
  sections.push('SOURCES_AND_DATES', 'STANDING_DISCLAIMER');
  return { headline, sections };
}
