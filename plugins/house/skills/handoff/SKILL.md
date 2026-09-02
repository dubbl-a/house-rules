---
name: handoff
description: Writes a session-carryover issue that supersedes and closes the last one, with SHA, tree state, shipped PRs, headline finding, next steps. Use for "wrap up" or "carryover issue".
disable-model-invocation: true
---

# Handoff

Handoff writes a session-carryover issue: the fixed-shape record the next session reads first.
It supersedes the previous carryover issue and closes it, so exactly one carryover is open at any
time and the chain of closed issues still lets anyone diff state over time through the
supersession pointers. It never edits history.

The issue carries only what the next session cannot reconstruct on its own. Gate verdicts and
count tables are deliberately not in the form: both re-run in seconds against the recorded SHA,
and a re-run number cannot be fabricated the way a copied one can.

This skill has side effects (it opens one GitHub issue and closes another), so it never fires on
its own. Run it only when asked, and only at the point a session is actually ending.

## Default path

1. Find the previous carryover issue, if one exists.
2. Gather the tree state: SHA, cleanliness, worktrees, open PRs.
3. List what shipped since the previous carryover issue.
4. State one headline finding, with the evidence for it.
5. Write the next-cycle list: ordered, concrete, each item with its reasoning.
6. Split what was skipped into deferred-by-decision and simply-not-done. Never merge them.
7. Assemble and open the issue, then close the one it supersedes with a pointer comment. No labels.
8. Report the new issue's number and URL back to the person who asked for this.

## Find the previous carryover issue

Search for it before writing anything:

```
gh issue list --search "Session carryover" --state all --limit 5
```

Take the most recent by number, not by title date (a title can be wrong; the issue number
cannot). If none exists, this is the first carryover issue for this repo. Say so, and skip the
supersession line in step 7 rather than inventing a predecessor.

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
against, which is why none of those results is copied into the issue.

## List what shipped

From the previous carryover issue's SHA (or, if there is none, from the start of the session) to
the current HEAD, list every PR that merged, one line each: number and what it did. If nothing
merged, write "None" under this heading. Do not omit the heading because the list is empty; an
absent section reads as "nobody checked," not as "nothing shipped."

## State the headline finding

One finding, stated as a decision with the evidence behind it, not a summary of everything that
happened. If nothing this session rose to that bar, write "No headline finding this session"
rather than inflate a minor observation to fill the slot.

## Write the next-cycle list

An ordered list of concrete next actions, each with the one-line reasoning that motivates it.
"Start here" means the first item is genuinely where the next session should begin, not just the
first thing that comes to mind.

## Split deferred-by-decision from simply-not-done

Two lists, never one:

- **Deferred by decision**: things this session chose not to do, with the reason for choosing
  that. A choice made on purpose is worth naming so nobody re-litigates it by accident.
- **Not done**: things that simply did not get to this session, no reason beyond running out of
  time or scope. Naming these honestly is what makes "deferred by decision" trustworthy; if
  everything skipped gets filed as a deliberate choice, the label stops meaning anything.

## Assemble the issue, open it, close its predecessor

Title: `Session carryover <date>: <one-line state>`, using the current date and a state summary
short enough to read in a GitHub issue list.

Body opens with the staleness disclaimer, verbatim in spirit: "Supersedes #<N>. Verify anything
here before relying on it, this is a snapshot and the repo moves." (Omit the supersession
sentence only when step 1 found no predecessor.) Then, in order: tree state, shipped PRs,
headline finding, next-cycle list, deferred-by-decision and not-done.

Open it with `gh issue create`, no labels. Then close the previous carryover issue with a comment
naming its successor:

```
gh issue close <N> --comment "Superseded by #<new>."
```

Closing on supersession is what keeps the open-issue list meaning "work someone still has to do":
a superseded snapshot is done being current, and the pointer comment plus the new issue's
"Supersedes #<N>" line keep the chain walkable in both directions. The explicit close is also the
only mechanism that works here: a closing keyword in an issue body does nothing on GitHub, and
the comment timestamps the supersession where a keyword never would.

## Escape hatches

- **No `gh` CLI, or it is not authenticated.** Do not fabricate an issue number or a URL. Print
  the fully assembled body to the terminal instead, say why, and let the person file it by hand;
  the predecessor then also stays open for them to close.
- **No previous carryover issue.** Skip the supersession sentence and the close step; everything
  else in the shape still applies to a first carryover issue.
- **The predecessor is already closed.** Say so and move on; do not reopen it to re-close it.
- **Nothing shipped, no headline finding, or nothing deferred by decision.** Say so plainly in
  that section rather than leaving it out or padding it.

## Don't

- Don't run this on its own. It has side effects and fires only on request.
- Don't copy a gate verdict or a counts table into the issue; they re-run from the recorded SHA,
  and a reader trusts the re-run, not the copy.
- Don't merge deferred-by-decision and not-done into one list.
- Don't leave the superseded issue open, and don't expect a closing keyword in the new issue's
  body to close it (issue bodies close nothing on GitHub); close it with the pointer comment
  after the new issue exists.
- Don't add labels to the new issue.
- Don't skip the staleness disclaimer because the session feels current; the next reader has no
  way to know that without it stated.
- Don't pad a missing headline finding or an empty shipped list to make the issue look more
  substantial than the session was.
