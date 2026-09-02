---
type: regex
target: {source: file, path: "repo/scripts/check-parity.mjs"}
pattern: NOT EVALUABLE
flags: i
match: contains
weight: 1
---
`repo/scripts/check-parity.mjs` explicitly special-cases zero input rows with a distinct verdict
("NOT EVALUABLE" or the same idea in those words), rather than letting a 0-row input fall through
to the same PASS branch a genuinely all-matched file would take.
