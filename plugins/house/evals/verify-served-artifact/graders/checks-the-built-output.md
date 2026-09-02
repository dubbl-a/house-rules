---
type: regex
target: trace
pattern: dist/
match: contains
weight: 0.5
---
Evidence the investigation actually looked inside `dist/` (the built output), not only inside
`src/` or the git-tracked diff. `dist/` is gitignored in this fixture, so a search scoped to
tracked files (`git grep`, `git diff`) will never surface it on its own.
