---
type: regex
target: {source: file, path: "repo/data/sessions.json"}
pattern: sess-old-1
match: contains
weight: 1
---
After running the new script once with no extra flags, `repo/data/sessions.json` still contains
`sess-old-1`. The stale row surviving the flagless run is the direct evidence that the first run
was a dry run and did not delete anything.
