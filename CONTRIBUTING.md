# Contributing to house

house-rules ships prose rule files, a checker script, a branch-guard hook, and the Claude Code
skills that drive both. This repo also adopts its own package (see `CLAUDE.md`), so most of what
binds a contributor here is exactly what the package ships to everyone else.

## What is welcome, and how to start

A rule with the receipt that earned it, a bug in the checker, a hook, or a skill, and an adopter's
report that a rule keeps getting ignored are what is welcome here. An issue labelled good first
issue is the easiest place to start. Clone the repo (there are no npm packages to fetch) and run
`npm run verify` once on `main` before you branch, so the first red you see is yours. Node 26 or
newer, `git`, bash, the GitHub CLI, and the `claude` CLI are the prerequisites; `README.md` lists them.

## Branch and PR for every change

Every change lands on its own branch and through its own pull request, reviewed before merge.
Direct commits to `main` are refused by the branch guard this package itself ships. Wait for both
CI checks, `verify` (`.github/workflows/ci.yml`) and `checks` (`.github/workflows/pr-checks.yml`),
before merging.

## Before you push: `npm run verify`

`npm run verify` chains `npm test`, `npm run test:hooks`, `npm run check:traceability`,
`npm run check:house`, `npm run test:smoke`, and `npm run check:plugin`. The last needs the
`claude` CLI on `PATH`, a prerequisite for the local gate; a missing CLI fails the run rather
than skipping it. Run `npm run verify` locally before every push; `.github/workflows/ci.yml` runs
the payload copy of the checker and `.github/workflows/pr-checks.yml` runs the vendored one, so
both copies are exercised between the two workflows.

## Upstream-first: edit the source, never the vendored copy

`plugins/house/templates/0001-adopt-house.md` states this for every repo that adopts the
package: "Upstream-first: never edit a managed file in place; propose the change in the package
and sync down." Because this repo vendors its own rules into `.claude/rules/house/`, the same
rule binds here first, and hardest: never hand-edit `.claude/rules/house/*.md` or
`.house/check.mjs`. They are generated, and a hand edit is overwritten by the next render.

To change a rule's prose, edit the module source under a module's `rules/*.md`, for example
`plugins/house/modules/docs/rules/docs.md`. To change the checker itself, edit
`plugins/house/payload/**`. Either way, then run:

```
node plugins/house/scripts/house render --apply
```

and commit the regenerated `.house/` and `.claude/rules/house/` files alongside your source edit,
in the same PR, by explicit path. Never `git add -A`.

A new module has to be listed by hand in several places: its handbook chapter, the manifest and
inventory, `house.json` and the rendered outputs, the README and the site, the rule-proposal
template, the marketplace description, and the harness-audit module list.
`tests/module-registration.test.mjs` lists each one and fails naming the module and the file when
any is missing or a stated module or rule count disagrees with the module directories.

### What the shape checks enforce

A rule that breaks one of these fails `npm run verify`:

- A rule heading may not start with a word ending in `s`, `ing`, or `ion`, so "Use branches" passes and "Branches" does not. The checker reads such a word as non-imperative (`tests/check/shape.test.mjs`, "an ambiguous non-imperative heading").
- A rule file carries at most three `Anchor: none (because ...)` lines, each with its reason (`tests/check/shape.test.mjs`, "more than three").
- Rule prose carries no date-like or percent-like token (`tests/check/shape.test.mjs`, "date-like token" and "percent-like token").
- A rule that says "at adoption" needs the module to declare a matching `atAdoption` step in its `module.json`, each with a unique kebab-case id (`tests/at-adoption.test.mjs`).
- An Anchor that names a file path must name one that exists, or the drift check flags it (`tests/check/drift.test.mjs`, "unresolved file-path anchor").
- A module's default `paths:` glob that matches no tracked file in a consumer is dropped when the rule renders, so a default for a directory the consumer lacks vendors the rule without that trigger (`tests/check/consumer-render.test.mjs`, "still dropped").

## The rule-file prose shape

