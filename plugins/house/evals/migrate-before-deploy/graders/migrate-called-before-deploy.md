---
type: regex
target: {source: file, path: "repo/scripts/ship.mjs"}
pattern: migrate\.mjs[\s\S]*deploy\.mjs
match: contains
weight: 1
---
`repo/scripts/ship.mjs` invokes `migrate.mjs` textually before `deploy.mjs`, so the migration step
runs (and can fail) before the deploy step is ever reached.
