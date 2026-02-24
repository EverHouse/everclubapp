# Agent Incident Log

This file tracks every instance where the agent failed to follow explicit instructions, ignored documented rules, or deviated from established processes. Each entry includes what was missed, the impact, and estimated wasted agent usage.

---

## Incident #1 — 2026-02-24
**Rule Violated:** Changelog updates are mandatory after every session with user-facing changes (documented in replit.md)
**What Happened:** Multiple sessions across Feb 23-24 produced 8 versions worth of changes (v8.13.0 through v8.20.0) without updating `src/data/changelog.ts` or `src/data/changelog-version.ts`. User had to explicitly remind the agent to do it.
**Estimated Wasted Usage:** ~3 messages (user reminder, agent catching up on all commits, writing 8 changelog entries retroactively)
**Corrective Action:** Moved changelog rule to top of replit.md under mandatory section.

## Incident #2 — 2026-02-24
**Rule Violated:** Load relevant skills before making any code changes (documented in replit.md)
**What Happened:** Agent jumped into code changes multiple times without first reading the relevant SKILL.md files, risking architectural violations. User had to repeatedly remind the agent to follow this process.
**Estimated Wasted Usage:** ~2 messages per occurrence (user reminders + potential rework from skipped patterns)
**Corrective Action:** Added explicit skill mapping table and bold mandatory header at top of replit.md.

---

*New entries must be added at the bottom, above this line. Format: Incident number, date, rule violated, what happened, estimated wasted usage, corrective action taken.*
