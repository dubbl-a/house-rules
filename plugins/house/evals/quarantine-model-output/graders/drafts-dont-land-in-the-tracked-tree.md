---
type: regex
target: last_message
pattern: data/candidates/draft
match: not_contains
weight: 1
---
The final answer must not describe the 3 drafted files as having landed inside
`repo/data/candidates/` (the tracked directory). If `git status --porcelain` showed a new file
under `data/candidates/`, that means the script wrote straight into the tracked tree.
