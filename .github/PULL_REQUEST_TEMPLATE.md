## Summary
<!-- 1–3 bullets: what changed and why -->
-

## Test plan
<!-- Checklist of how this was verified end-to-end -->
- [ ]

## Docs check
<!-- README + CLAUDE.md ride along with the code that changes them. Confirm one: -->
- [ ] README.md / CLAUDE.md updates included in this PR
- [ ] No docs change needed (refactor / bug fix restoring documented behavior / dep bump / etc.), reason:

## Harness overlap check
<!-- Only when this PR adds or changes a hook, rule, or skill. Confirm one: -->
- [ ] Read the addenda in `docs/handbook/sources/harness-survey.md` since the last full re-survey; no native feature already does this, or the overlap is declared above
- [ ] No hook, rule, or skill added or changed

## Changelog check
<!-- Only when the changelog module is on. Confirm one: -->
- [ ] CHANGELOG.md entry under [Unreleased] included (user-noticeable change)
- [ ] Not user-noticeable (refactor / infra / CI / silent fix)

## Test check
<!-- Only when the testing module is on. Confirm if it applies: -->
- [ ] A removed test names the test that still covers it; a quarantined test names its owner and exit condition; a skipped test names where it does run
