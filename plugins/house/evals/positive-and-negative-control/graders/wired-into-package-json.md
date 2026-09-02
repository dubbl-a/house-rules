---
type: regex
target: {source: file, path: "repo/package.json"}
pattern: "\"check:unique-ids\":\\s*\"node scripts/check-unique-ids\\.mjs\""
match: contains
weight: 0.25
---
Sanity check that the base task actually happened: `repo/package.json` carries the new
`check:unique-ids` script running `node scripts/check-unique-ids.mjs`. This should be true in
both arms; it exists so a run that never gets to the positive/negative-control behavior doesn't
score well purely by never attempting the base task.
