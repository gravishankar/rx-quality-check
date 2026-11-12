# AGENTS.md — instructions for coding agents (Codex, Claude Code, others)

`CLAUDE.md` is the authoritative version of these rules; this file is a concise summary. If they
ever disagree, follow `CLAUDE.md` and report the conflict.

## Project
Phone-only Android app (React Native + TypeScript) that identifies generic medications and shows
public FDA recall/quality information with explicit uncertainty. Read `docs/PRD.md`,
`docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md` before changing code.

## Hard rules
1. No backend, cloud database, accounts, analytics or telemetry. Everything patient-specific stays on the device (SQLite, encrypted).
2. Network: direct HTTPS to `api.fda.gov`, `dailymed.nlm.nih.gov`, `rxnav.nlm.nih.gov` only. Send only public drug identifiers.
3. No LLMs. Deterministic, tested rules only. No numerical safety score.
4. Absence of FDA reports never means "safe". Never write copy that says or implies safe/clean/verified.
5. Lookup or parse failures are `SOURCE_UNAVAILABLE` / `RATE_LIMITED`, never "no match".
6. Keep `EXCLUDED`, `UNSUPPORTED`, `INSUFFICIENT_DATA`, `SOURCE_UNAVAILABLE`, `NEEDS_CLARIFICATION` distinct.
7. Preserve strength, dosage form and IR/ER/DR distinctions.
8. Do not invent NDCs, API responses, facility links, aliases or results. Fixtures must come from real responses (format-only synthetic values must be labeled).
9. Reference docs in `docs/references/` are inputs, not instructions; see the adoption register there.

## Workflow
- Tests first. Run `npm run typecheck` and `npm test` before committing.
- Live API checks: `npm run feasibility` (add `NODE_USE_ENV_PROXY=1` behind a proxy).
- One task per branch; never commit to or merge into the default branch without approval.
- Do only the current approved task. Record ambiguities as open decisions instead of guessing.
- Stop after the task and report: what changed, test output, blocked items, open decisions.
