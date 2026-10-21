---
name: trim-memory
description: Shrinks an auto-memory index (MEMORY.md) without losing a fact or making a memory unreachable, by moving whole lines for closed topics into an overflow index; triggers on Claude Code's reminder to shorten MEMORY.md, the `check.mjs --only=lengths` memory-index warning, and "trim the memory index".
---

# Trim memory

The auto-memory index loads every session and the harness drops whatever passes its ceiling, so a
long index loses entries silently. Rewording lines to save space is risky in the other direction: a
cue stripped of the words a future prompt would mention never gets its file opened. This skill
runs without a review step, so it never rewords a line. It only adds lines and moves whole lines,
word for word, so every edit is lossless and checkable, and it takes a backup first.

## Default path

1. Find the index: the memory directory this session was given, else
   `<config dir>/projects/<project>/memory/MEMORY.md`, where `<project>` is the main checkout's
   path even from a worktree. With no `MEMORY.md`, say so and stop. "The index" below means
   `MEMORY.md` plus `memory-index-overflow.md` when that file exists. Copy both into
   `<memory dir>/.backup/<ISO date and time>/` before any edit, and never overwrite an existing
   backup. Nothing under `.backup/` is ever indexed.
2. Read the warn level, `MEMORY_INDEX_WARN_LINES` and `MEMORY_INDEX_WARN_BYTES`, and the cue
   length, `MEMORY_INDEX_MAX_LINE_CHARS`, from `.house/check.mjs`, else
   `${CLAUDE_PLUGIN_ROOT}/payload/check.mjs`.
3. Repair by adding only, at the end of `MEMORY.md` so no existing line moves toward the load
   ceiling: for a link that does not resolve and has one unambiguous target, add a corrected line
   unless the index already links that target; add a line for each topic file the index omits. A
   file linked from the overflow file is not omitted.
4. Only while `MEMORY.md` is over the warn level, move whole lines, unchanged, into
   `memory-index-overflow.md` (with its own frontmatter). Move a line only when its topic file,
   read in full, says the topic is closed or superseded and carries no warning or rule still in
   force; when in doubt, keep it. Take feedback, user, and reference entries last. Keep one line
   in `MEMORY.md` linking the overflow file, with a cue naming when to open it. If no line
   qualifies, stop over the warn level and say so.
5. Self-check before finishing: every line of the backed-up index appears unchanged in
   `MEMORY.md` or the overflow file; `MEMORY.md` links the overflow file whenever it exists; and
   every added link resolves. If any check fails, restore the backup, delete an overflow file this
   run created, and report the failure.
6. Report in a few skimmable lines, never a list to approve: lines and bytes before and after,
   "nothing removed or reworded", the backup path, any check that failed, whether the index is
   still over the warn level, the name of each entry moved to overflow, and any line still longer
   than `MEMORY_INDEX_MAX_LINE_CHARS`, left for a person to shorten. Then run the checker from step 2 with `--only=lengths`.

## Don't

- Don't reword, shorten, or delete an index line; a line leaves `MEMORY.md` only, unchanged, into the overflow file.
- Don't delete a topic file, or move one out of the memory directory.
- Don't move a line on its index text alone; its topic file decides whether the topic is closed.
- Don't ask the person to approve or read a list; the backup and the self-check are the safety.
- Don't raise a ceiling or a threshold to make the warning go away.

Principles (never auto-delete, read content before deciding, keep feedback, user, and reference
entries) credit the memory-prune skill, https://github.com/frankxai/claude-skills-library, MIT.
