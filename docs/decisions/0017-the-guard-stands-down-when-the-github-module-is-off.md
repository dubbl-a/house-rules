---
status: accepted
date: 2026-10-03
---

# The guard stands down when the github module is off

## Context and problem statement

`house disable github` (#151) removes the vendored git-hook floor, but the PreToolUse hook
(`plugins/house/hooks/no-direct-master.sh`) never read module state. It followed the branch policy
in the committed `house.json` and judged the floor from the files on disk, so once the module was
off it kept refusing commits and pushes on a protected branch, switched to its stricter unarmed
rules because the floor was gone, and told the user to arm a floor they had just removed (#159). A
repo that asked for less protection got a louder guard.

## Decision drivers

* Turning the github module off is a choice the repo owner makes; the guard should quiet the rules
  that exist to enforce that module's branch policy, and stop giving advice about its floor.
* ADR 0013's second adversarial round closed one specific hole: a feature branch whose committed
  policy said `direct` switched the disable list off, because the policy gate ran first. Nothing
  here may reopen it.
* Default on and fail closed, as everywhere else in the package: only an explicit, readable
  "off" counts.
* No second way to turn the guard off: no environment variable, no flag, no working-tree switch.

## Considered options

* **A. Read the switch from a trusted ref that moves only at a merge**, such as the remote's
  default branch as recorded locally (`refs/remotes/origin/HEAD` and the ref it names).
* **B. Require agreement**: stand down only when every one of a fixed set of refs says off, for
  example the remote-tracking default branch and each local protected branch.
* **C. Read the switch from the same `house.json` the policy is read from, and stand down only the
  rules `branchPolicy: direct` already stands down**, keeping the disable list and the
  named-repository rules in every adopted repo.

## Decision outcome

Chosen option: "C: the same blob as the policy, the same stand-down as `direct`", because a probe
showed neither A nor B can be trusted to move only at a merge, and C quiets everything the issue
names while keeping the off switch for the floor itself where ADR 0013 put it.

The switch is `modules.github.enabled` in the `house.json` the hook already reads its policy from:
`git --no-replace-objects show HEAD:house.json`, or the working-tree file only when HEAD carries
none. It is read in the same jq pass as the policy, as that pass's first field and a fixed token,
so no value in the file can set it. Only the JSON literal `false` turns the module off. A missing
`modules`, a missing `github`, a missing `enabled`, the string `"false"`, `0`, `null`, or a
`modules` of the wrong shape leave it on. A `house.json` that does not parse is refused as before,
and so, now, is one holding more than one JSON document, or a policy, protected-branch or carve-out
string holding a control character: the pass separates its fields with a record-separator line, and
a string carrying that separator or a newline used to move a value into a later field (a
`protectedBranches` entry of `"\u001e"` followed by `"*"` made every path a carve-out, and a
`branchPolicy` of `"pr\ndirect"` read as `direct`, both before this record). jq is already required:
without it the hook refuses every call before reading anything, so the switch is never read.

Rule by rule, with the module off:

* **Stands down**: the commit refusal on a protected branch; the push and `send-pack` refusals;
  the unarmed history refusals (merge, rebase, cherry-pick, revert, am, commit-tree) and the
  unreadable-verb refusal; the floor's integrity check for this candidate and every piece of
  arming advice. The hook is quiet: no advice and no notice per call. An alias whose body is a
  plain push stands down like a typed push. A `send-pack` from a feature branch that has the
  module committed off is allowed and lands even with the floor armed, since no git hook runs for
  it.
* **Keeps running (section A, the disable list)**: `--no-verify` and `-n` on a commit,
  `core.hooksPath`, `include.path` and `includeIf`, git config through the environment,
  `HUSKY=0` and `LEFTHOOK=0`, a mutation of `.githooks/`, the ref-writing plumbing, `git replace`
  and any `refs/replace/` write, each typed in the command, in the body of a configured alias the
  command runs, or in the body of an alias the command defines with `-c alias.<name>=<body>`
  (read whether or not it is invoked, any case of the key); and a `!shell` alias, configured or
  inline, refused outright because its body is a script. An inline body the shell computes is
  refused as unreadable. The alias read goes one level only: a body that calls another alias is
  not followed. It is part of A and runs before the policy gate, in every floor state. None of
  these refusals carries arming advice.
* **Keeps running (the file-tool rule)**: an Edit or Write under `.githooks/`, under the git
  directory, or to git's per-user config.
* **Keeps running (section D)**: a branch-moving command aimed at a repository it names rather
  than enters.
* **Keeps running (section E)**: creating a branch in the main checkout. It is the claude-code
  module's rule ("Treat git state as shared across sessions"), a workspace rule rather than part of
  the github module.
* **Unchanged**: `house.json` itself stays editable by the file tools, as before; an edit counts
  once it is committed.

This is the same stand-down `branchPolicy: direct` gets, made in the same function, with one
difference: `direct` returns at the policy gate and so also stands section E down, while the
github switch is taken after section E so that E keeps running.

The first version of this change took the stand-down before the alias read, which until then ran
only inside the branch refusals of an armed checkout, so with the module off an alias carrying
`--no-verify`, a hooks-path change, a protected-ref delete or a shell script ran unread: a review
replayed `git pn origin feat:master` (`pn = push --no-verify`) and the push landed. `direct` had
the same gap since the alias read sat behind its gate too. Moving the alias read into A, before the
policy gate, closed both. A second review found the read covered only configured aliases: `git -c
alias.z='update-ref refs/heads/master HEAD' z` defined and ran its own, which `main` refused with
the module off and no floor and the first rework allowed. The inline definition is now read from
the command as typed, before any strip removes the `-c` value.

### Consequences

What loosens, for a repo whose committed `house.json` turns the github module off: the commit,
push, `send-pack`, history and unreadable-verb refusals, and every piece of arming advice.

What tightens, and for whom:

* A repo on `branchPolicy: direct`, or one deferring to its own guard: a configured alias whose
  body carries a disable literal or protected-ref plumbing, and any `!shell` alias, are now
  refused, where `main` let both through. A `direct` adopter's ordinary shell alias, such as
  `up = !git fetch && git rebase`, now meets a false deny; the hook's message names the way out,
  "Run the commands it stands for directly."
* Every adopted repo: an alias defined inline with `-c alias.<name>=<body>` whose body carries a
  disable literal or protected-ref plumbing, an inline `!shell` alias, and an inline body the shell
  computes are refused, whether or not the command invokes the alias. `main` refused these only
  where an unarmed floor refused every unknown verb.
* Every adopted repo: a `house.json` holding a control character in `branchPolicy`,
  `protectedBranches` or `carveOuts`, one holding two concatenated JSON documents, and one that is
  whitespace only are refused as unreadable, where `main` read each as adopted and enforcing.

Class under ADR 0012: tightening what the branch guard denies is the breaking class, so this change
takes the minor below 1.0, though most of it loosens.

* Good, because a repo that turns the github module off no longer gets refusals for the policy it
  turned off, nor advice to arm a floor it removed.
* Good, because the disable list still runs before the policy gate, so the ordering ADR 0013 fixed
  holds. In an armed repo whose feature branch commits the module off, every spelling the
  disable list reads, typed or in an alias body, is still refused, so `core.hooksPath` and
  `.githooks/` stay as they are by those routes, and the floor's `pre-push` still reads the target
  branch's own `house.json` when the session pushes. ADR 0013's residue (a wildcard that never
  spells `.githooks`, a git command inside a script) is unchanged.
* Bad, because the switch is read from HEAD like the policy, so it counts as soon as it is
  committed on whatever commit is checked out, a feature branch or a detached HEAD included, not
  only once it is merged; and an unborn HEAD, or one with no `house.json`, reads the working-tree
  file, the same fallback `direct` has. That is why A, B, D and E stay; the remote's branch
  protection is the ceiling, as ADR 0013 says.
* Bad, because a repo with the module off still has `--no-verify` and `core.hooksPath` writes
  refused, and the file-tool refusals still suggest `house render --apply`, which restores
  nothing while the module is off.
* Bad, because the alias read stays one level deep: a body that calls another alias, and an
  inline `-c` whose KEY the shell computes (`-c "$k=$v"`), are not read, since refusing a computed
  `-c` would also refuse `git switch -c "$branch"`. The floor covers what it can see of both.

### Confirmation

`tests/hooks/run.sh` pins both directions. With the module off at HEAD and no floor files, a
commit on the protected branch, a push onto it (from it and from a feature branch) and a merge on
it are allowed with no output; unsetting the hooks path, an `rm` of `.githooks`, an Edit under
`.githooks/` and `--no-verify` are still refused with no arming advice; section E still refuses. In
an armed repo whose feature branch commits the module off, unsetting the hooks path is refused.
The string `"false"`, `null`, `0`, a missing `enabled`, a missing `github`, a `modules` that is not
an object, `true`, and a malformed `house.json` all still refuse a commit and a push, and so does a
module turned off only in the working tree, including a staged commit that would carry that edit
onto the protected branch. Alias bodies carrying a hooks-path change, a protected-branch delete, a
protected-ref write, `--no-verify`, or a shell script are refused with the module off (no floor,
and armed) and under `direct` (armed); a plain-push alias is allowed with the module off. A
separator in `carveOuts` or `protectedBranches`, a string with embedded newlines, a second JSON
document, and a multi-line `branchPolicy` each leave a commit on the protected branch refused. An
inline alias (`-c alias.z=...`, quoted whole, an upper-case or mixed-case key, a shell body,
defined but not invoked, a computed body) is refused with the module off in all three floor states,
under `direct`, and in a deferring repo, and `git -c alias.s=status s` is allowed in each.

## Pros and cons of the options

### A. A trusted ref that moves only at a merge

* Good, because in principle it would make the switch take effect only after review.
* Bad, because no local ref moves only at a merge. A probe on 2026-10-03, with the guard on and the
  floor armed, showed `git remote set-head origin <feature>` (and the matching `symbolic-ref`)
  repoints `origin/HEAD` in one allowed call, and `git fetch origin <feature>:refs/remotes/origin/main`
  rewrites the remote-tracking ref in one more, since the floor's `reference-transaction` hook
  ignores transactions that touch no `refs/heads/`. A `remote.origin.url` change does the same.
  Those moves are filed as #161.

### B. Agreement between refs

* Good, because moving one ref would not be enough.
* Bad, because the same probe moved both: the forged remote-tracking ref above, then
  `git fetch . <feature>:main`, which the floor accepts because the commit now looks as though the
  remote has it. If the protected list is read from the remote blob, the session wrote that list
  too. Closing these needs text scans of fetch refspecs, `remote set-head` and `remote.*.url`,
  which is the open-ended class ADR 0013 declined.

### C. The same blob as the policy, the same stand-down as `direct`

* Good, because it is one more condition on a path that already exists, so the two switches
  cannot drift apart.
* Good, because it keeps every way of turning the floor off that the disable list reads refused,
  alias bodies included, which is the part a feature-branch commit could otherwise exploit.
* Bad, because it does not wait for a merge, which is stated above rather than hidden.

## More information

This record supersedes nothing. It extends [0013](0013-branch-policy-enforced-by-git-hooks-not-command-text.md),
whose second-round item (the disable list running before the policy gate) is the reason the
disable list stays, and it keeps [0002](0002-hook-fails-open-without-a-manifest.md)'s fail-open
gates unchanged. [0012](0012-below-one-spend-the-minor-on-the-breaking-class.md) classes the
change.

Receipts: #159, the problem and the requirement; #151, `house disable github`; #161, the
remote-tracking ref moves that ruled out options A and B.
