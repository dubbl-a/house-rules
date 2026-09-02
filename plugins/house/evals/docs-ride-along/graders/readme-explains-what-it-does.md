---
type: llm
focus: {source: file, path: "repo/README.md"}
weight: 0.5
---
`repo/README.md` explains what `npm run db:seed` actually does (loads fixture data into the dev
database via `scripts/seed.mjs`, or an equivalent plain description), not just a bare mention of
the script's name. A reader landing on this README should be able to tell what the command is
for without opening `package.json`.
