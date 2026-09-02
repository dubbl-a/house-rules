# LLM output

## Why this exists

A model's draft, suggestion, or citation can read as finished before anyone has checked it, and the failure never announces itself at the point where it happened. It surfaces later: a blind panel that comes back unanimous for the wrong reason, a WebFetch summary that inverts a page's own disclaimer, a published finance number that has to be walked back, a page-fit checker that cries wolf five times running. Every rule below is a structural gate placed outside the model's own confidence, so a guess never gets to vouch for itself.

The incidents recorded here come from four repos (repo-a, repo-b, repo-d, repo-e) plus the external practice that backs the deterministic-backbone rule. None of the failures were fixed by asking the model to try harder; each was caught by a human moving a file, a mechanical check, or a second, differently-evidenced pass.

## Quarantine model output until a human moves it

`repo-d`'s intel-enrichment skill states the pattern plainest: "the git commit IS the sign-off." Generation writes only into a gitignored `out/intel-drafts/` directory, and a file reaches the tracked tree exclusively by a human moving it. Nothing unreviewed can reach git, the console, or the database, structurally, not by policy (`.claude/skills/intel-enrichment/SKILL.md`, accuracy quarantine).

That quarantine is one gate inside a larger shape, and the shape is worth recording as a sequence because this chapter otherwise cites the same skill five separate times for five separate halves of it (SB-049). The wave, in order: scope the batch, assemble evidence bundles, draft against them, run the adversarial fact-check, run mechanical validation, hold at the human review gate, commit, sync, ship. Each later stage is allowed to fail the batch back to a person, and none of them is allowed to promote it: the model does every step except the one that says yes.

`repo-a`'s six pipeline queue-walker commands (`bootstrap-candidate.md` and its siblings) carry the same rule as a stated line: the model never approves its own work, status stays `pending`, and the maintainer approves directly against the row after the model finishes.

`repo-b`'s `network-etl.md` states it as "the machine may not vouch for its own guess": a first dry run is allowed to admit nobody, and the pipeline's two hand-edited human review files are never overwritten by a later run.

The concrete case is `repo-a`'s manual-update rule (2026-07-18, `feedback_manual_updates_claude_executes.md`). Two voter registrants shared the same full name in the file. Rather than pick one, Claude surfaced both full records and let the maintainer choose; only after the maintainer picked the correct registrant did Claude write the update, and the job was not done at that one row. The choice had to be fanned through every downstream stage: `propagate-voter-registrant-id` (push to child rows, denormalize `voter_status`), `collapse-people-by-registrant` if a twin existed, `publish:neon` (re-key via `entity_redirects`), repo-f's console build and sync, and finally the public-site build and deploy. A scoped hand-write is legitimate only when it mirrors the pipeline's own output fields exactly, so a later full run of the matcher is a no-op rather than a second, conflicting write.

## Keep a deterministic backbone and let the model fill the slots

`repo-b`'s `okr-coach` skill is the reference shape: the OKR cycle's process lives as data in `flow.json`, its tuning constants live in `doctrine.json`, its arithmetic lives in `okr-core.mjs`, and only the doctrine prose lives in `SKILL.md` and its `references/`. The skill's own framing: "the judgment stays with you; only the bookkeeping is code." A second row from the same repo restates the same split from the calling side, keep judgment with the human and bookkeeping in code, so nothing has to be re-derived from memory between runs.

`repo-e`'s `scripts/score_resume.py` draws the same line inside one script: requirement extraction is judgment and happens in session, while scoring itself is deterministic, and the rubric labels which dimensions are which, some are marked "semantic, judged in session and labeled as such."

`repo-a`'s six queue-walker commands keep review context inline rather than resolvable: a `context jsonb` column is written at insert time, "so a review skill never has to resolve a path," backed by a soft retro invariant, `pending_rows_have_context`, that catches a row missing it.

The external anchor is Anthropic's own guidance: prefer a predictable, fixed code path over an autonomous agent whenever the steps are knowable in advance, and reserve agent autonomy for problems genuinely too open-ended to route deterministically ("Building Effective Agents," see Sources).

## Report no finding rather than manufacture one

`repo-b`'s standing session-retrospective skill step holds a high bar on purpose: "no lesson today" is the correct output most sessions. When something does clear the bar, it becomes a specific edit naming the file and the exact replacement text, shipped on a branch as a pull request, never silently accumulated into a running note.

`repo-e`'s gap-report convention answers the same pressure from the content side: an unmet job-description requirement is written into a gap report with a routing suggestion, not papered over with the nearest plausible bullet from the bank.

The concrete failure this guards against is documented in `feedback_calibrated_analysis_briefs.md`: the May 2026 regional-money finance brief needed an explicit limitations section naming what was not checked, because absence of evidence in disclosure data is evidence of nothing happening in disclosure data, not evidence that nothing happened at all. A closing caveat cannot fix a body that already overclaimed.

