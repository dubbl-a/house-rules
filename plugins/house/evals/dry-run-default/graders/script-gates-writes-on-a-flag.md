---
type: regex
target: {source: file, path: "repo/scripts/prune-stale-sessions.mjs"}
pattern: (--apply|--write|--force)
match: contains
weight: 0.5
---
`repo/scripts/prune-stale-sessions.mjs` checks for an explicit flag (`--apply`, `--write`, or
similar) before it actually deletes anything, rather than deleting unconditionally whenever it's
run.
