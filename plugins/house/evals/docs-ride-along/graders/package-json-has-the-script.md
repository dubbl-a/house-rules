---
type: regex
target: {source: file, path: "repo/package.json"}
pattern: "\"db:seed\":\\s*\"node scripts/seed\\.mjs\""
match: contains
weight: 0.25
---
Sanity check that the base task actually happened: `repo/package.json` carries the new
`db:seed` script running `node scripts/seed.mjs`. This should be true in both arms; it exists so
a run that fails the actual task doesn't score well purely on an unrelated doc edit.