Every rule, in its module source and in the rendered copy, follows one shape: an imperative
heading that is itself the rule, a one-clause why, an `Anchor:` line naming what enforces it, and
a `Receipts:` pointer to the handbook chapter that earned it. Every rule file ends with a
`## Don't` section. Rule and body prose carries no em dash, and `modules.docs.config.emDash`
names the surfaces that ban covers rather than leaving each exception to memory. The slot
defaults to `README.md`, `CHANGELOG.md`, and `docs/**/*.md`; this repo sets its `mode` to `all`,
which adds every rule file on top of those, and excludes one path, `docs/handbook/sources/**`,
because those are point-in-time research notes kept verbatim. See `.claude/rules/house/docs.md`
for a worked set of these.

## Two escape hatches, both dated and in `house.json`

When the checker disagrees with a change you believe is correct, there are exactly two ways
through it, never a silent edit to the checker itself:

- **`deviations`**: one entry, with `kind`, `what`, `why`, and `decided`, when you decline a house
  default (a disabled module, a non-`pr` branch policy, a carve-out, an unmanaged file, a raised
  co-load ceiling).
- **`ratchetRaises`**: one entry, with `path`, `from`, `to`, `why`, and `decided`, when a file
  legitimately needs to grow past its current line ceiling; the entry applies on the next run with
  nothing else to run (`--accept-lengths` is still accepted and does nothing).

Both require a written reason on the same commit as the growth or the decline; neither is a way
to route around review.

## Below 1.0, the breaking class spends the minor

`docs/decisions/0011-rule-content-changes-are-minor.md` settles the classes: rewriting, adding, or
re-arguing rule prose is minor, because nothing reaches an adopting repo without a person running
`/house-rules:sync` and approving the plan it prints; renaming or removing a rule heading, removing
or renaming a config slot, tightening what the branch guard denies, changing the `house.json` or
`.house/` layout, or raising the Node floor is the breaking class. Below 1.0 there is no major
slot, so `docs/decisions/0012-below-one-spend-the-minor-on-the-breaking-class.md` gives the
breaking class the minor and every other change the patch, until 1.0 restores major, minor, and
patch as 0011 states them.

## Changelog

Add a line under `[Unreleased]` in `CHANGELOG.md` only when an adopting repo would notice: a new
module, a new check, a changed default, a policy change. Skip it for a refactor, an infra change,
or a silent fix; those live in git history instead.

## Cutting a release

1. On a branch, bump `version` in `plugins/house/.claude-plugin/plugin.json` and the pin in
   `house.json`, cut the `[Unreleased]` section of `CHANGELOG.md` into the new version, and move the
   pinned tag in the install commands of `README.md` and `SECURITY.md` to it. Open a PR.
2. Merge it.
3. Tag the merge commit with an annotated tag: `git tag -a vX.Y.Z -m "Release X.Y.Z"`, then
   `git push origin vX.Y.Z`. Tags are not signed.
4. `gh release create vX.Y.Z` with the changelog section as the notes.

Immutable releases are on for this repository (since 2026-10-03), so a published release's tag and
assets cannot be changed, and `gh release verify vX.Y.Z` checks the release attestation. Only
`v0.18.0` has a gitsign-signed tag; `v0.16.0` and `v0.17.0` are annotated and unsigned, and
`v0.15.2` and older are lightweight.

## Licensing your contribution

This repository is licensed by path; see `NOTICE` for the exact scopes: MIT for the checker
payload, the CLI, hooks, module `files/` directories, the schema, `scripts/`, `tests/`, and the
JSON manifests, CC BY 4.0 for rule files, skills, markdown templates, `docs/`, `README.md`, and
`CHANGELOG.md`. Anything not listed there takes the license of its kind, MIT if a program reads
it, CC BY 4.0 if a person does, which is why this file and the other community documents are
CC BY 4.0, except `CODE_OF_CONDUCT.md`, which is the Contributor Covenant under its authors' own
CC BY 4.0 terms rather than this project's (see `NOTICE`). By opening a pull request you license
your contribution on the same terms as the file it lands in. Inbound is outbound; there is no
separate CLA.

## Reporting a bug, proposing a rule, or asking a question

Use the issue templates: `.github/ISSUE_TEMPLATE/bug_report.yml` for something the checker, a
hook, or a skill gets wrong, `.github/ISSUE_TEMPLATE/rule_proposal.yml` for a new or changed
rule, and `.github/ISSUE_TEMPLATE/question.yml` for everything else, though a
[Discussion](https://github.com/dubbl-a/house-rules/discussions) usually fits a question better
than an issue.