Native floor, as of 2026-09-02: hosted Code Review runs a verification step that checks candidates against actual code behavior, so a run that reports nothing is a normal outcome there, and only where that Team and Enterprise preview runs (https://code.claude.com/docs/en/code-review.md#how-reviews-work).

## Refute with named lenses, drop by default, and log the drops

`repo-d`'s intel-enrichment skill runs two independent refuter passes with named lenses: lens 1 checks sources (every quote string-matches its source, every URL supports the claim it is cited for), lens 2 checks identity and attribution. Anything a lens refutes is dropped by default, and every drop is logged to a `research_gaps` field so the loss stays visible rather than silent.

The case that motivates checking a familiar failure mode before trusting it comes from the council-meeting corpus (`feedback_known_failure_mode_bias.md`). ASR transcription was already known to mangle proper nouns, so a transcript reading a weekday-qualified date in one place and an unqualified date in another read as an ASR error on sight. It was not: one date was the statutory deadline, which fell on a weekend, and the other was the last regularly scheduled meeting before it, which fell on a weekday, two distinct real facts, both transcribed correctly. A peer session holding the deadline from an independent source caught the false flag. The cheap check, a weekday lookup, would have settled it before any edit was made.

Native floor, as of 2026-09-02: hosted Code Review fans out one agent per issue class and verifies candidates before ranking them, but never reports which agent caught what and logs no drops, and only where that Team and Enterprise preview runs (https://code.claude.com/docs/en/code-review.md#how-reviews-work).

## Cite or stay silent

This is the most heavily populated rule in the module, and the incidents span every surveyed repo.

`repo-a`'s `entity-resolution.md` (line 87) states the corroboration requirement directly: being the only candidate is not evidence, and a single match is never treated as settled without corroboration. Its `content.md` (lines 43-44) states the companion rule for sources: repoint a dead source, never delete it, since deleting one "silently converts one candidate's dead webhost into an apparent coverage gap." The replacement has to be verified to actually carry the cited claim, not merely return a 200; both halves are enforced by `link-check.yml` and the `source_ref_integrity` build gate.

`repo-b`'s `gtm-brain` skill puts it as plainly as the rule file does: "an answer without a quote is a bug, not an answer," and "not in corpus" is a required, acceptable output rather than a failure to paper over. Every quote is mechanically verified through the Citations API rather than trusted from generation.

`repo-d`'s intel-enrichment evidence gate refuses any claim without a non-empty `evidence[]` list, and layers an identity gate on top: a subject's `social_match` of `low` or `none` blocks all socially-sourced content outright, `medium` caps the confidence and adds a caution flag, and confidence always rounds down, never up.

`repo-e`'s non-negotiables state the bank-only rule with no carve-out: "if a claim is not in the bank and not explicitly confirmed by the user in this session, it does not appear in any output. No exceptions for plausible-sounding filler." Its near-miss rule is a sibling: a near match between a job requirement and the bullet bank becomes a question, never an insertion, and a 2026-08-10 amendment (ledger ruling 72) tightened it further, check a near-miss instead of carrying it forward whenever it is mechanically checkable.

The clearest verification incident is dated 2026-08-02 (`feedback_verify_endorsements_raw_markup.md`): a WebFetch summary of a candidate's site said a regional elected-officials list was "NOT presented as endorsements," while the page itself nested that same block inside its own broader endorsements section. The summary had misread the page's own disclaimer, "Unless specified, titles are listed for identification purposes only," as covering the people rather than their titles. Two checks, both worth reusing, settled it: the heading tree (the list sat as an `h2` directly under the endorsements `h1`, a sibling of another confirmed section) and a neighbour test (three of the four other names on that list were already published as this candidate's endorsers). Diffing the whole endorsement block against what was already published, rather than trusting the extractor's hits, turned 2 flagged findings into 19 genuine gaps on that one page.

`feedback_calibrated_analysis_briefs.md` also supplies the outcome-verification failure: the same finance brief's early draft credited a regional PAC network with a winning slate while missing that one candidate the same network had backed had lost. A claimed track record was not checked against the actual result.

`feedback_published_number_verification.md` sets the bar for a different class of claim, a published number: before changing a candidate's finance figure, reach roughly 99% confidence and corroborate independently against the primary-source filing on the state's disclosure portal, not just an internal reconciliation.

`reference_deterministic_first_citations.md` (2026-08-04) is a citation about citing: the Fellegi and Sunter (1969) reference behind the matcher's certain/likely/queue decision bands was confirmed by search that day, not recalled from memory. The same pass found the opposite result for two named GTM-engineering practitioners, a search did not confirm either one states "deterministic-first" as an articulated principle, so the brief cites the verifiable waterfall-enrichment pattern instead and uses their names only as landscape, without attributing the principle to either of them.

## Gate output on status tags

`repo-d`'s `lib/intel-validate.mjs` requires a mechanical validation, including a sensitive-data pattern scan, to exit clean before anything syncs.

`repo-e`'s status tags gate the content bank directly: `[verified]` is free to use, `[unverified]` needs one explicit confirmation (which then edits the bank with a dated note), `[flagged]` is blocked from any output until resolved, and `[core]`/`[variant]` separates a baseline claim from a historical variant.

`feedback_calibrated_analysis_briefs.md` extends the same tagging discipline to prose: label every claim verified, inferred, or unknown throughout the body, not only in a closing caveat, and segregate opinion under its own clearly marked heading.

`feedback_no_nocodb_review.md` sets the auto-approval boundary and records the incident that tested it. The rule: auto-approve only `confidence='high'` rows whose suggested action falls in a named safe set (`set_party_code`, `tag_out_of_state`, `tag_organization`, `no_action`), and leave medium- or low-confidence and ambiguous rows pending rather than pausing for a click. On 2026-08-02, a pile of 39 pending high-confidence `donor_voter_match` rows looked like a growing backlog; it wasn't. Each one turned out to have 5 to 6 already-approved-and-applied duplicates for the same donor, residue of an idempotency-guard bug, and every affected donor already carried the correct party. Those were closed `approved`, never `rejected`, because a `rejected` row re-queues on every refresh while an `approved` one does not. The same note records why borderline rejections need to surface inline rather than get buried: on 2026-05-26, three auto-rejected pairs, each a nickname or spelling variant of the same donor, were all overridden by the maintainer using local context the data alone did not carry, which only worked because the rejections were shown, not silently applied.

## Reword a locked claim, never strengthen it

`repo-b`'s `drafting-in-notion` skill runs a multi-round revision loop on this principle: drafts are frozen and numbered, a person's authored spans are immutable unless the model shows an itemized before-and-after, a fresh-eyes gate checks the exact publish text, and a decision ledger is checked before every publish so a settled question cannot be silently reopened.

`repo-e`'s locked-claims rule states the boundary in one line: rewording to mirror a job description's vocabulary is allowed, but the claim, the metric, the scope, and the verb's strength are locked. "Repositioned" never becomes "built." Numbers never round up.

## Treat silence as not approval

`repo-e`'s approval gate is the one row behind this heading, and it carries no separate incident in the sources beyond the rule itself: "No file is generated before the user explicitly approves the diff. Silence is not approval." No incident recorded; the rule came in on reasoning alone. The reasoning, stated in the rule file this chapter backs, is that an approval a script could grant is not an approval; the person is the only gate that counts, and a question left unanswered is exactly as unresolved as one never asked.

Native floor, as of 2026-09-02: the permission system, where file modification requires approval and an agent message never counts as consent (https://code.claude.com/docs/en/permissions.md), and plan mode, which holds edits until a person approves the plan but does not bind where bypass permissions are available and never applies to a printed run (https://code.claude.com/docs/en/permission-modes#analyze-before-you-edit-with-plan-mode).

## Read agreement with a shown suggestion as anchored, not accurate

`repo-a`'s retro report (`scripts/lib/retro.mjs`) carries its own reading instructions in its preamble: "read the two columns asymmetrically. 'would kill approvals' is decisive; 'matches rejections' is informative only and partly circular, because the reviewer was often looking at that very evidence." The incident that produced that line is dated 2026-07-22 (`feedback_pipeline_retro_and_loop_in.md`): the first retro run confidently called all five candidate signals adoptable, because applied merges delete the dropped person, so the labeled corpus had lost nearly every real approval and each signal scored zero false positives against almost nothing. Reconstructing the corpus, from 57 rows to 162, cut the recommendation count from 5 to 1; three of the original five would have destroyed real merges. The decisive metric became whether a proposal would have killed something a human actually approved, not its hit rate on rejections, since the reviewer had been looking at that very evidence when making the original call.

`match-measurement.md` (line 26, enforced in `evidence-packets.mjs`) states the companion rule for blind panels: "an instruction is not a control." Blinding is enforced in the file written to disk, not in the panelist's instructions.

The case that shows why is dated 2026-08-16 (`feedback_blind_panel_derived_field_leak.md`). Person-subject review packets printed `public.people.name_aliases`. A first blind panel over 7 subjects came back 7/7 unanimous and confident, and all three panelists named the same deciding field: the alias. Those aliases had been manufactured by the link under test, `collapse-people-by-registrant.mjs` folds a dropped person's `canonical_name` into the keeper's aliases, and all 5 subjects checked carried an `entity_redirects` row reading `collapse: shared voter_registrant_id`. The panel had been confirming a link using a field the link itself had created, and the result was discarded. Re-run with aliases suppressed, the panel reached the same 7 answers, but now on genuinely independent evidence: ZIP, city, precinct, countywide uniqueness, and a donor `employer` field drawn from filing data. A parallel check on donor packets came back clean by contrast: of 270 donor aliases that matched the voter-file rendering of their linked registrant, 267 appeared verbatim in a raw filing field on the state's disclosure portal, confirming those aliases were filing-derived rather than manufactured by the matcher under test.

## Sources

- Fellegi, I. P., & Sunter, A. B. (1969). "A Theory for Record Linkage." Journal of the American Statistical Association, 64(328). Cited in `reference_deterministic_first_citations.md` as the worked example of verifying a citation by search on the day it was used, rather than by recall. https://www.tandfonline.com/doi/abs/10.1080/01621459.1969.10501049
- Anthropic. "Building Effective Agents." Cited as the source for preferring a predictable, fixed code path over an autonomous agent whenever the steps are knowable in advance. https://www.anthropic.com/engineering/building-effective-agents
