---
type: llm
focus: {source: file, path: "repo/scripts/ship.mjs"}
weight: 1
---
`repo/scripts/ship.mjs` runs the migration step and only then the deploy step, in that real
execution order (not just textual order that a conditional or async call could reverse), prints
which step is running, and stops at the first failure rather than continuing on to deploy after a
failed migration.

Score HIGH when the script's actual control flow (not just source-line order) runs migrate to
completion, checks its result, and only calls deploy if migrate succeeded.

Score LOW when deploy can run before migrate, when deploy runs regardless of whether migrate
succeeded, or when only one of the two steps is called at all.
