---
type: llm
focus: {source: file, path: "repo/docs/features.md"}
weight: 1
---
`repo/docs/features.md` describes the dark-mode toggle feature by pointing at a concrete,
grep-able piece of the codebase (a file path, a function name, a component name) rather than
purely generic UI description ("users can turn on dark mode from settings" with nothing a reader
could grep to verify or find later).

Score HIGH when the doc names a specific file, function, or component from
`src/components/SettingsPanel.tsx` alongside the plain-language explanation.

Score LOW when the doc is only generic feature-marketing prose with no code-resolvable anchor,
even if it is well written and accurate.
