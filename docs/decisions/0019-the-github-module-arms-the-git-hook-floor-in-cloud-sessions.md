---
status: accepted
date: 2026-10-22
---

# The github module arms the git-hook floor in cloud sessions through a committed SessionStart hook

> Narrows the claude-code rule "Keep the committed settings narrow and the local settings local":
> render and sync have never written the committed `.claude/settings.json`, and after the build
> this decision calls for, they write one house-owned entry in it and nothing else.

## Context and problem statement

The git-hook floor (ADR 0013) is the enforcement behind the branch policy, and
`plugins/house/hooks/arm-git-hooks.sh` is what arms it: `core.hooksPath` is machine state, so
every fresh clone starts unarmed, and the plugin's SessionStart hook arms it when a session
opens. A Claude Code cloud session installs no plugin, so that hook never runs there. The floor
stays unarmed and nothing local stops a push to the protected branch (#351). Four private
adopters on a Free GitHub plan have no remote branch protection either, so in their cloud
sessions nothing at all stands between the agent and the protected branch.

The route is open. A real cloud session on Claude Code 2.1.308 on 2026-10-22 showed that hooks in
the repo's committed `.claude/settings.json` do run: a SessionStart hook ran and its stdout
reached context, and a PreToolUse hook blocked a command with exit 2
([evidence](https://github.com/dubbl-a/house-rules/issues/351#issuecomment-6333225089)). The
harness survey agrees that a cloud session reads the shared project settings because they are
part of the clone (`docs/handbook/sources/harness-survey.md`, "Settings reach into cloud
sessions"). What is missing is anything that writes such a hook into an adopter's repo: render
never writes the committed settings file, and the arming script lives only in the plugin, so it
is not in the clone.

## Decision drivers

* ADR 0013: enforcement is the git-hook floor, not command text, and a floor that is never armed
  enforces nothing.
* A repo with no remote protection has no other ceiling, and a Free private repo cannot get one.
* A committed hook runs code for anyone who opens the repo, outside any sandbox, and in print or
  SDK mode with no approval prompt. The claude-code and security rules treat a change to agent
  config as code to review ("Review a change to agent config as code, and keep a second party on
  every consequential action"). Whatever runs must be small, vendored and tamper-checked.
* One implementation of the arming logic, so the plugin, the cloud and `house doctor` cannot
  disagree about what armed means.
* The adopter's own settings stay the adopter's: house must not edit what it did not write.

## Considered options

* **Do nothing.** The remote is the ceiling.
* **A paid GitHub plan for branch protection.**
* **Server-managed settings** that carry the hook to cloud sessions.
* **A PreToolUse guard in the committed settings**, as the plugin has.
* **One house-owned SessionStart entry in the committed settings that runs a vendored copy of the
  arming script.**

## Decision outcome

Chosen option: "one house-owned SessionStart entry that runs a vendored copy of the arming
script", because it is the only option that arms the floor in the session where the plugin is
absent, needs nothing from the adopter's plan or organization, and puts no new decision logic in
a place the adopter reads as their own.

The build will do the following.

* **The entry.** The github module renders one SessionStart hook entry into the adopter's
  committed `.claude/settings.json`. It runs the arming script through
  `$CLAUDE_PROJECT_DIR/scripts/house/arm-git-hooks.sh`.
* **The script.** The build vendors a copy of the plugin's arming script as a managed file of the
  github module, in the module's `files` list beside the other `scripts/house/` entries. The
  tamper check (`npm run check:house`) therefore covers it, and one implementation serves both
  the plugin and the cloud.
* **What house owns.** Only that entry, identified by its exact command string. House never
  adds, edits or removes any other key or hook, and it preserves the rest of the file's content.
  If the file is absent, render creates it holding only that entry.
* **Opt out.** An optional key in the github module's config turns the entry off. Its name is
  chosen at build time; `cloudArming: false` is the working name. With the key set, render
  removes its own entry and leaves everything else.
* **No PreToolUse guard.** The committed settings carry no guard. The floor is the enforcement,
  and the text guard needs the plugin's libraries and is not a boundary (ADR 0013).
* **Locally, with the plugin on.** The committed hook runs alongside the plugin's own arming
  hook. Arming is idempotent, so a double run is harmless. A project hook runs on a local
  machine only once the checkout is trusted, so the committed entry is a second route there and
  the first one only in the cloud.

### Security

A committed hook runs code for anyone who opens the repo, unsandboxed, and in print or SDK mode
without a prompt. That is accepted here because the entry runs one vendored, tamper-checked house
script, and that script only sets `core.hooksPath` to the repo's own `.githooks`. It never
overwrites a hooksPath someone else set and never arms a repo whose `.git/hooks` already holds a
foreign hook. The entry is also reviewable in a pull request, as the rule asks, and the opt-out
removes it.

### Release class

A new optional schema key and new rendered content is the minor class under ADR 0011, and below
1.0 ADR 0012 spends that slot as a patch. The entry reaches an adopter only through a sync, and
the sync is on hold for the current release (#399), so no adopter changes until that hold
clears.

### Consequences

* Good, because a cloud session arms the floor on open, with no plugin, no paid plan and no
  organization.
* Good, because one script serves the plugin and the cloud, and the tamper check covers the
  cloud copy.
* Good, because the adopter's other settings are untouched and an opt-out is one key.
* Bad, because the committed settings file is no longer wholly the adopter's: one entry in it is
  house's, and render rewrites it back if it drifts.
* Bad, because a hook that arms the floor is an unsandboxed command run on open in every
  session type, which is the surface the security rule warns about, held down to one script.
* Bad, because the committed entry does nothing against an agent that disarms the floor after it
  is armed. That limit is ADR 0013's, not new.

### Follow-up when the build lands

The claude-code rule "Keep the committed settings narrow and the local settings local" and its
Anchor say render never writes the committed settings file and sync does not manage it. Both
change in the build's pull request, and so does the `plugins/house/templates/settings.json` note
that its copy has no hooks block. This record does not edit them; until the build lands they
are still true.

### Confirmation

The build adds a render test that writes the entry into an absent file, into a file with other
keys and hooks (which stay byte for byte), and removes it under the opt-out, and a tamper test on
the vendored script. The cloud behavior itself is confirmed by the 2026-10-22 evidence above; the
build repeats that probe once against the rendered entry in a cloud session.

## Pros and cons of the options

### Do nothing

* Good, because nothing changes and nothing new runs on open.
* Bad, because the cloud session stays unarmed (#351), and a Free private repo has no remote
  protection to fall back on.

### A paid GitHub plan for branch protection

* Good, because it is the strongest ceiling: the remote refuses the push whatever runs locally.
* Bad, because it costs money and is the maintainer's call, not the package's.
* Not exclusive with the chosen option: the remote ceiling and the local floor stack.

### Server-managed settings

* Good, because a managed hook binds in every session and a project cannot override it.
* Bad, because the harness survey confirms that server-managed settings reach a cloud session
  but does not say which plans offer them. That it needs an organization plan is **unverified**
  here. If true, the adopters this serves, private repos on a Free plan, cannot use it.

### A PreToolUse guard in the committed settings

* Good, because it would refuse a command before it runs, as the plugin's guard does.
* Bad, because the guard needs the plugin's libraries, which are not in the clone, and a text
  guard is not a boundary (ADR 0013). A copy would add a second guard to maintain for no extra
  enforcement over the floor.

### One house-owned SessionStart entry running a vendored arming script

* Good, because it closes the gap with no dependency on plan, organization or plugin.
* Good, because the logic is one script that the tamper check watches.
* Bad, because house now writes into a file it never wrote, which needs the narrow ownership
  rule above to stay safe.

## More information

The issue and its proof are #351. The claude-code rule is
`plugins/house/modules/claude-code/rules/claude-code.md`. The version arithmetic is ADR 0011 and
ADR 0012; the branch floor is ADR 0013.
