# Prune duplicate and redundant tests (Part of #363)

This file becomes the PR body and is deleted before merge. Line numbers are at af87f32 (the base).

## Counts and durations

Measured on the same machine. The first baseline run was taken while another agent's verify held the load average near 120, so its duration is not comparable; the second is the same base tree (git archive of af87f32) run at a load average near 15, matching the after run.

| Suite | Before | After | Duration before | Duration after |
|---|---|---|---|---|
| npm test (node --test) | 1187 tests | 1154 tests, 0 fail | 184.4 s (load ~120, 1 timing-bound fail that passes alone, 5/5); 103.0 s at load ~15 | 102.7 s at load ~15 |
| bash tests/hooks/run.sh | 628 / 628 | 612 / 612 | 55.4 s (loaded); 52.3 s (quiet) | 50.0 s |
| npm run test:githooks | 65 total, 64 passed, 1 skipped, plus 3 pre-commit template cases | unchanged (no row touches it) | 19.8 s | 18.6 s |

Net: 35 node tests deleted, 2 added back as loop entries (K15), so -33. Hook suite: -6 (H1-H6) and -10 (H9) = -16.

## Rows

Covering test is the test that still asserts the behavior. "Ran" means the covering test passed after the change (node --test with --test-name-pattern, or the whole file); "planted" means the defect named in the brief was introduced and the covering test went red, then was reverted.

| id | change | covering test | verified |
|---|---|---|---|
| C1 | removed cli-house:4326 "#167 disable --apply still works through its own hand-off" | cli-house:2721 | ran |
| C2 | merged cli-house:3310 into cli-house:2224: FALSE_GUARD_CLAIMS doesNotMatch loop, with a message | cli-house:2224 | ran |
| C3 | removed cli-house:4334; moved its plan.code exit assertion into cli-house:3288 | cli-house:3288 | ran |
| C8 | removed cli-house:279 | cli-house:243 | ran |
| C13 | merged cli-house:665 into :570 and :563: the --json runs and all four ahead/behind assertions, with messages | cli-house:570, :563 | ran |
| E1 | merged cli-house:2969 into cli-house:2812: the emptied-directory assertions (pre-push.d, reference-transaction.d) and the scaffold-directory message | cli-house:2812 | ran |
| E4 | removed cli-house:3049 | cli-house:2933 | ran |
| K1 | removed drift:345 positive control; rewrote the stale disk-fallback comments at 340-373 to point at the pair | drift:374 (positive), drift:355 (negative, stays) | ran |
| K2 | removed manifest:118; comment on P8 positive control says it pairs with the default-OFF case | manifest:102 | ran |
| K3 | removed guard:89 | guard:245 | ran |
| K4 | removed tamper-resolve:57 | tamper-resolve:170 | ran |
| K5 | merged workflows:122 into the PROMOTED loop: kinds() exclusivity assertion for every promoted check | workflows:704-709 loop | ran (holds for all four checks) |
| K6 | removed cli:65 | cli:73 | ran |
| K7 | merged floor-status:100 into floor-status:40: basis === 'lock' | floor-status:40 | ran |
| K8 | merged drift:623 (the #14 .astro case) into the drift:721 extension loop: added '.astro', history comments carried over | drift:721 loop | ran |
| K9 | removed drift:596 | drift:995 (the ADR 0009 plain stale entry case) | planted: payload/check.mjs:1163 allScriptSets gated on packageRoots.length turned drift:995 red ("ADR 0009: an allowlist entry with a why ..."); reverted |
| K10 | merged manifest:619 into manifest:754: its fuller regex | manifest:754 | ran |
| K11 | merged manifest:628 into manifest:817: its exact regex | manifest:817 | ran |
| K12 | merged manifest:681 into manifest:761: ".*house render --apply" | manifest:761 | ran |
| K13 | removed manifest:637 | manifest:761 | ran |
| K15 | merged workflows:637 into the workflows:114 template loop: the two nested lock sets | workflows:114 loop | ran |
| K16 | removed lengths:246 | lengths:305 | ran |
| K17 | removed lengths:49 | lengths:295 | ran |
| K18 | removed shape:73 | shape:98 | ran |
| K19 | removed shape:109 | shape:158 (mode off, code 0 with a dashed rule file) | planted: payload/check.mjs:1680 anchor regex changed to reject an em dash turned shape:158 red ("mode `off` emits no em dash finding anywhere"); reverted |
| K20 | removed shape:405 | shape:98 | ran |
| M1 | removed module-files:2052 | module-files:2062, :2012, :1998 | ran |
| M3 | merged module-files:498 into module-files:615: /self-test OK/ | module-files:615 | ran |
| M4 | merged module-files:324 into module-files:334: /must run from main at origin\/main/ | module-files:334 | ran |
| M7 | removed cost-report:341 | cost-report:571 | ran |
| M8 | merged cost-report:445 into cost-report:454: the three near() lines | cost-report:454 | ran |
| M9 | merged cost-report:388 into cost-report:248: the .tmp readdir check | cost-report:248 | ran |
| M11 | FIX: the test at hooks-instructions-loaded:126 now spawns the hook with CLAUDE_CODE_PROJECT_DIR_NAME set, CLAUDE_CONFIG_DIR unset and HOME sandboxed, and asserts the cwd key is used and the name is ignored | itself | ran |
| M12 | merged hooks-instructions-loaded:275 into the :140 bad-payload list | hooks-instructions-loaded:140 | ran |
| M14 | removed harness-release:41 | harness-release:51 | ran |
| M15 | merged orchestration:144 into upstreams:70: the https remote assertion; sha format and non-empty paths are already enforced through the pins validator test and the equality assertions | upstreams:70 | ran |
| H1-H6 | tests/hooks/run.sh _disable_states takes a third argument; the six command cases (push, commit, merge, unset hooksPath, rm .githooks, no-verify) run only in the second call (case151set); the Edit case runs in both; comment says the second call covers house disable's config:{} shape | second _disable_states call | planted: hook jq test at no-direct-master.sh:1868 changed to `.modules.github == {"enabled":false}`; HOUSE_TEST_PART=1 went red on the three expect_allow cases of the second call (push, commit, merge); reverted |
| H9 | expect_deny takes several wanted substrings and names the first missing; pure-deny sets merged into their first case: 480/482/484, 1151/1153, 1786/1788, 1875/1877/1879, 1893/1897, 1899/1903, 1966/1968; expect_deny_without cases (1681, 1683, 1790, 1881) untouched | first case of each set | ran (612 / 612) |
| FIX | cli-house:3285 comment now says all six claims were printed before #159 | n/a | comment only |

## Not touched

KEEP rows and SHARE rows are unchanged. No production code, workflow, sharding or hook part layout changed.
