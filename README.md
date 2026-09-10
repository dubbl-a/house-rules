# house-rules

[![ci](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml)
[![license: MIT and CC BY 4.0](https://img.shields.io/badge/license-MIT%20and%20CC%20BY%204.0-blue.svg)](NOTICE)

## What it is

Claude Code is a program that builds and changes software from what you describe in plain words.
It is good at building. What it does not bring on its own is the working knowledge an experienced
team carries: how to change stored data without losing it, how to put something live so it can be
undone, what a passing test is allowed to prove, how a change should travel from your machine to
the shared copy. You would have to know to ask, and know what to ask for. house-rules is that
expertise, researched and written down as rules: what went wrong across real projects, and what
the wider engineering community has already settled, each drawn from a named source, so you do not
have to research it yourself. The rules are copied into your project as ordinary files, where
Claude Code reads them every time it works. And because written advice goes stale, a checker reads
your project back and tells you when a rule and the project have stopped matching.

## What the rules cover

Nine sets of rules, called modules, each the researched practice for one area. Five are on unless
you switch them off:

- **claude-code**: the assistant's own setup: what it reads each time, how long that may be, and
  where a new fact belongs.
- **docs**: the written record, so no document points at something that no longer exists.
- **engineering**: how code gets written, checked, and reported day to day.
- **github**: how a change travels: a separate copy to work on, a review before it joins the main
  copy, and no passwords or keys in the project.
- **testing**: what "done" may claim, and what a passing test proves.

Four turn on when your project looks like it needs them:

- **database**: stored data, with a backup taken and proven before any change that could lose it.
- **deployment**: putting something live, deliberately, with a backup restored for real from time
  to time rather than assumed to work.
- **data-pipelines**: scheduled jobs that move data in bulk, which refuse to delete more than a
  little without asking.
- **llm-output**: text a model produced, kept aside until a person has checked it, so nothing a
  model wrote is read as fact by accident.

Every rule was earned or borrowed, never invented. `docs/handbook/` records, for each one, the
incident from one of the five real projects these rules came out of, or the published practice it
borrowed with its source named; `docs/handbook/inventory.md` traces every harvested practice to the
rule that carries it, and `docs/handbook/upstreams.md` is the ledger of sources. A rule you
disagree with is argued on its evidence, not worked around.

## Who it helps

**If you are not an engineer**, these rules carry what you would otherwise have to learn the hard
way or go and research: the practice an experienced team would already know, written so it applies
without you knowing its name. Before the assistant changes stored data, it takes a backup and proves
the backup works. Before it fixes something, it tries the fix on a separate copy. It never writes
an instruction for itself that names a command that does not exist. Each rule says why in the same
breath, so you learn the reasoning as you go. Start with the plain-language guide, which explains
every technical word where it first appears: https://house-rules-guide.vercel.app

**If you are an engineer**, this is a Claude Code plugin. The nine modules render into
`.claude/rules/house/`, each rule an imperative heading, a one-clause why, an `Anchor:` naming what
enforces it, and a receipt. `.house/lock.json` hashes every managed file. `node .house/check.mjs`,
wired into CI, fails on a hand-edited rule, a doc naming a script that no longer exists, a file over
its line ceiling, or too many rules loading for one path. A PreToolUse hook refuses a commit or push
to a protected branch in every session. The next version arrives as a diff you approve, and a
locally modified managed file is refused with its diff rather than overwritten. It installs from
this repository with the `claude` CLI; nothing is on npm or GitHub Packages, and an adopting repo
needs no registry because it carries its own copy of the checker and the rules.

These are one maintainer's opinionated conventions, published so other people can adopt them. They
keep changing, so read each update as a dependency bump, take the parts you want, and fork for the
last word. A repo never imports house-rules; it adopts a fixed copy made at that moment, not a link.

## How this sits next to other tools

Skill packs teach a session a procedure while it works; this runs alongside one, not in place of it.
It covers the half that persists: conventions that live in a repository, with something that enforces
them. Rules are rendered and vendored into your repo because the Claude Code plugin format has no
rules component and a `CLAUDE.md` at a plugin root is not loaded (`docs/handbook/origins.md`), so your
own checkout is the only place a rule reliably lives. Cross-tool sync tools fan one source out to many
agents and copy-paste collections hand you a starting text; both finish at delivery, which is where
this package starts.

## Prerequisites

Node 22 or newer, `git`, and bash. The GitHub CLI (`gh`) is a requirement of the pull-request workflow
these rules assume rather than of the checker: the worktree cleanup script, the deploy guards, and the
handoff skill shell out to it. No language or framework is assumed. The docs gate resolves `npm run`
tokens against `package.json` scripts only where that file exists: the header comment on
`plugins/house/payload/check.mjs` says a checked repo may or may not have one, so without it they are
skipped, not failed. `bareScriptAllowlist` and `packageRoots` tune the rest.

## Adopting house-rules in a repo

Install the plugin once per machine:

    claude plugin marketplace add dubbl-a/house-rules
    claude plugin install house-rules@house-rules --scope user

Inside the target repo, run `/house-rules:bootstrap`. It probes the repo, proposes a `house.json`,
and on approval writes the vendored rules, templates, `.house/check.mjs`, `.house/lock.json`, and
`.house/INDEX.md`. Run `/house-rules:sync` later, after this package or the repo's `house.json` changes.

Wire the checker in by hand: add `"check:docs": "node .house/check.mjs --only=drift,todo"` and
`"check:house": "node .house/check.mjs"` to `package.json`'s scripts, and run `node .house/check.mjs`
as a CI step.

## house.json, in one line each

- **modules**: which of `claude-code`, `docs`, `engineering`, `github`, `testing`, `database`,
  `deployment`, `data-pipelines`, `llm-output` are on or off, plus each one's config; bootstrap
  probes the repo for the modules whose package default is `detect`.
- **deviations**: the dated ledger of what this repo declined from a house default and why; required
  whenever a default-on module is off, `branchPolicy` is not `pr`, a `carveOuts` glob is added, or
  `maxCoLoadLines` is raised above the default (kind `coload-ceiling`).
- **ratchet**: per-file line ceilings the checker tightens on its own whenever a file shrinks;
  raising one takes a written, dated reason in `ratchetRaises`, applied on a run with `--accept-lengths`.
- **guard**: optional dated record that the plugin supplies the branch guard, clearing that warning.

## The checker

`node .house/check.mjs` runs ten families: `drift`, `todo`, `tamper`, `behind`, `shape`, `lengths`,
`coload`, `manifest`, `minutes`, `guard`; scope a run with `--only=fam,fam`. Exit 0 is clean (warnings
still print), 1 means findings, and 2 means an unusable `house.json` reached a family that needs one
(`tamper`, `manifest`, `coload`, `guard`); the rest fall back to defaults instead. The full config
vocabulary each family reads is in the header comment atop `plugins/house/payload/check.mjs`.

## Versioning and breaking changes

Three classes, per `docs/decisions/0011-rule-content-changes-are-minor.md`: rule content is minor,
the named surface (a rule heading, a config slot, the guard's deny set, the `house.json` or
`.house/` layout, the Node floor) is breaking, and a fix is patch. No rule byte reaches your
checkout until you run `/house-rules:sync` and approve the plan it prints.

Below 1.0 there is no major slot to spend, so the breaking class takes the minor and every other
change takes the patch, giving a `^0.x` pin the semver it expects. At 1.0 the mapping returns to
major, minor, and patch as 0011 states them. The full mapping is in
`docs/decisions/0012-below-one-spend-the-minor-on-the-breaking-class.md`.

## License

Code is MIT (`LICENSE`), rule prose and documentation are CC BY 4.0 (`LICENSE-DOCS`), and code
examples inside documentation are MIT wherever the surrounding prose sits. The SPDX expression for
the repository is `MIT AND CC-BY-4.0`; `NOTICE` lists which paths fall under which and names every
upstream that contributed text, structure, or a working method.

## Contributing

Three kinds of contribution fit here. A rule, through the rule-proposal issue form: the incident or
receipt that earned it matters more than its wording, because every rule ships with a handbook
section that argues for it. A bug in the checker, a hook, or a skill, through the bug-report form,
with the command and its output. And an adopter's report that a rule kept getting ignored or a
check fired wrongly, which is how rules get cut. Questions fit
[Discussions](https://github.com/dubbl-a/house-rules/discussions) better than an issue, and issues
labelled good first issue are scoped for a first pull request. `CONTRIBUTING.md` covers the
branch-and-PR flow, the upstream-first rule, the two escape hatches, licensing (inbound is outbound,
no CLA), and `npm run verify`, the local gate. `SECURITY.md` is how to report a vulnerability
privately, and `CODE_OF_CONDUCT.md` applies wherever this project runs.

## Standing on other people's work

This package borrowed ideas, structure, and in a few places actual text before it wrote a line of
its own rules. The people and projects below are named plainly rather than folded into one credits
line, because each one shaped something specific.

- [superpowers](https://github.com/obra/superpowers) (obra), for the in-session discipline this
  package complements and for the starting text behind its worktree and finish-branch guidance.
- [antfu's eslint-config](https://github.com/antfu/eslint-config), for the personal-config contract
  this README opens with.
- [typescript-eslint's versioning policy](https://typescript-eslint.io/users/versioning/), for the
  strict pole weighed against antfu's loose one, and [Prettier's option
  philosophy](https://prettier.io/docs/option-philosophy), for why the em dash setting is a small,
  fixed set of options rather than a knob per exception.
- [cruft](https://cruft.github.io/cruft/), for proving the update, check, and skip-list shape this
  package's own checker follows.
- [MADR](https://github.com/adr/madr), for the decision-record template this package's ADRs still
  carry.
- the [Contributor Covenant](https://www.contributor-covenant.org), for `CODE_OF_CONDUCT.md`.

Four more names sharpened where this package chose to sit, without contributing text taken
directly: [Ruler](https://github.com/intellectronica/ruler),
[AgentSync](https://github.com/yelmuratoff/agent_sync),
[awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules), and
[config-drift-checker](https://github.com/jameskomo/config-drift-checker).

`docs/handbook/upstreams.md` is the full ledger, dated and licensed; `NOTICE` says exactly what was
borrowed and how.
