# house-rules

[![ci](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml)
[![license: MIT and CC BY 4.0](https://img.shields.io/badge/license-MIT%20and%20CC%20BY%204.0-blue.svg)](NOTICE)

## What it is

Claude Code is a program that builds and changes software from what you describe in plain words. It
is good at building. What it does not bring on its own is the working knowledge an experienced team
carries, such as taking a proven backup before a change to stored data, or trying a fix on a
separate copy before touching the shared one. You would have to know to ask. house-rules is that
expertise, researched and written down as rules across twelve areas: working with Claude Code
itself, documentation, engineering, GitHub, security, testing, measurement, databases, deployment,
data pipelines, text a model produced, and answering from a corpus. Each rule comes from a failure
on a real project or a settled practice of the field, its source named, so you need not research it.

The rules are also how your instructions to Claude Code are managed, and that matters because
whatever you write for it is advice: nothing checks that a session followed it, that it is still
true after the project changed, or that it stayed short enough to be followed at all. house-rules
puts the rules in your project as ordinary files that Claude Code reads every time it works, keeps
each one scoped to the files it concerns and under a length ceiling, locks each with a fingerprint
so a hand edit shows, and runs a checker that reads the project back and tells you when a rule and
the project have stopped matching.

## What the rules cover

Twelve sets of rules, called modules, each researched for one area. Five are on unless switched off:

- **claude-code**: the assistant's own setup: what it reads each time, how long that may be, and where a new fact belongs.
- **docs**: the written record, so no document points at something that no longer exists.
- **engineering**: how code gets written, checked, and reported day to day.
- **github**: how a change travels: a separate copy to work on, a review before it joins the main
  copy, and no passwords or keys in the project.
- **testing**: what "done" may claim, and what a passing test proves.

Five turn on when your project looks like it needs them; the last two only when enabled in `house.json`:

- **database**: stored data, with a backup taken and proven before any change that could lose it.
- **deployment**: putting something live, deliberately, with a backup restored for real from time
  to time rather than assumed to work.
- **data-pipelines**: scheduled jobs that move data in bulk, which refuse to delete more than a
  little without asking.
- **llm-output**: text a model produced, kept aside until a person has checked it, so nothing a
  model wrote is read as fact by accident.
- **evals**: measuring what a rule or a model really does, with each score shown beside its sample.
- **security**: what a session may trust or install, and what the code it writes must never do.
- **retrieval**: answers drawn from a corpus, each failure traced to the stage where it happened.

Every rule was earned or borrowed, never invented: `docs/handbook/` records the incident or the
published practice behind each one, `docs/handbook/inventory.md` traces every harvested practice to
the rule that carries it, and `docs/handbook/upstreams.md` is the ledger of sources. A rule you
disagree with is argued on its evidence, not worked around.

## Who it helps

**If you are not an engineer**, these rules carry what you would otherwise have to learn the hard
way or go and research: the practice an experienced team would already know, applied without you
knowing its name, and each rule says why in the same breath, so you learn the reasoning as you go.
Start with the plain-language guide, which explains every technical word where it first appears:
https://house-rules-guide.vercel.app

**If you are an engineer**, this is a Claude Code plugin. The twelve modules render into
`.claude/rules/house/`, each rule an imperative heading, a one-clause why, an `Anchor:` naming what
enforces it, and a receipt; `.house/lock.json` hashes every managed file; `node .house/check.mjs` runs
in CI; a git-hook floor refuses a commit or push to a protected branch, backed by a PreToolUse hook;
the vendored rules and the checker arrive as a diff you approve through `/house-rules:sync`, while
the plugin's hooks and skills change when the plugin updates, with no sync. It installs from this repository with the `claude` CLI.
Nothing is on npm or GitHub Packages; an adopting repo carries its own copy of the checker and rules.

These are one maintainer's opinionated conventions, published so other people can adopt them. They
keep changing, so read each update as a dependency bump, take the parts you want, and fork for the
last word. A repo never imports house-rules; it adopts a fixed copy made at that moment, not a link.

## How this sits next to other tools

Skill packs teach a session a procedure while it works; this covers the half that persists, the
conventions that live in a repository with something enforcing them. Rules are vendored into your
repo because the plugin format has no rules component and a `CLAUDE.md` at a plugin root is not
loaded (`docs/handbook/origins.md`). Sync tools and copy-paste collections finish at delivery.

## Prerequisites

Node 22 or newer, git 2.28 or newer (below that `--no-verify` skips the whole branch-policy floor, and
`house doctor` says so), `jq`, bash, and the GitHub CLI (`gh`), which the cleanup script, deploy guards, and handoff skill use.
No language or framework is assumed. The docs gate resolves `npm run` tokens against `package.json`
scripts only where that file exists, as the header of `plugins/house/payload/check.mjs` says, so
without one they are skipped, not failed; `bareScriptAllowlist` and `packageRoots` tune the rest.

## Adopting house-rules in a repo

Install the plugin once per machine, pinned to a release tag:

    claude plugin marketplace add dubbl-a/house-rules#v0.17.0
    claude plugin install house-rules@house-rules --scope user

The plugin resolves from the marketplace's checkout, so the `#v0.17.0` tag is the pin; without it
you follow the default branch. To move a pin, read `git diff v0.17.0..vX.Y.Z -- plugins/house/hooks`,
remove the marketplace (which uninstalls its plugins), then add and install with the new tag. Whether
auto-update respects a pin is undocumented, so leave it off here (its third-party default).

In the target repo, `/house-rules:bootstrap` probes, proposes a `house.json`, and on approval writes
the vendored rules, templates, and `.house/`; `/house-rules:sync` re-renders after this package or
`house.json` changes. `house enable <module...>` prints one plan (paths, files, load cost, checklist)
and acts only with `--apply`; `house disable` is its reverse, `--why` recording why a default-on
module is off; `house confirm` dates a done step. By hand, run `node .house/check.mjs` in CI and in
`package.json` as `check:house` (and `check:docs`, with `--only=drift,todo`). `house.json` holds the
modules, a dated ledger of declines, line ceilings that tighten, the guard record, and `targets`
(Codex or Gemini CLI read an `AGENTS.md` block); `plugins/house/schema/house.schema.json` has each key.

To leave, uninstall the adoption in each repo first, since removing the plugin removes the CLI that
cleans up: `house uninstall` plans, and with `--apply` removes the managed files, the `AGENTS.md`
block, the `core.hooksPath` it set, and last `house.json` (`--keep-config` leaves it), then lists the
rest. Then `claude plugin uninstall house-rules@house-rules` and `claude plugin marketplace remove house-rules`;
`claude plugin details house-rules` shows a plugin's hooks. Plugin removed first? Delete each file
`.house/lock.json` lists, the `AGENTS.md` block, `.house/`, and `house.json`; unset `core.hooksPath` where it names `.githooks`.

## What the hooks run

The plugin's install prompt shows that a hook exists but not what it runs, so read
`plugins/house/hooks/hooks.json` before enabling. It registers four commands, each a script inside
the plugin that uses only shell or Node builtins and local `git`, with no network call:

- `no-direct-master.sh`, before Bash, edit, write, and MCP tool calls: the branch guard, which denies
  a commit to a protected branch and the ways to disable the git-hook floor.
- `arm-git-hooks.sh`, at session start: sets `core.hooksPath` to the repo's vendored `.githooks` floor.
- `session-start.mjs`, at session start: prints the orchestration defaults.
- `instructions-loaded.mjs`, when instructions load: appends to a local log that `house doctor` reads.

These run with your own access, outside any sandbox, and change when the plugin updates (see
`SECURITY.md`, which also has an org allowlist snippet).

## The checker

`node .house/check.mjs` runs ten families (`drift`, `todo`, `tamper`, `behind`, `shape`, `lengths`,
`coload`, `manifest`, `minutes`, `guard`), scoped with `--only=fam,fam`. Exit 0 is clean with
warnings printed, 1 is findings, 2 is an unusable `house.json` reaching a family that needs one.
Each family's config vocabulary heads `plugins/house/payload/check.mjs`.

## Versioning and breaking changes

Three classes, per `docs/decisions/0011-rule-content-changes-are-minor.md`: rule content is minor,
the named surface (a rule heading, a config slot, the guard's deny set, the `house.json` or
`.house/` layout, the Node floor) is breaking, and a fix is patch. Below 1.0 the breaking class
takes the minor and everything else the patch, so a `^0.x` pin gets the semver it expects
(`docs/decisions/0012-below-one-spend-the-minor-on-the-breaking-class.md`). No rule byte reaches
your checkout until you run `/house-rules:sync` and approve the plan it prints.

## License

Code is MIT (`LICENSE`), rule prose and documentation are CC BY 4.0 (`LICENSE-DOCS`), and code
examples inside documentation are MIT wherever the surrounding prose sits. The SPDX expression for
the repository is `MIT AND CC-BY-4.0`; `NOTICE` lists which paths fall under which and names every
upstream that contributed text, structure, or a working method.

## Contributing

Three kinds of contribution fit here: a rule, through the rule-proposal issue form, where the
incident or receipt that earned it matters more than its wording; a bug in the checker, a hook, or
a skill, through the bug-report form, with the command and its output; and an adopter's report that
a rule kept getting ignored or a check fired wrongly, which is how rules get cut. Questions fit
[Discussions](https://github.com/dubbl-a/house-rules/discussions) better than an issue; issues
labelled good first issue are scoped for a first pull request. `CONTRIBUTING.md` covers the flow,
the escape hatches, licensing (inbound is outbound, no CLA), and `npm run verify`; `SECURITY.md`
is how to report a vulnerability privately; `CODE_OF_CONDUCT.md` applies wherever this project runs.

## Standing on other people's work

This package borrowed ideas, structure, and in places actual text before it wrote a line of its own
rules. Each is named plainly rather than folded into one credits line, because each shaped something:

- [superpowers](https://github.com/obra/superpowers) (obra), for the in-session discipline this
  package complements and for the starting text behind its worktree and finish-branch guidance.
- [claude-code-orchestration-kit](https://github.com/SirRuggie/claude-code-orchestration-kit) (SirRuggie), for the pinned five-agent roster and the six-section brief.
- [antfu's eslint-config](https://github.com/antfu/eslint-config), for the personal-config contract
  this README opens with.
- [typescript-eslint's versioning policy](https://typescript-eslint.io/users/versioning/), for the
  strict pole weighed against antfu's loose one, and [Prettier's option
  philosophy](https://prettier.io/docs/option-philosophy), for the em dash setting being a small fixed set.
- [cruft](https://cruft.github.io/cruft/), for proving the update, check, and skip-list shape this
  package's own checker follows.
- [MADR](https://github.com/adr/madr), for the decision-record template this package's ADRs carry.
- the [Contributor Covenant](https://www.contributor-covenant.org), for `CODE_OF_CONDUCT.md`.

Four more names sharpened where this package chose to sit, without text taken directly:
[Ruler](https://github.com/intellectronica/ruler), [AgentSync](https://github.com/yelmuratoff/agent_sync),
[awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules), and
[config-drift-checker](https://github.com/jameskomo/config-drift-checker). `docs/handbook/upstreams.md`
is the full ledger, dated and licensed; `NOTICE` says exactly what was borrowed and how.
