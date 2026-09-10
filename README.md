# house-rules

[![ci](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/dubbl-a/house-rules/actions/workflows/ci.yml)
[![license: MIT and CC BY 4.0](https://img.shields.io/badge/license-MIT%20and%20CC%20BY%204.0-blue.svg)](NOTICE)

## What it is

Claude Code is a program that builds and changes software from what you describe in plain words.
It is good at building. What it does not bring on its own is the working knowledge an experienced
team carries, such as taking a proven backup before a change to stored data, or trying a fix on a
separate copy before touching the shared one. You would have to know to ask. house-rules is that
expertise, researched and written down as rules across nine areas: working with Claude Code itself,
documentation, engineering, GitHub, testing, databases, deployment, data pipelines, and text a model
produced. Each rule comes from what went wrong on a real project or from a practice the wider
engineering community has already settled, with its source named, so you do not have to research
it yourself.

The rules are also how your instructions to Claude Code are managed, and that matters because
whatever you write for it is advice: nothing checks that a session followed it, that it is still
true after the project changed, or that it stayed short enough to be followed at all. house-rules
puts the rules in your project as ordinary files that Claude Code reads every time it works, keeps
each one scoped to the files it concerns and under a length ceiling, locks each with a fingerprint
so a hand edit shows, and runs a checker that reads the project back and tells you when a rule and
the project have stopped matching.

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

**If you are an engineer**, this is a Claude Code plugin. The nine modules render into
`.claude/rules/house/`, each rule an imperative heading, a one-clause why, an `Anchor:` naming what
enforces it, and a receipt; `.house/lock.json` hashes every managed file; `node .house/check.mjs`
runs in CI; a PreToolUse hook refuses a commit or push to a protected branch in every session; the
next version arrives as a diff you approve. It installs from this repository with the `claude` CLI.
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

Node 22 or newer, `git`, and bash, plus the GitHub CLI (`gh`) for the pull-request workflow the
rules assume: the worktree cleanup script, the deploy guards, and the handoff skill shell out to it.
No language or framework is assumed. The docs gate resolves `npm run` tokens against `package.json`
scripts only where that file exists, as the header of `plugins/house/payload/check.mjs` says, so
without one they are skipped, not failed; `bareScriptAllowlist` and `packageRoots` tune the rest.

## Adopting house-rules in a repo

Install the plugin once per machine:

    claude plugin marketplace add dubbl-a/house-rules
    claude plugin install house-rules@house-rules --scope user

Inside the target repo, run `/house-rules:bootstrap`: it probes the repo, proposes a `house.json`,
and on approval writes the vendored rules, templates, `.house/check.mjs`, `.house/lock.json`, and
`.house/INDEX.md`. Run `/house-rules:sync` after this package or the repo's `house.json` changes.
Wire the checker in by hand: add `"check:house": "node .house/check.mjs"` and
`"check:docs": "node .house/check.mjs --only=drift,todo"` to `package.json`'s scripts, and run
`node .house/check.mjs` as a CI step. `house.json` records which modules are on, a dated ledger of
what the repo declined and why, per-file line ceilings that tighten as files shrink, and the guard
record; `plugins/house/schema/house.schema.json` describes every key.

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
labelled good first issue are scoped for a first pull request. `CONTRIBUTING.md` covers the
branch-and-PR flow, the upstream-first rule, the escape hatches, licensing (inbound is outbound, no
CLA), and `npm run verify`. `SECURITY.md` is how to report a vulnerability privately;
`CODE_OF_CONDUCT.md` applies wherever this project runs.

## Standing on other people's work

This package borrowed ideas, structure, and in places actual text before it wrote a line of its own
rules. Each is named plainly rather than folded into one credits line, because each shaped something:

- [superpowers](https://github.com/obra/superpowers) (obra), for the in-session discipline this
  package complements and for the starting text behind its worktree and finish-branch guidance.
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
