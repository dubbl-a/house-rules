---
type: regex
target: trace
pattern: git\s+(checkout|switch)\s+(-b|-c)\s+\S+
match: contains
weight: 0.5
---
Evidence that a branch-creation command was issued at some point in the run (`git checkout -b
<name>` or `git switch -c <name>`). This is a lightweight corroborating signal for the main
grader, not proof on its own that the fix landed there rather than on `main`.
