import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson } from './helpers.mjs';

// The guard family warns when branchPolicy "pr" has no repo-local guard the
// HOOK would defer to. "Reachable guard" must mean exactly what the hook
// means (plugins/house/hooks/no-direct-master.sh): a repo-local
// .claude/hooks/no-direct-master.sh, or a NON-EMPTY PreToolUse array in
// .claude/settings.json. settings.local.json is per-machine and gitignored, so
// it cannot be a repo guard; a hooks key alone, or PostToolUse only, is not a
// branch guard (F3 in tests/hooks/run.sh). Ultra review of v0.2.1 found three
// implementations of that rule disagreeing.
const PRE = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } };
const guardWarnings = (json) => (json.warnings || []).filter((w) => w.family === 'guard');

test('guard: a non-empty PreToolUse hook in .claude/settings.json is a reachable guard (no warning)', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(PRE) });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0);
  assert.equal(guardWarnings(json).length, 0, JSON.stringify(json.warnings));
});

test('guard: a SUBSTANTIVE repo-local .claude/hooks/no-direct-master.sh is a reachable guard (no warning)', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.claude/hooks/no-direct-master.sh': '#!/usr/bin/env bash\n# a real guard\nexit 2\n' });
  assert.equal(guardWarnings(run(dir, ['--only=guard', '--json']).json).length, 0);
});

// #27: the checker certified this file by bare existsSync, so a no-op stub
// reported the repo as guarded while simultaneously disarming the plugin hook
// -- protection reported, none enforced. The two must agree, and they now
// share this predicate.
test('guard: a no-op repo-local hook is NOT a reachable guard (warning, matching the hook)', () => {
  for (const body of ['', '#!/usr/bin/env bash\n', '#!/usr/bin/env bash\nexit 0\n', '#!/usr/bin/env bash\n# only comments\n\n', '   \n\texit 0\n']) {
    const dir = sandbox({ 'house.json': houseJson(), '.claude/hooks/no-direct-master.sh': body });
    const { code, json } = run(dir, ['--only=guard', '--json']);
    assert.equal(code, 0);
    assert.equal(guardWarnings(json).length, 1, `a stub hook (${JSON.stringify(body)}) must warn`);
  }
});

test('guard: a hooks key alone, PostToolUse only, or an empty PreToolUse array is NOT a guard (warning, matching the hook)', () => {
  for (const settings of [{ hooks: {} }, { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [] }] } }, { hooks: { PreToolUse: [] } }, { hooks: { PreToolUse: true } }]) {
    const dir = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(settings) });
    const { code, json } = run(dir, ['--only=guard', '--json']);
    assert.equal(code, 0);
    assert.equal(guardWarnings(json).length, 1, `${JSON.stringify(settings)} must warn`);
  }
});

test('guard: a PreToolUse hook only in settings.local.json does not count (the hook never reads it)', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.claude/settings.local.json': JSON.stringify(PRE) });
  const { json } = run(dir, ['--only=guard', '--json']);
  assert.equal(guardWarnings(json).length, 1, 'a per-machine file is not a repo guard');
});

test('guard: branchPolicy direct needs no guard (nothing reported)', () => {
  const dir = sandbox({ 'house.json': houseJson({ branchPolicy: 'direct', deviations: [{ kind: 'branch-policy', what: 'x', why: 'y', decided: '2026-08-25' }] }) });
  assert.equal(guardWarnings(run(dir, ['--only=guard', '--json']).json).length, 0);
});

// ADR 0009 (#32 item 2): a well-formed recorded plugin-guard choice is the
// third reachable guard. Only the checker reads it; the hook never treats it
// as a stand-down signal (pinned in tests/hooks/run.sh).
test('guard: a well-formed recorded plugin guard clears the warning', () => {
  const dir = sandbox({
    'house.json': houseJson({ guard: { by: 'plugin', decided: '2026-08-31', why: 'user-scope plugin supplies the hook; no vendored copy kept' } }),
  });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0);
  assert.equal(guardWarnings(json).length, 0, 'a recorded plugin guard must clear the warning');
});

test('guard: a malformed guard record does NOT clear the warning (positive controls)', () => {
  const bads = [
    { by: 'repo', decided: '2026-08-31', why: 'x' },
    { by: 'plugin', decided: '2026-8-31', why: 'x' },
    { by: 'plugin', decided: '2026-08-31', why: '' },
    { by: 'plugin', why: 'x' },
    { by: 'plugin', decided: '2026-08-31', why: 'x', note: 'y' },
    true,
  ];
  for (const guard of bads) {
    const dir = sandbox({ 'house.json': houseJson({ guard }) });
    const { json } = run(dir, ['--only=guard', '--json']);
    assert.equal(guardWarnings(json).length, 1, `${JSON.stringify(guard)} must still warn`);
  }
});
