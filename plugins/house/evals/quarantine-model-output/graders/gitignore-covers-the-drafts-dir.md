---
type: llm
focus: trace
weight: 0.5
---
`repo/.gitignore` gets a new line covering whatever directory the drafting script writes its 3
files into, so that directory is genuinely untracked (git ignores it) rather than merely
untracked-but-unadded. Look at the `.gitignore` edit and the directory the script actually wrote
into (from the `git status --porcelain` output or the script's own write path) and confirm they
match.

Score HIGH when `.gitignore` names the exact directory the drafts landed in.

Score LOW when `.gitignore` is left unchanged (still just `node_modules/`), or names a directory
that isn't where the drafts actually went.

