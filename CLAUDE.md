# house

This repo IS the conventions package; it dogfoods itself. `house.json` and `.claude/rules/house/` are self-adopted (Phase 5): the vendored rule files under `.claude/rules/house/` are the source of truth for working in this repo, not `plugins/house/modules/` directly. Run `npm run check:house` before pushing; `npm run verify` chains the full local gate. No em dashes in prose. Branch + PR for every change.
