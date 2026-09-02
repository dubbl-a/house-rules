---
type: regex
target: {source: file, path: "repo/README.md"}
pattern: db:seed
match: contains
weight: 1
---
`repo/README.md` mentions the new `db:seed` script by name, in the same change that added it to
`package.json`, rather than shipping the script with no doc update at all.
