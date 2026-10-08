# house-rules

[![ci](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml)
[![license: MIT and CC BY 4.0](https://img.shields.io/badge/license-MIT%20and%20CC%20BY%204.0-blue.svg)](NOTICE)

## What it is

Claude Code is a program that builds and changes software from what you describe in plain words. It
is good at building. It lacks the working knowledge of an experienced team: a proven backup before
changing stored data, a fix tried on a separate copy first. You must know to ask.

house-rules is that knowledge, researched and written down as rules for twelve areas, listed below.
Each comes from a failure on a real project or a settled practice, and names its source.

The rules also manage your instructions to Claude Code, which are only advice. Nothing checks that a
session followed them, that they are still true after the project changed, or that they stayed short
enough to be followed. house-rules puts the rules in your project as ordinary files that Claude Code
reads every time it works. Each is scoped to the files it concerns, under a length ceiling, and
locked with a fingerprint so a hand edit shows. A checker flags any rule the project outgrew.

## What the rules cover

Twelve sets of rules, called modules, each researched for one area. Five are on unless switched off:

- **claude-code**: the assistant's own setup: what it reads each time and where a new fact belongs.
- **docs**: the written record. No document should point at something that no longer exists.
- **engineering**: how code gets written, checked, and reported day to day.
- **github**: how a change travels: a separate copy, a review before merging, no passwords or keys.
- **testing**: what "done" may claim, and what a passing test proves.

Five turn on when your project needs them (the last two only when enabled in `house.json`):

- **database**: stored data. A backup is taken and proven before any change that could lose data.
- **deployment**: going live on purpose, with a backup restored for real now and then.
- **data-pipelines**: scheduled bulk data jobs, which refuse to delete much without asking.
- **llm-output**: text a model produced. It is kept aside until a person has checked it.
- **evals**: measuring what a rule or a model really does. Each score is shown beside its sample.
- **security**: what a session may trust or install, and what its code must never do.
- **retrieval**: answers drawn from a corpus, each failure traced to the stage where it happened.

Every rule was earned or borrowed, never invented. `docs/handbook/` records the incident or the
published practice behind each one. `docs/handbook/inventory.md` traces every harvested practice to
its rule, and `docs/handbook/upstreams.md` is the ledger of sources. If you disagree with a rule,
argue it on its evidence. Do not work around it.

## Who it helps

**If you are not an engineer**, these rules carry what you would otherwise learn the hard way. They
apply what an experienced team knows, and each says why, so you learn the reasoning too.

**If you are an engineer**, this is a Claude Code plugin. The twelve modules render into
`.claude/rules/house/`. Each rule has an imperative heading, a one-clause why, an `Anchor:` naming
what enforces it, and a receipt. `.house/lock.json` hashes every managed file. A git-hook floor
refuses a commit or push to a protected branch, backed by a PreToolUse hook; both catch mistakes,
and the remote's branch protection stops a determined session (`SECURITY.md`). The rules and
checker reach you as a diff you approve through `/house-rules:sync`; hooks and skills update with
the plugin. Nothing is on npm or GitHub Packages. An adopting repo carries its own checker and rules.

These are one maintainer's opinionated conventions, published so other people can adopt them. They
keep changing, so read each update as a dependency bump. Take the parts you want, and fork for the
last word. A repo never imports house-rules. It adopts a fixed copy made at that moment, not a link.

## How this sits next to other tools

Skill packs teach a session a procedure while it works. This covers the other half: conventions that
live in a repository, with something enforcing them. Rules are vendored into your repo because the
plugin format has no rules component, and a `CLAUDE.md` at a plugin root is not loaded
(`docs/handbook/origins.md`). Sync tools and copy-paste collections stop at delivery.

## Prerequisites

Node 22 or newer, `jq`, bash, and the GitHub CLI (`gh`), used by the cleanup script, deploy guards,
and handoff skill. git must be 2.28 or newer: below that, `--no-verify` skips the whole
branch-policy floor, and `house doctor` says so. No language or framework is assumed. As the header
of `plugins/house/payload/check.mjs` says, the docs gate checks `npm run` tokens only where
`package.json` exists. `bareScriptAllowlist` and `packageRoots` tune the rest.

## Adopting house-rules in a repo

Install the plugin once per machine, pinned to a release tag:

    claude plugin install house-rules --marketplace dubbl-a/house-rules#v0.20.6 --scope user

The plugin resolves from the marketplace's checkout, so the `#v0.20.6` tag is the pin. Without it
you follow the default branch. To move a pin, read
`git diff v0.20.6..vX.Y.Z -- plugins/house/hooks`, remove the marketplace (which uninstalls its
plugins), then run the one command with the new tag. Whether auto-update respects a pin is undocumented,
so leave it off (its third-party default).

In the target repo:

- `/house-rules:bootstrap` probes, proposes a `house.json`, and on approval writes the vendored
  rules, templates, and `.house/`.
- `/house-rules:sync` re-renders after this package or `house.json` changes.
- `house enable <module...>` prints one plan (paths, files, load cost, checklist). `--apply` acts.
- `house disable` is its reverse; `--why` records why a default-on module is off.
- `house confirm` dates a done step.

To wire the checker in by hand, run `node .house/check.mjs` in CI. Add it to `package.json` as
`check:house`, and add `check:docs` with `--only=drift,todo`. `house.json` holds the modules, a
dated ledger of declines, line ceilings that tighten, the guard record, and `targets` (Codex or
Gemini CLI read an `AGENTS.md` block). `plugins/house/schema/house.schema.json` describes each key.

To leave, uninstall each repo's adoption first, since removing the plugin removes the cleanup CLI:

- `house uninstall` prints a plan. With `--apply`, it removes the managed files, the `AGENTS.md`
  block, the `core.hooksPath` it set, and last `house.json` (`--keep-config` leaves it), then lists what is left.
- Then run `claude plugin uninstall house-rules@house-rules` and
  `claude plugin marketplace remove house-rules`.

If you removed the plugin first, delete each file `.house/lock.json` lists, the `AGENTS.md` block,
`.house/`, and `house.json`. Unset `core.hooksPath` where it names `.githooks`.

## What the hooks run

The install prompt names a hook, not what it runs, so read `plugins/house/hooks/hooks.json` (or
`claude plugin details house-rules`) before enabling. It registers four commands, each a script
using only shell or Node builtins and local `git`, with no network call:

- `no-direct-master.sh`, before Bash, edit, write, and MCP tool calls: the branch guard. It denies a
  commit to a protected branch and the ways to disable the git-hook floor.
- `arm-git-hooks.sh`, at session start: sets `core.hooksPath` to the vendored `.githooks` floor.
- `session-start.mjs`, at session start: prints the orchestration defaults.
- `instructions-loaded.mjs`, when instructions load: appends to a local log `house doctor` reads.

These run with your own access, outside any sandbox, and change when the plugin updates. See
`SECURITY.md`, which also has an org allowlist snippet.

## The checker

`node .house/check.mjs` runs twelve families: `drift`, `todo`, `tamper`, `behind`, `shape`,
`lengths`, `coload`, `manifest`, `minutes`, `guard`, `workflows`, and `agent-config`. Scope a run
with `--only=fam,fam`. Exit 0 is clean (warnings printed), 1 is findings, and 2 is an unusable
`house.json` reaching a family that needs one. Each family's config vocabulary heads
`plugins/house/payload/check.mjs`.

## Versioning and breaking changes

Per `docs/decisions/0011-rule-content-changes-are-minor.md`, rule content is minor and a fix is
patch. The named surface is breaking: a rule heading, a config slot, the guard's deny set, the
`house.json` or `.house/` layout, and the Node floor. Below 1.0, the breaking class takes the minor
and everything else takes the patch, so a `^0.x` pin gets the semver it expects
(`docs/decisions/0012-below-one-spend-the-minor-on-the-breaking-class.md`).

## License

Code is MIT (`LICENSE`). Rule prose and documentation are CC BY 4.0 (`LICENSE-DOCS`). Code examples
inside documentation stay MIT. The SPDX expression is `MIT AND CC-BY-4.0`. `NOTICE` maps paths to
licenses and names every upstream that contributed text, structure, or a working method.

## Contributing

Three kinds of contribution fit here. Propose a rule through the rule-proposal issue form; the
incident that earned it matters more than its wording. Report a bug in the checker, a hook, or a
skill through the bug-report form, with the command and its output. Or report a rule that kept
getting ignored or a check that fired wrongly, which is how rules get cut. Questions fit
[Discussions](https://github.com/dubbl-a/house-rules/discussions) better than an issue. Issues
labelled good first issue suit a first pull request. `CONTRIBUTING.md` covers the flow, escape
hatches, licensing (inbound is outbound, no CLA), and `npm run verify`. `SECURITY.md` is how to
report a vulnerability privately. `CODE_OF_CONDUCT.md` applies wherever this project runs.

## Standing on other people's work

This package borrowed ideas, structure, and in places text. Each source shaped something:

- [superpowers](https://github.com/obra/superpowers) (obra), for the in-session discipline this
  package complements and for the starting text behind its worktree and finish-branch guidance.
- [claude-code-orchestration-kit](https://github.com/SirRuggie/claude-code-orchestration-kit)
  (SirRuggie), for the pinned five-agent roster and the six-section brief.
- [antfu's eslint-config](https://github.com/antfu/eslint-config), for the personal-config contract.
- [typescript-eslint's versioning policy](https://typescript-eslint.io/users/versioning/), for the
  strict pole weighed against antfu's loose one, and
  [Prettier's option philosophy](https://prettier.io/docs/option-philosophy), for the em dash
  setting being a small fixed set.
- [cruft](https://cruft.github.io/cruft/), for proving the update, check, and skip-list shape the
  checker follows.
- [MADR](https://github.com/adr/madr), for the decision-record template this package's ADRs carry.
- the [Contributor Covenant](https://www.contributor-covenant.org), for `CODE_OF_CONDUCT.md`.

Four more names sharpened where this package chose to sit, without text taken directly:
[Ruler](https://github.com/intellectronica/ruler),
[AgentSync](https://github.com/yelmuratoff/agent_sync),
[awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules), and
[config-drift-checker](https://github.com/jameskomo/config-drift-checker). The full ledger, dated
and licensed, is `docs/handbook/upstreams.md`. `NOTICE` says exactly what was borrowed and how.
