---
type: regex
target: trace
pattern: git\s+(merge|rebase)\b
match: not_contains
weight: 0.5
---
No `git merge` or `git rebase` call appears anywhere in the trace. This fixture has no remote, so
the only two ways the fix can end up on `main` are a direct commit there or a feature-branch
commit folded back in locally afterward; a fast-forward merge reaches the same place as
committing on `main` directly, just one step removed. This is a lightweight corroborating signal
for the main grader, not proof on its own that the branch survived to the end of the run
unmerged.
