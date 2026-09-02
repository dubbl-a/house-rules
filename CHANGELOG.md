# Changelog

All notable changes to this package. Format: Keep a Changelog. Versioning: semver in `plugins/house/.claude-plugin/plugin.json` only.

Issue and PR numbers in sections below 0.5.0 refer to this package's predecessor repository and do not resolve here.

## [Unreleased]

### Changed
- **The package's own mechanisms now name the native Claude Code feature they build on.** The
  bootstrap and revise-docs skills say what the harness's own init command and machine-local
  memory notes already do before they say what they add. The conventions chapter records that a
  plugin has no native component that ships rule files or instruction content as project context,
  which is why house renders and vendors, and that session resume and harness memory carry state
  on one machine only, which is why the carryover issue is the shared tier. The github chapter
  states that every matching PreToolUse hook still runs and the most restrictive decision wins, so
  the branch guard's deference to a repo-local guard is a deliberate migration choice rather than
  something the harness requires, and that the guard family reports what is recorded, not what is
  enforced. The checker's drift and lengths family comments name the hosted reviewer and the
  harness's own auto-memory measurement as their floors, and the branch guard hook's fail-open
  block now lists the sessions and tool routes where it never sees the command at all. Skill
  prose, handbook prose, and comments only: no behavior change.

## [0.5.0] - 2026-09-02

First public release. Everything below shipped in this version; earlier sections describe the private predecessor.

### Changed
- **The em-dash check is now a config slot, `modules.docs.config.emDash`, and its default surface
  changes.** It used to scan rule files and nothing else. The default is now `{"mode": "public",
  "paths": ["README.md", "CHANGELOG.md", "docs/**/*.md"], "exclude": []}`: public prose, where an
  em dash is a tell a reader actually sees, rather than the rule files, which ADR 0010 already
  gates upstream at authoring time.

  **Adopters on the default lose rule-file em-dash coverage and gain README, CHANGELOG, and docs
  coverage.** Sync does not propose new slots, so an adopter that never sets the slot moves to the
  new surface silently. Two paste-in values for `modules.docs.config`:

  Keep the old surface and add the new one:

  ```json
  "emDash": { "mode": "all", "paths": ["README.md", "CHANGELOG.md", "docs/**/*.md"], "exclude": [] }
  ```

  Turn the check off entirely:

  ```json
  "emDash": { "mode": "off" }
  ```

  `mode` is `public`, `all` (the public paths plus every rule file), or `off`. `paths` and
  `exclude` entries are a glob string or the `{"path", "why"}` object form, matched the way every
  other docs path slot is; `exclude` narrows `paths` and can never drop a rule file under `all`.
  A malformed field is a `manifest` finding and falls back to its own default, so a typo reverts
  that field to the default set rather than turning the scan off, and the manifest family names it.
  An explicit `"paths": []` is a second off switch: an empty array wins over the default, scans
  nothing, and is not a defect. The finding is otherwise unchanged: family `shape`, message
  `em dash character`.
- **The plugin and marketplace descriptions are rewritten for a general audience.** They are what
  an adopter reads in a plugin listing, and they used to open with the author's name and assume a
  reader who already knew what the package was for. Nothing about the plugin's behavior changes.

### Added
- **The package now states its license, by path.** `LICENSE` carries MIT and `LICENSE-DOCS`
  carries the CC BY 4.0 legal code, both verbatim from their canonical sources. `NOTICE` says
  which path takes which: MIT for the checker payload, the CLI, the hook, module `files/`
  directories, the schema, `scripts/`, `tests/`, and the JSON manifests; CC BY 4.0 for rule
  files, skills, markdown templates, `docs/`, `README.md`, and this file. Code examples inside
  documentation are MIT wherever the surrounding prose sits, so a snippet can be pasted without
  an attribution string attached. The expression for the repository as a whole is
  `MIT AND CC-BY-4.0`, and `package.json` and `plugins/house/.claude-plugin/plugin.json` now
  carry `"license": "MIT"`. Until now a vendoring repo had no stated terms at all, which is the
  one question an adopter cannot answer for itself. `NOTICE` also carries an attribution for
  every upstream in `docs/handbook/upstreams.md` that contributed text, structure, a schema
  shape, or a working method, and says why the one share-alike upstream in that ledger
  propagates no condition here. The same relaunch adds the community files an adopter looks for
  before filing anything: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and the four
  issue forms under `.github/ISSUE_TEMPLATE/`.

