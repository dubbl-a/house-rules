#!/usr/bin/env node
// release-hold.mjs: decide whether the release workflow holds the adopter
// sync. Reads the JSON of GET /repos/{owner}/{repo}/commits/{sha}/pulls on
// stdin; argv is the pushed commit's sha and the label name. Prints one of:
// hold | sync | unread.
//
//   hold    a pull request merged as exactly this commit carries the label
//   sync    such a pull request is found and does not carry the label
//   unread  no pull request merged as this commit is found
//
// A squash merge makes one new commit on main, and the pull request records
// it as merge_commit_sha, so the match is on the merge commit, not on a PR
// that merely contains the commit. Unread fails closed: right after a merge
// the list can still be empty, and the workflow holds the sync rather than
// run it on a guess. Exit 1, printing nothing, when stdin is
// not a pulls response or an argument is missing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function holdVerdict(body, sha, label) {
  if (!Array.isArray(body)) throw new Error('not a pulls array');
  if (!sha || !label) throw new Error('usage: release-hold.mjs <sha> <label>');
  const merged = body.filter((pr) => pr.merged_at && pr.merge_commit_sha === sha);
  if (merged.length === 0) return 'unread';
  const held = merged.some((pr) => Array.isArray(pr.labels) && pr.labels.some((l) => l.name === label));
  return held ? 'hold' : 'sync';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(holdVerdict(JSON.parse(readFileSync(0, 'utf8')), process.argv[2], process.argv[3]));
  } catch (e) {
    console.error(`release-hold: ${e.message}`);
    process.exit(1);
  }
}
