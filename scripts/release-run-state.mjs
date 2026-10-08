#!/usr/bin/env node
// release-run-state.mjs: classify the GitHub Actions runs on one commit for
// the release workflow's adopter-sync wait. Reads the JSON of
// GET /repos/{owner}/{repo}/actions/runs?head_sha=<sha> on stdin and prints
// one of: none | pending | fail | green.
//
//   none     no run registered for the commit
//   fail     a completed run did not end success, skipped, or neutral
//   pending  no run failed, but one has not completed
//   green    every run completed success, skipped, or neutral
//
// Exit 1, printing nothing, when stdin is not an actions-runs response.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PASSING = new Set(['success', 'skipped', 'neutral']);

export function classifyRuns(body) {
  const runs = body && body.workflow_runs;
  if (!Array.isArray(runs)) throw new Error('no workflow_runs array');
  if (runs.length === 0) return 'none';
  if (runs.some((r) => r.status === 'completed' && !PASSING.has(r.conclusion))) return 'fail';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  return 'green';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(classifyRuns(JSON.parse(readFileSync(0, 'utf8'))));
  } catch (e) {
    console.error(`release-run-state: ${e.message}`);
    process.exit(1);
  }
}