- **A written breaking-change policy: rule content is minor, and major is the named surface**
  (`docs/decisions/0011-rule-content-changes-are-minor.md`). Rewriting a rule, adding a heading,
  adding a default-off module, or adding an optional schema key is a minor. Renaming or removing
  a rule heading, removing or renaming a config slot, tightening what the branch guard denies,
  changing the `house.json` or vendored-tree layout, and raising the Node floor are the breaking
  classes. The reasoning is that nothing reaches an adopting checkout without a person running
  `/house-rules:sync` and approving the printed plan, and the checker's report of a newer release
  is a warning that never fails a run. Below 1.0 a breaking change is still announced as one in
  this file and carried by the next minor. `docs/handbook/conventions.md` points at the record
  from the paragraph that enumerates the public surface.

## [0.4.1] - 2026-09-01

### Fixed
- **A no-op repo-local guard file no longer disarms the branch guard, and the checker no longer
  <!-- docs-drift-ignore: a CONSUMER-side path; this repo ships the hook at plugins/house/hooks/ and has no vendored copy of its own -->
  certifies one** (#27). The hook deferred to `.claude/hooks/no-direct-master.sh` by mere file
  EXISTENCE, so an empty file, or one containing only `exit 0`, removed branch protection
  entirely. `checkGuard` certified that same file by bare `existsSync`, so the two failures
  compounded: the repo reported a reachable guard while nothing enforced anything. Protection
  reported but absent is worse than no guard, because it is the state nobody investigates.

  Both sides now share one predicate: a local guard file counts only if it has a line that is not
  blank, not a comment or shebang, and not a bare `exit 0`. The predicate fails toward DENY --
  a local guard whose shape is unrecognized leaves the plugin hook armed, costing a branch
  creation rather than a miss. That is the direction #27 asks every allowlist in this file to fail
  in, and the settings.json branch beside it already worked this way.

  The old behavior was pinned as intended by a test that planted an `exit 0` stub and asserted
  deference; that case now asserts the opposite, with five stub variants beside it.

  No adopter is affected: none of the six repos has a repo-local guard file.

### Note
- The parsing-class bypasses in #27 (a space-quoted `-c` value, a `-c` body that changes
  directory, backslash-escaped verbs) are deliberately NOT addressed here. They need the redesign
  that issue describes, not another increment; three review rounds on PR #28 showed each added
  parsing rule opening a new seam. This change is in the other category: it removes a disarm
  rather than parsing a command better.

## [0.4.0] - 2026-09-01

