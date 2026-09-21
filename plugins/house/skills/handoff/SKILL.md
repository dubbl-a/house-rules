---
name: handoff
description: Prints the session's handoff snapshot (SHA, tree state, shipped PRs, headline finding, next steps), opening a real issue only for next-cycle work and for anything deferred by decision. Use for "wrap up" or "handoff".
disable-model-invocation: true
---

# Handoff

Handoff prints a snapshot: the fixed-shape summary the next session reads first. It files
nothing for the snapshot itself, because the snapshot is re-derivable from the default branch,
merged PRs, and release notes, and a standing issue that only ever restates that is noise. It
opens an issue only for work someone will do: each next-cycle item becomes one, matched against
open issues first, and anything deferred by decision becomes an issue closed as not planned, with
the reason in it, because that reason is the one thing the next session cannot reconstruct.

The snapshot carries only what the next session cannot reconstruct on its own. Gate verdicts and
count tables are deliberately not in it: both re-run in seconds against the recorded SHA, and a
re-run number cannot be fabricated the way a copied one can.

This skill can open and close issues, so it never fires on its own. Run it only when asked, and
only at the point a session is actually ending.

## Default path

1. Gather the tree state: SHA, cleanliness, worktrees, open PRs.
2. List what shipped since the last release tag, or since session start if there is no tag.
3. State one headline finding, with the evidence for it.
4. Write the next-cycle list: ordered, concrete, each item with its reasoning.
5. For each next-cycle item, check open issues for one that already covers it; open a new issue
   only when none does, and record its number.
6. For anything deferred by decision, open an issue for it closed as not planned, with the reason
   in the issue. Never do this for something simply not done; that stays a next-cycle item or
   drops silently.
7. Legacy cleanup: if an open issue titled "Session carryover" exists, close it with a comment
   pointing to the issues its content was split into.
8. Print the snapshot in the reply: the staleness disclaimer, tree state, shipped, headline
   finding, next-cycle list with issue numbers, and deferred-by-decision items with issue numbers.

## Gather the tree state

Run these against the repo's default branch, not whatever branch the session happens to be on:

```
git rev-parse HEAD
git status --short
git worktree list
gh pr list --state open
```

Record the exact SHA, whether the tree is clean, how many worktrees exist, and how many PRs are
open. A vague "things are in a good state" is not tree state; the SHA is the fact that lets the
next session confirm nothing moved underneath it, and it is what every gate and count re-runs
against, which is why none of those results is filed anywhere.

## List what shipped

From the last release tag (or, if there is none, from the start of the session) to the current
HEAD, list every PR that merged, one line each: number and what it did. If nothing merged, write
"None" under this heading. Do not omit the heading because the list is empty; an absent section
reads as "nobody checked," not as "nothing shipped."

## State the headline finding

One finding, stated as a decision with the evidence behind it, not a summary of everything that
happened. If nothing this session rose to that bar, write "No headline finding this session"
rather than inflate a minor observation to fill the slot.

## Write the next-cycle list, and turn each item into an issue

An ordered list of concrete next actions, each with the one-line reasoning that motivates it.
"Start here" means the first item is genuinely where the next session should begin, not just the
first thing that comes to mind.

For each item, search open issues before opening a new one:

```
gh issue list --search "<item summary>" --state open
```

If an open issue already covers it, use that issue's number. Otherwise open one:

```
gh issue create --title "<item>" --body "<the one-line reasoning>"
```

An issue exists for work someone will do; a next-cycle item that never becomes one is a list in
prose that the next session has to trust instead of a tracker it can act on.

## Turn deferred-by-decision into a closed issue with the reason

Something this session chose not to do, on purpose, is not the same as something that simply did
not get to this session. Only the first kind gets an issue, and it is opened closed:

```
gh issue create --title "<item>" --body "Deferred by decision: <the reason>"
gh issue close <N> --reason "not planned"
```

The reason is the one line the next session cannot reconstruct on its own; a thing simply not
done needs no issue, since it is either still a next-cycle item or it was never a commitment.

## Legacy: retire an open carryover issue

If an issue titled "Session carryover" is still open from before this practice changed, close it
rather than leave it open forever:

```
gh issue list --search "Session carryover" --state open
gh issue close <N> --comment "Retired: split into <issue numbers from this handoff>."
```

Skip this step once no such issue remains.

## Print the snapshot

Open with the staleness disclaimer, verbatim in spirit: "Verify anything here before relying on
it, this is a snapshot and the repo moves." Then, in order: tree state, shipped PRs, headline
finding, next-cycle list with each item's issue number, deferred-by-decision items with each
issue's number. Print this in the reply; it is never filed.

## Escape hatches

- **No `gh` CLI, or it is not authenticated.** Print the snapshot and the next-cycle and
  deferred-by-decision items anyway, say that no issue could be opened, and let the person file
  them by hand.
- **Nothing shipped, no headline finding, no next-cycle items, or nothing deferred by decision.**
  Say so plainly in that section rather than leaving it out or padding it.

## Don't

- Don't run this on its own. It can open and close issues and fires only on request.
- Don't copy a gate verdict or a counts table into the snapshot; they re-run from the recorded
  SHA, and a reader trusts the re-run, not the copy.
- Don't open an issue for a next-cycle item without checking for one that already covers it.
- Don't open an issue for something simply not done; that is not the same as deferred by decision.
- Don't skip the staleness disclaimer because the session feels current; the next reader has no
  way to know that without it stated.
- Don't pad a missing headline finding or an empty shipped list to make the snapshot look more
  substantial than the session was.
- Don't leave a "Session carryover" issue open once this handoff has run.
