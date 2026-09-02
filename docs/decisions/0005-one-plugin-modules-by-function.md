---
status: accepted
date: 2026-08-24
---

# Ship one plugin with modules by function, not one plugin per module

## Context and problem statement

house covers eight domains (docs, engineering, github, claude-code, deployment, database, data-pipelines, llm-output) across repos as different as a static civic site, a CRM automation tool, and a resume tailor. One architecture ships every domain as its own small plugin, installed a la carte. The other ships one plugin that internally organizes its content by module. The package needs to pick a shape before Phase 1 writes a single rule file, because the shape decides how many marketplace entries, install commands, and version pins exist for one operator to keep straight.

## Decision drivers

* Most consumers need most modules. Every repo in the fleet has docs and github-workflow and claude-code needs; only some need deployment or data-pipelines, and none need all eight equally.
* A fleet of five to eight tiny plugins multiplies marketplace adds, installs, and version pins for a single operator who is the only maintainer and the only reviewer.
* Commodity functionality, such as committing and code review, is already served by public plugins and does not belong inside house at all; rebuilding it here would be scope the package does not need.
* Generic engineering material is already published and licensed for reuse elsewhere; house's handbook is meant to link out to it and write only the join between the fleet's own invariants and its own gates, which argues against splitting into many module-plugins each trying to carry its own full context.

## Considered options

* **One plugin per module,** installed a la carte per repo. Gives each repo the narrowest possible install, at the cost of a separate marketplace entry, install step, and version pin per domain, for every repo in the fleet.
* **One monolithic plugin, every module always on.** Simplest to install, but forces every repo to carry rule files for domains it will never touch, such as a static site carrying database and data-pipelines rules it has no code to apply them to.
* **One plugin, internally organized into modules, each with its own rule file, handbook chapter, config slots, managed files, and an enabled/disabled/detect switch in `house.json`, with a named trigger for when a module earns its own plugin.** Adopted.

## Decision outcome

Chosen option: one plugin, modules by function. Every module owns its own rule file under `plugins/house/modules/<module>/rules/`, its own chapter under `docs/handbook/`, its own config slots, and its own switch, but all of it ships inside `plugins/house` as one install unit with one version. A module graduates out to its own plugin in the same marketplace only when it needs its own skills or hooks (not just rule files), its own release cadence independent of the core, or a genuinely different audience than "a repo the maintainer owns." None of the eight current modules meets that bar yet.

### Consequences

* Good, because a repo's entire adoption is one marketplace add, one install, and one version pin, regardless of how many modules it turns on.
* Good, because a repo that has no deployment pipeline or no data-pipelines code simply leaves that module off or `detect`-disabled, without paying for a separate plugin install to get there.
* Bad, because the plugin grows as a single unit over time, and a module that does need its own hook (today, the branch guard lives at the plugin level, not per-module) forces a full split rather than a partial one.
* Bad, because a module approaching its graduation trigger has no gradual path: it is either bundled in or fully split out, with nothing in between.

### Confirmation

`docs/handbook/manifest.json`'s `counts.rules: 8` must match exactly one rule file per module under `plugins/house/modules/<module>/rules/`. `claude plugin validate --strict ./plugins/house` validates the whole tree as one plugin. A module's graduation is confirmed only by a new, explicit marketplace entry naming it, never inferred from growth alone.

## More information

The commodity-skill and link-out-for-generic-material decisions this ADR rests on: `docs/handbook/sources/prior-art.md` §4 (superpowers and the official plugins) and §(a) item 5.
