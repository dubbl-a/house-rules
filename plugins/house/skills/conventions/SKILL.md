---
name: conventions
description: Looks up which house rule covers a topic by searching .house/INDEX.md, never the rule bodies; use for what is the house rule for X and is there a house convention for X.
---

# House conventions lookup

This skill answers one question: what does house say about a topic, and where does that live. It reads the index the render step produces, never the rule files themselves. That is the whole point of the index: a lookup should cost one small file, not every rule file in the repo.

## Default path

1. Read `.house/INDEX.md` at the repo root. Do not open any file under `.claude/rules/**`, `docs/handbook/**`, or `plugins/house/modules/**/rules/**` to answer the question. The index carries file, heading, and a one-line why for every vendored rule, and that is enough to answer most lookups on its own.
2. Search the index for entries whose file, heading, or one-line why matches the question. Match on meaning and keywords, not exact wording. A question about commit messages should match a heading about commits even when the words differ.
3. List every match, not just the first one. A topic can legitimately live in more than one rule file (a docs rule and an engineering rule can both bear on the same question), and dropping a real match makes the answer wrong by omission.
4. For each match, report the rule file path, the heading, and the index's one-line why, verbatim. Point at the citation (`file#slug`) so the user can open the real rule themselves for the full text.
5. Stop there. Do not paraphrase, expand, or reconstruct the rule body from memory or from something read earlier in the session. The index's one-line why is the answer this skill gives; the linked rule file is where the full rule lives.

## Escape hatches

- **No `.house/INDEX.md` in the repo.** Say plainly that this repo has not adopted house, or is on a version rendered before the index existed. Do not guess an answer from training knowledge, from a CLAUDE.md skim, or from another repo's rules. Stop there.
- **Nothing in the index matches the question.** Say plainly that house has no rule for this topic. Do not invent one, and do not stretch a loosely related entry to cover a question it does not answer.
- **The index looks stale.** A listed heading no longer appears in its rule file, or a listed rule file is missing entirely. Say the index looks stale, name what is stale, and suggest `/house-rules:sync`. Still report the best match the index has; a stale index is a caveat on the answer, not a reason to withhold it.
- **The user wants the full rule text, not just where it lives.** Only then, read the one rule file the index pointed to. Never open the whole rule set for this. Read the single file after the index match is already found, not before.

## Don't

- Don't load every rule file to answer a lookup. That is the exact cost the index exists to avoid.
- Don't answer from a rule file read earlier in this same session. Re-check the index every time; a sync can change what it says mid-session.
- Don't edit `.house/INDEX.md`, `.claude/rules/house/**`, or any other vendored file from inside this skill. A local edit to a managed file belongs to `/house-rules:sync`'s refusal flow, not to a lookup.
- Don't fabricate a house rule when the index has no match for the question asked.
- Don't turn this into a menu. Answer the question that was asked; only list every candidate module when the question is itself broad enough to span more than one.
