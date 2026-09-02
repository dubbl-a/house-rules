---
type: regex
target: {source: file, path: "repo/docs/features.md"}
pattern: (toggleDarkMode|SettingsPanel|src/components/SettingsPanel\.tsx)
match: contains
weight: 1
---
`repo/docs/features.md` names at least one token that actually resolves in the given source
(the `toggleDarkMode` function, the `SettingsPanel` component, or its file path), so a reader can
grep for the claim instead of trusting free-form description.
