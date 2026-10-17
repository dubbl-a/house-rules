# house-rules versus the Claude Code harness: research bank (2026-09-02)

What is here, and where it came from.

- `audit-report.md`: the synthesis of the first audit workflow (22 agents): 133 house rules and mechanisms classified against the official Claude Code docs as duplicate, conflict, complement, or unique; every duplicate-or-conflict claim was handed to two skeptics. Result: 0 confirmed duplicates, 0 confirmed conflicts, 78 complements, 55 uniques, 48 proposed rewords, a five-PR plan, 8 open questions.
- `audit-critic.md`: the completeness critic's notes after the first run (five unresearched areas, one skipped rule).
- `audit-addendum.md`: the second workflow (8 agents) over the gaps: MCP configuration and permissioning, output styles, plan mode, headless mode, observability, and the skipped docs rule. Result: still no duplicates or conflicts; 8 more rewords; 11 cited facts.
- `facts/`: the raw native-feature facts per area (feature, behavior, limits, enforcement, citation) as returned by the doc readers. These are the evidence base; each cites a code.claude.com page or a CLI help command as fetched on 2026-09-02.
- `classifications/`: per-item dispositions with evidence, action, and proposed wording.
- `workflows/`: the two workflow scripts, so the audit can be re-run when the harness docs change (pass a new date in args).
- `audit-page.html`: the report rendered as a page (also published as a private artifact).

Two earlier research banks live in the sibling directory `research/launch/` (launch checklist, prior art, positioning; 2026-09-01).

Open questions the audit could not settle from the docs are listed at the end of `audit-report.md`; the "resume file" question was settled afterward: `.claude/RESUME.md` is a real harness checkpoint artifact (trigger near-limit), seen in two adopting repos, last written 2026-08-15.
