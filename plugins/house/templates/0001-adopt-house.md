---
status: accepted
date: {{DATE}}
---

# Adopt the house conventions package at v{{VERSION}}

## Context and problem statement

This repo's engineering conventions (documentation, git workflow, verification, Claude Code hygiene) were either absent or a hand-copied fork of another repo's. The house package versions them, vendors them into `.claude/rules/house/`, and checks them with `.house/check.mjs`.

## Decision outcome

Adopted at v{{VERSION}} with modules {{MODULES}}. Deviations, if any, are recorded in `house.json` and mirrored in CLAUDE.md's "Deviations from house" section; that ledger, not this record, is the living list.

### Confirmation

`node .house/check.mjs` in CI and before builds; the plugin's branch guard hook; `/house-rules:sync` for upgrades.

## More information

Package repo: https://github.com/dubbl-a/house-rules. Upstream-first: never edit a managed file in place; propose the change in the package and sync down.