### Fixed
- **A documented path's existence is a property of the repo, not of the machine.** The drift
  check's kind-(c) fallback probed the DISK after a tracked-set miss, so a path that is
  gitignored by design resolved on a developer's checkout and never on a runner's:
  `npm run check:house` passed locally and the identical run failed in CI. repo-d carried
  <!-- docs-drift-ignore: these three are repo-d's paths, a different repo; they are the incident this entry describes, not a claim about this tree -->
  four such findings (`repo-g/.env`, `app/node_modules`, `.claude/worktrees/*` -- all
  correct paths, two of which must never be committed) and nobody saw them for a week, because
  its `pull_request` trigger was off over the Actions-budget pause (#21) and the local gate was
  green the whole time. A check that only passes where the untracked files happen to be is not
  a check.

  The fallback now asks git what it IGNORES rather than asking the filesystem what is there.
  Ignore rules are committed, so the answer is identical on every checkout, and "git deliberately
  keeps this out of the tree" is a better reason to exempt a path than "it happens to be on this
  disk". Glob-parent anchors go through the same door: that branch was a bare `existsSync` with
  the same machine-dependence. The probe asks for both the bare and trailing-slash spellings,
  because a `dir/` pattern matches only a directory and git cannot tell that a path it cannot see
  is one.

  Net effect per path: gitignored resolves everywhere instead of only where the file sits;
  untracked-and-unignored is now a finding everywhere instead of passing on the author's machine
  and failing in CI. Measured across all six adopters before the change: zero anchors depended on
  the disk probe, so no repo loses a passing anchor.

### Added
- **`local-only ignore` warning.** A path hidden only by `.git/info/exclude` or a global
  `core.excludesFile` still resolves, but those rules do not travel with the repo, so a fresh
  checkout will flag it. That is the same divergence in a quieter form, so it now warns (naming
  the two fixes: commit the rule, or list the path in `buildArtifactPrefixes`) instead of passing
  in silence.

### Removed
- `existsOnDiskCaseExact` and its `realpathSync.native` case-canonicalization, dead once the disk
  probe is gone. Case-exactness now comes from the tracked set alone, which is where it always
  actually came from on a fresh checkout.

## [0.3.2] - 2026-08-31

### Fixed
- **The branch guard reads an interpreter's `-c` body.** The message-argument strip removed `-c`
  and its value (meant for git's own `-c key=value`), which made a git verb inside an interpreter
  command invisible to every scan since v0.2.2 (#27). The hook now also scans a `-c`-retaining
  variant of the command and denies when either variant matches, so the change can only turn an
  allow into a deny. This closes the direct interpreter cases (an interpreter `-c` body running a
  commit on a protected branch, or a push to a protected branch from any branch). Two related
  bypasses stay open and are tracked in #27, deliberately not chased here because closing them
  means the command parsing the guard's own header warns against: a `-c` value quoted with spaces
  survives the strip, and a `-c` body that changes directory into another repo is target-blind.
  Accepted cost: any non-git command that takes a `-c` flag whose value quotes a git verb plus a
  branch name now refuses on any branch (a curl cookie-jar, a `grep -c`, a `python -c`, an
  ssh/docker `-c`), the same false-deny class as the existing quoted-verb behavior; git's own
  space-free `-c key=value` commands are unaffected.

## [0.3.1] - 2026-08-31

### Changed
- **A new carryover issue closes the one it supersedes.** The handoff skill's original form left
  every superseded session-carryover issue open, so finished sessions accumulated open issues;
  the new issue now closes its predecessor with a "superseded by" comment, keeping exactly one
  carryover open and the chain walkable in both directions.
- **The carryover form drops anything re-derivable from the recorded SHA.** Gate exit codes and
  count tables are out (they re-run in seconds and a re-run number cannot be fabricated); what
  remains is tree state, shipped PRs, the headline finding, the next-cycle list, and the
  deferred-vs-not-done split. The `Hand off through a carryover issue` rule and the handbook
  form spec say the same.
- **Post-sync feedback is one issue per item, never a digest.** The sync skill gains a step 8:
  findings only the package can act on are fixed upstream in the same session or filed as one
  closeable issue each in the package repo, ending the multi-item feedback-dump pattern.

## [0.3.0] - 2026-08-31

### Fixed
- **A rule file's own receipts stopped warning in every consumer.** A vendored rule file names
  this package's surface in its prose (`docs/handbook/`, `docs/decisions/`, `plugins/house/`,
  `tests/`), and none of those resolve in the repo that adopted it: two adopters were each
  carrying about 119 identical, unfixable warnings per run. Tokens under those four prefixes are
  now dropped in a consumer's managed files whose body matches `.house/lock.json`, and stay hard
  findings here. ADR 0010 records why the exception is scoped to lock-vouched managed files.
- **A plugin-guarded repo can clear the `guard` warning.** A new top-level `guard` key in
  `house.json` (`by`, `decided`, `why`) records that the branch guard comes from the plugin, so
  the repo no longer has to re-vendor the hook the plugin exists to retire in order to look
  compliant. The record clears the checker's warning and is never a stand-down signal for the
  hook, which still denies. `house doctor` now prints `plugin (recorded <date>)` or
  `plugin (unrecorded)` for the effective branch guard.
- **`bareScriptAllowlist` and `excludeFiles` entries take an object with a `why`.** Alongside the
  plain strings, `{"token", "kind", "why"}` and `{"path", "why"}` (also honored for
  `archiveDirs`) turn a permanent suppression into a dated record. ADR 0009 covers all three
  shapes.
- **The docs-drift ignore-file marker window skips YAML frontmatter**, so a document whose
  frontmatter sits above the marker is opted out as intended rather than scanned anyway.
- **`house check` always runs the plugin's own payload**, and says so on stderr, rather than
  silently preferring a vendored copy that may differ from what is installed.
- **`docs.config.packageRoots` re-roots script and path anchors** for a repo whose npm package
  lives in a subdirectory, so a token relative to that package resolves instead of warning.

### Added
- `dependabot.yml` ships as a one-time `github`-module scaffold, written only when the repo has a
  `package.json` for it to describe.
- A warning names any repo-authored rule file with no configured length budget, so a file that
  nothing measures is visible instead of silently unbounded.
- A ship-set invariant test holds the set of files a release actually ships.

### Removed
- The ungenerated `house:rows:start` / `house:rows:end` markers are gone from the CLAUDE.md
  skeleton. They claimed `house render` filled the table and nothing ever did; the table now
  carries an instruction to copy its rows from `.house/INDEX.md`.

### Notes
- Three upgrade hazards. (1) `guard` is a new top-level key: sync the vendored checker before
  adding it, because an older `.house/check.mjs` reports it as an unknown key. (2) A lock written
  before 0.2.3 has no `scaffolds` record, which suppresses the new `dependabot.yml` scaffold until
  `render --apply --scaffold` is run once. (3) A CLAUDE.md skeleton already scaffolded into a
  consumer does not pick up the marker removal; scaffolds are one-time by design, so edit that
  copy by hand. (4) `house check` runs the installed plugin's payload, so a repo pinned AHEAD of
  the plugin can get answers CI's vendored checker will not give; the command now prints a
  version-skew warning on stderr in that case, and the fix is updating the plugin.

## [0.2.6] - 2026-08-29

### Added
- **A rule for the auto-memory index**, in the claude-code module: one line per memory, and that
  line is the cue to open the topic file rather than the fact itself; move a fact the index is
  the only copy of down into its file before shortening the line; keep the newer cue when a later
  memory supersedes an earlier one; and read the load ceiling as a cliff, not a budget. Receipt in
  `docs/handbook/claude-code.md`, inventory rows AG-065 (port) and EXT-099 (fold).
- **`lengths` now warns on the auto-memory index.** It loads in full at the start of every session
  and the harness cuts it at 200 lines or 25KB, whichever comes first, with nothing in the session
  saying the tail was dropped. The check derives the path from `CLAUDE_CONFIG_DIR` (or the default
  config directory) plus the project directory name, which is the repo root with every separator
  turned into a dash, or `CLAUDE_CODE_PROJECT_DIR_NAME` when that is set beside `CLAUDE_CONFIG_DIR`
  (the harness ignores it on its own, so the checker does too). It warns
  past 140 lines, 17,500 bytes, or any line over 160 characters, naming the counts and the first
  three long lines.

### Notes
- The memory-index check is the first time the checker reads state outside the repo it was pointed
  at, so it warns and never fails, and it is silent when the file is absent: a CI checkout has no
  config directory, so the check is a no-op there by construction. The thresholds are compiled in
  with no `house.json` slot, because the caps belong to the harness rather than to a repo's policy.
  ADR 0008 records the boundary. Three cases in `tests/check/lengths.test.mjs` hold it: an
  over-threshold index warns at exit 0, a short one is silent, and an empty config directory is
  silent.

## [0.2.5] - 2026-08-25

### Fixed
- **Prose could disarm the branch guard.** Target resolution reads `cd <path> &&` and
  `-C <path>` out of the command, and a target that is not a repo is a deliberate fail-open. Any
  text naming a path that does not exist therefore pointed the check at nothing and a real commit
  on a protected branch was **allowed**. A heredoc body, a commit message, or a quoted string all
  did it. Confirmed against the shipped hook, then closed. (#27)

  The fix adds no parsing, on purpose. Three attempts to parse the command better were written
  and reverted this cycle, each having opened new seams; that history is on #27. A target parsed
  out of the command is now treated as a guess, and a guess that turns out not to be a repo falls
  back to the directory the command actually runs in rather than standing in for it. The guard no
  longer depends on the guess being right, and the change is monotone: it can only turn a former
  allow into a deny, so it cannot open a bypass of its own. A genuinely non-repo working
  directory still fails open, and a real `-C`/`cd` into another repo still resolves to that repo.

  Two corrections from review, neither of which reads the command any further. A **relative**
  target now resolves against the directory the command runs in rather than the hook process's
  own cwd (successive `-C` compose), so a valid `cd ../sibling-repo` is not misread as "not a
  repo". And the accepted cost is now stated where it bites: a target this same command
  **creates** (a worktree, a clone, a fresh `init`) does not resolve yet either, so it denies on
  a protected branch and must be split into two calls. The deny message used to recommend
  exactly that chained one-liner, which meant following the guard's own advice was refused; it
  now says to make the worktree in a separate call. Recognizing creation would mean parsing the
  command again, which is the approach that failed.

### Notes
- #27 stays open for its second confirmed bypass: `-c` in the message-strip list collides with
  every interpreter's `-c`, so a git command wrapped in `bash -c '...'` is invisible to the
  guard. That one needs the strip-list surgery that went wrong three times this cycle and is
  deliberately not attempted here.

## [0.2.4] - 2026-08-25

### Fixed
- **A one-time scaffold's own glob is no longer dropped on a first render.** A `paths:` glob was
  filtered against tracked files only, so on a first render `.claude/**` matched nothing and the
  `claude-code` module's default `claudeGlobs` collapsed to `CLAUDE.md` alone. A repo without one
  had the module vendor zero rules, which the manifest family reports as a finding, not a
  warning. Globs are now tested against the tracked tree plus the dests the render is about to
  write, which also means the `github` rule is vendored on the first render instead of the
  second. (#26)
- **`render` no longer deletes a rule file it just wrote.** A scaffold from the previous render
  is on disk but untracked, so it counted as neither tracked nor planned: the glob was dropped,
  the rule skipped, and the orphan sweep removed it. Two renders in a row with no `git add`
  between them flip-flopped. The render-target gate now mirrors the writer's conditions,
  `--scaffold` included.

### Changed
- **`render` never originates `CLAUDE.md`.** The skeleton is always written as
  `CLAUDE.md.house-skeleton`, matching what `bootstrap/SKILL.md` has always promised
  ("Bootstrap never originates the repo's root file"). Previously a repo with no `CLAUDE.md`
  received one authored on its behalf, opening `# TODO: Project Name`. This ships together with
  the glob fix above and not before it: alone it would have handed every fresh adopter a red
  checker. (#26)

### Notes
- **The branch-guard work planned for this release was reverted and is not shipped.** #27 is
  still open, and it now carries more than it did: two bypasses confirmed against the shipped
  hook (a heredoc body can steer target resolution into the non-repo fail-open, and `-c` in the
  message-strip list collides with every interpreter's `-c`), plus the record of three review
  rounds in which each attempted fix introduced new bypasses of its own that the committed
  suite never caught. The approach, incrementally patching a regex-based shell parser, did not
  converge; the issue proposes failing closed on ambiguity instead. Reverting leaves the hook at
  its known state with two documented holes rather than shipping an unknown one.

## [0.2.3] - 2026-08-25

### Fixed
- **A one-time scaffold is now offered once per repo, not once per `render --apply`.** The
  CLAUDE.md skeleton exists to be merged into `CLAUDE.md` by hand and then deleted, but every
  later render wrote it back, so each adopter re-sync had to `rm` `CLAUDE.md.house-skeleton`
  again to keep the commit clean. `.house/lock.json` gains a `scaffolds` list recording which
  templates a repo has already been given; a recorded template is not written again, whether or
  not its file survives. The record is keyed by template, not destination, because the
  skeleton's destination moves to the sidecar name once a `CLAUDE.md` exists. It is a record,
  never a hash: the tamper family reads `files[]` only, so nothing refuses on it and a repo may
  edit or delete a scaffold freely. (#23)

### Added
- **`house render --apply --scaffold`** ignores that record and writes back any missing
  scaffold. It still never overwrites a file on disk, so an edited copy is safe either way.

### Notes
- A lock written at 0.2.2 or earlier has no `scaffolds` key and is read as "already offered"
  for every template whose module gate passes right now, so the first re-sync at 0.2.3 is quiet
  rather than writing the skeleton one last time. The one case that seed cannot get right is
  pinned as a test: a repo that turns a module ON in the same render that upgrades it is seeded
  as though it had already been offered that module's scaffolds and does not get them;
  `--scaffold` is the way back, and that is why the flag exists.

## [0.2.2] - 2026-08-24

Findings from a multi-agent review of the whole checker surface (check.mjs, the render CLI, the branch-guard hook, and their tests) at v0.2.1.

### Fixed
- **Branch guard: commit-message text could pick where the branch check ran.** The
  target-directory resolution (`git -C <path>`, `cd <path> &&`) matched the raw command
  before message arguments were stripped, so `git commit -m "note: cd /nonexistent && push"`
  on a protected branch resolved to a non-repo path and hit the deliberate non-repo
  fail-open: an allow. Target resolution now runs on the message-stripped command, and
  `--message=...`/`-m=...` forms are stripped too. Hook tests carry the bypass cases and
  the real-`cd`/`-C` controls.
- **"Repo-local guard present" means one thing everywhere.** The hook defers only to a
  non-empty `PreToolUse` array in `.claude/settings.json`; `house doctor` reported `repo`
  for any `hooks` key (an empty block, a PostToolUse logger), and the `guard` family also
  counted a hook in `settings.local.json`, which the hook never reads. Both now mirror the
  hook, with a new `guard` test file.
- **Component drift resolves every configured extension.** The v0.1.2 fix stripped only
  `.astro`; a `Foo.tsx`, `.jsx`, `.vue`, or `.svelte` reference fell through unchecked.
- **Module defaults keyed by `module.json` name.** A module whose `name` differs from its
  directory dodged the disabled-module deviation check; the defaults reader now keys the
  way `house.json` and its sibling readers do.

## [0.2.1] - 2026-08-24

### Added
- **Every module's literal `defaultPaths` now sits behind a config slot** whose default is
  the historical set, so no co-load is unresolvable from `house.json` (#13 left `github`,
  `claude-code`, `database`, and `testing` hardcoded): `githubGlobs`, `claudeGlobs`,
  `dbGlobs`, `testRoots`. An adopter that has not set a slot renders exactly what it did
  before. (#19)
- **`coload` reports every over-budget rule combination**, once each, with the number of
  paths sharing it and an example path, instead of only the single worst path. The
  finding names the resolution order; `--json` `coloadWorst` is unchanged. (#19)
- **A raised `maxCoLoadLines` must be on the record.** New deviation kind
  `coload-ceiling` carrying the value as an integer `ceiling`; a ceiling above the default
  (400) with no entry whose `ceiling` equals it is a `manifest` finding, and a ceiling that
  is not a positive integer is one too. Adopters must sync the checker before adding the
  kind, since a v0.2.0 checker rejects it. (#19)
- **`init`, `render`, and `doctor` probe git-ignored house destinations** with
  `git check-ignore` and warn with the fix (ignore only the local settings file under
  `.claude/`, never the whole `.claude/` or `.house/` directory). `render --json` carries `ignoredDests`; `doctor` prints a
  `git-ignored house destinations` line. (#18)

### Fixed
- **A managed file git cannot see is no longer a silent zero.** The `manifest` family
  compares `.house/lock.json` against `git ls-files`: an entry on disk but gitignored is a
  `[gitignored]` finding (the drift/shape/lengths/coload families never read it); on disk
  but unstaged is an `[untracked]` warning telling you to `git add` it. (#18)
- **`render` writes the github scaffolds only when the github module is enabled.**
  `.github/PULL_REQUEST_TEMPLATE.md` and `.github/workflows/pr-checks.yml` belong to that
  module; a repo that disabled it (no CI, direct-to-main) no longer receives them, and ones
  already on disk are left in place with one note. (#18)
- **`expandPaths` dedups**: a slot value repeating a literal rendered the glob twice
  (`tests/**` in the testing rule). (#19)
- **`/house-rules:sync` skill text** now runs the real `house doctor` verb (the CLI has had
  one since v0.1.1) and tells the operator to stage rendered files by path.

## [0.2.0] - 2026-08-24

### Changed
- **BREAKING (namespace):** renamed the package, marketplace, and plugin to `house-rules`. Skills are now `/house-rules:bootstrap`, `/house-rules:sync`, etc. The GitHub repo is `dubbl-a/house-rules` (redirects preserve old links). The per-repo artifacts are unchanged: `house.json`, `.house/`, and the `house-managed` marker keep their names. Adopted repos pick up the new command names on their next `/house-rules:sync`; re-install with `claude plugin marketplace add dubbl-a/house-rules` then `claude plugin install house-rules@house-rules --scope user`.

## [0.1.2] - 2026-08-24

### Fixed

- **Component drift now resolves a spelled-out `.astro` extension.** A backticked
  `Foo.astro` reference was never matched against the component basename set (the
  `.` broke the CamelCase test), so a renamed `Foo.astro` reference went silently
  stale. The checker now strips a trailing `.astro` before resolving. (#14)
- **`render --apply` removes orphaned managed files.** When a module's `paths:`
  narrow until they match nothing, the rule is skipped -- but a copy from a prior,
  broader render used to be left on disk (a stale rule had to be `git rm`-ed by
  hand). Render now deletes any file under `.claude/rules/house/` (and any managed
  dest from the prior lock) that is no longer in the plan, so the vendored tree,
  the lock, and the plan stay in exact agreement. (#12)

### Added

- **Load-bearing default paths are now overridable.** The docs rule's document set
  (`README.md`, `CLAUDE.md`, ...) and the engineering rule's code roots (`src/**`,
  ...) moved behind config slots (`$docFiles`, `$codeRoots`) whose default is the
  historical literals, so a consumer can scope them to resolve a co-load without
  any existing repo changing behavior. (#13)
- **Lower-severity suppression holes now surface instead of passing silently** (#11):
  the disabled-module deviation check warns when module defaults are unreachable
  (P8); an excluded doc that never carried a `docs-drift-ignore-file` opt-out warns
  in consumer repos (P9); the co-load budget now counts the repo's own non-house
  `.claude/rules/*.md` and treats an always-on (no-`paths:`) rule as loading for
  every path (P12); and a whole-file `docs-drift-ignore-file` opt-out with no reason
  warns (P13). Empty `componentSuffixes`/`classPrefixes` stay a deliberate,
  documented no-op (P11).

## [0.1.1] - 2026-08-24

### Fixed
- CLAUDE.md length is now measured as a **warning**, never a silent omission. A missing `CLAUDE.md` limit in `house.json` (which previously disabled the check entirely) now warns, and an over-limit CLAUDE.md warns without blocking the gate (it is not ratchet-eligible; a trim follow-up clears it). Closes the repo-d v0.1.0 gap where a 492-line CLAUDE.md passed with zero findings because no limit was configured.

### Added

- The repo checker now closes a failing report with the three ways to fix a finding (change the
  document, change the code, or record the exception with its reason), with a positive and a
  negative control in `tests/check/cli.test.mjs`.
- `house doctor` reports whether a rule-load positive control (an `InstructionsLoaded` hook) is
  wired, so a rule whose `paths:` glob never matches is distinguishable from one that does nothing.
- `npm run check:traceability` runs the traceability gate on its own, and `npm run verify` and CI
  now both run it. It was a correct tool nothing called.
- `docs/handbook/conventions.md` states the package's public surface and what a version bump
  promises, plus the missing-harness gap that `plugins/house/evals/` answers.
- `docs/handbook/github.md` records how far a user-scope branch guard reaches and which branch
  protection is actually real per repo; the hook's own header now carries the same reconciliation.
- `docs/handbook/upstreams.md` records the ai-rulez and Packmind borrows that were made and never
  written down.

### Updated

- `CLAUDE.md.skeleton`: worktree detection before creation, worktree naming and seeding, the
  long-running-job trigger, the skippable-preview list, the unaffected control surface in a
  preview, and one library per job with its escape condition.
- Rule files gained the clauses their inventory rows promised: a retired figure gated absent from
  every surface and zero false positives as necessary but not sufficient (engineering), the
  present-and-absent render check (engineering), an unconfirmed authoring marker and a
  mechanically checkable near miss (llm-output), per-project service pinning (claude-code).
