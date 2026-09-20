import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sandbox, run, houseJson, CHECK_SRC } from './helpers.mjs';

// The guard family warns when branchPolicy "pr" has no repo-local guard the
// HOOK would defer to. "Reachable guard" must mean exactly what the hook
// means (plugins/house/hooks/no-direct-master.sh): a repo-local
// .claude/hooks/no-direct-master.sh, or a NON-EMPTY PreToolUse array in
// .claude/settings.json. settings.local.json is per-machine and gitignored, so
// it cannot be a repo guard; a hooks key alone, or PostToolUse only, is not a
// branch guard (F3 in tests/hooks/run.sh). Ultra review of v0.2.1 found three
// implementations of that rule disagreeing.
const PRE = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } };
// The family reports two independent things: the session-time verdicts above
// (kind "guard") and the git-hook floor (kind "floor", #58 / ADR 0013). Each
// case below pins one of them, so they filter by kind; a test that counted
// every guard-family entry would go green or red on the other half.
const guardWarnings = (json) => (json.warnings || []).filter((w) => w.family === 'guard' && w.kind === 'guard');
const floorWarnings = (json) => (json.warnings || []).filter((w) => w.family === 'guard' && w.kind === 'floor');
const floorFindings = (json) => (json.findings || []).filter((f) => f.family === 'guard' && f.kind === 'floor');

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

// 2026-09-20 audit: the one CONFLICT claim, downgraded to a narrow bug. A
// PreToolUse entry whose matcher names other tools cannot see a git command,
// so certifying it reported protection the repo did not have. The predicate
// now reads the matcher, the same way the hook does.
test('guard: a PreToolUse entry whose matcher cannot match Bash is NOT a guard (warning, matching the hook)', () => {
  for (const matcher of ['Edit|Write', 'Edit', 'Read', 'mcp__.*', 'bash', '(']) {
    const settings = { hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: 'x' }] }] } };
    const dir = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(settings) });
    const { code, json } = run(dir, ['--only=guard', '--json']);
    assert.equal(code, 0);
    assert.equal(guardWarnings(json).length, 1, `matcher ${JSON.stringify(matcher)} must warn`);
  }
  const noHooks = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } };
  const dir = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(noHooks) });
  assert.equal(guardWarnings(run(dir, ['--only=guard', '--json']).json).length, 1, 'an entry with an empty hooks array must warn');
});

test('guard: a PreToolUse entry whose matcher covers Bash IS a guard, whatever else it also matches (no warning)', () => {
  for (const entry of [{ matcher: 'Bash|Edit' }, { matcher: '.*' }, { matcher: '' }, { matcher: '*' }, {}, { matcher: 'Ba.h' }]) {
    const settings = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'y' }] }, { ...entry, hooks: [{ type: 'command', command: 'x' }] }] } };
    const dir = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(settings) });
    assert.equal(guardWarnings(run(dir, ['--only=guard', '--json']).json).length, 0, `${JSON.stringify(entry)} must count`);
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

// ── the git-hook floor (#58, ADR 0013) ───────────────────────────────────
//
// The text scan above only sees what a model typed in a session. The floor is
// the vendored `.githooks/` set, which git runs whoever is driving, so the
// family checks that the repo carries it: all seven files, executable in the
// INDEX (a clone gets the index mode, and writeFileSync would give 100644),
// and none of them a stub. Whether this clone is ARMED (core.hooksPath) is
// machine state and belongs to `house doctor` (ADR 0008), so nothing here
// touches git config, and the same commit checks the same on every machine.
const FLOOR_FILES = [
  '.githooks/house-lib.sh',
  '.githooks/pre-commit',
  '.githooks/pre-commit.d/10-house-branch',
  '.githooks/pre-push',
  '.githooks/pre-push.d/10-house-branch',
  '.githooks/reference-transaction',
  '.githooks/reference-transaction.d/10-house-branch',
];
const FLOOR_BODY = '#!/usr/bin/env bash\nset -eu\n. "$(dirname "$0")/house-lib.sh"\nhouse_refuse pre-commit "this branch needs a PR"\n';

/** A rendered floor: `{files, modes}` for sandbox(), with per-test damage. */
function floor({ omit = [], bodies = {}, modes = {} } = {}) {
  const files = {};
  const fileModes = {};
  for (const p of FLOOR_FILES) {
    if (omit.includes(p)) continue;
    files[p] = bodies[p] ?? FLOOR_BODY;
    fileModes[p] = modes[p] ?? 0o755;
  }
  return { files, modes: fileModes };
}

function floorSandbox(house, damage) {
  const { files, modes } = floor(damage);
  return sandbox({ 'house.json': house, ...files }, { modes });
}

test('guard floor: all seven files vendored, 100755 and substantive is silent', () => {
  const dir = floorSandbox(houseJson());
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0);
  assert.equal(floorFindings(json).length, 0, JSON.stringify(json.findings));
  assert.equal(floorWarnings(json).length, 0, JSON.stringify(json.warnings));
});

test('guard floor: a repo with no .githooks at all gets ONE warning naming render --apply', () => {
  const dir = sandbox({ 'house.json': houseJson() });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0, 'a repo adopted before the floor shipped must not fail its gate');
  assert.equal(floorFindings(json).length, 0);
  const w = floorWarnings(json);
  assert.equal(w.length, 1, `one warning for the whole missing floor, got ${JSON.stringify(w)}`);
  assert.match(w[0].message, /house render --apply/);
  for (const p of FLOOR_FILES) assert.ok(w[0].message.includes(p), `the warning must name ${p}`);
});

// A repo that has SOME of the floor was rendered and then lost the rest, which
// is a different thing from a repo that never had it: the first is damage, the
// second is an upgrade that has not happened yet. So a partial floor is a
// finding, and it names only what is gone.
test('guard floor: a partly vendored floor is a FINDING naming only the files that are missing', () => {
  const dir = floorSandbox(houseJson(), { omit: ['.githooks/pre-push', '.githooks/pre-push.d/10-house-branch'] });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 1, 'a floor that was vendored and is now incomplete is damage, not a pending upgrade');
  assert.equal(floorWarnings(json).length, 0, JSON.stringify(json.warnings));
  const f = floorFindings(json);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].path, '.githooks');
  assert.ok(f[0].message.includes('.githooks/pre-push'), f[0].message);
  assert.ok(!f[0].message.includes('.githooks/pre-commit`'), 'a vendored file must not be reported missing');
  assert.match(f[0].message, /house render --apply/);
});

// R4: house-lib.sh is in the floor set because every guard sources it and dies
// when the source fails. A repo missing only the library cannot commit at all,
// so "the floor is fine, one sourced helper is gone" is exactly the wrong
// verdict; it is the sharpest case for partial-is-a-finding.
test('guard floor: a missing house-lib.sh alone is a FINDING (every guard sources it and fails closed)', () => {
  const dir = floorSandbox(houseJson(), { omit: ['.githooks/house-lib.sh'] });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 1, 'a floor whose shared library is gone must not pass the gate');
  const f = floorFindings(json);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.ok(f[0].message.includes('.githooks/house-lib.sh'), f[0].message);
  assert.match(f[0].message, /fails every commit closed/);
  assert.equal(floorWarnings(json).length, 0);
});

test('guard floor: a floor file tracked 100644 is a FINDING (git skips a hook it cannot execute)', () => {
  const dir = floorSandbox(houseJson(), { modes: { '.githooks/pre-push': 0o644 } });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 1, 'a non-executable floor file is a repo defect, not a warning');
  const f = floorFindings(json);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].path, '.githooks/pre-push');
  assert.match(f[0].message, /100644/);
  assert.match(f[0].message, /chmod \+x/);
  assert.equal(floorWarnings(json).length, 0, 'a present file is not also reported missing');
});

test('guard floor: a stub floor file is a FINDING (comments and a bare exit 0 guard nothing)', () => {
  for (const body of ['', '#!/usr/bin/env bash\n', '#!/usr/bin/env bash\n# placeholder\nexit 0\n', '   \n\texit 0\n']) {
    const dir = floorSandbox(houseJson(), { bodies: { '.githooks/pre-commit.d/10-house-branch': body } });
    const { code, json } = run(dir, ['--only=guard', '--json']);
    assert.equal(code, 1, `a stub floor file (${JSON.stringify(body)}) must be a finding`);
    const f = floorFindings(json);
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.equal(f[0].path, '.githooks/pre-commit.d/10-house-branch');
    assert.match(f[0].message, /does nothing/);
  }
});

test('guard floor: the github module off is one warning, and the missing files are not reported twice', () => {
  const dir = sandbox({ 'house.json': houseJson({ modules: { github: { enabled: false } } }) });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0);
  const w = floorWarnings(json);
  assert.equal(w.length, 1, JSON.stringify(w));
  assert.equal(w[0].path, 'house.json');
  assert.match(w[0].message, /github module is off/);
  assert.equal(floorFindings(json).length, 0);
});

test('guard floor: branchPolicy direct reports nothing at all, floor or otherwise', () => {
  const dir = sandbox({ 'house.json': houseJson({ branchPolicy: 'direct', deviations: [{ kind: 'branch-policy', what: 'x', why: 'y', decided: '2026-08-25' }] }) });
  const { code, json } = run(dir, ['--only=guard', '--json']);
  assert.equal(code, 0);
  assert.equal((json.findings || []).filter((f) => f.family === 'guard').length, 0);
  assert.equal((json.warnings || []).filter((x) => x.family === 'guard').length, 0);
});

test('guard floor: the floor verdict is independent of the three session verdicts', () => {
  // A reachable session guard plus a rendered floor: the family is silent.
  const quiet = floorSandbox(houseJson());
  const { files, modes } = floor();
  const both = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(PRE), ...files }, { modes });
  for (const dir of [both]) {
    const { code, json } = run(dir, ['--only=guard', '--json']);
    assert.equal(code, 0);
    assert.equal(guardWarnings(json).length + floorWarnings(json).length + floorFindings(json).length, 0, JSON.stringify(json));
  }
  // A reachable session guard with NO floor still reports the floor, and a
  // missing session guard with a rendered floor still reports the guard.
  const sessionOnly = sandbox({ 'house.json': houseJson(), '.claude/settings.json': JSON.stringify(PRE) });
  const sj = run(sessionOnly, ['--only=guard', '--json']).json;
  assert.equal(guardWarnings(sj).length, 0);
  assert.equal(floorWarnings(sj).length, 1);
  const fj = run(quiet, ['--only=guard', '--json']).json;
  assert.equal(guardWarnings(fj).length, 1, 'a vendored floor is not a session-time guard');
  assert.equal(floorWarnings(fj).length, 0);
});

test('guard floor: --only=guard --json keeps the family output shape', () => {
  const dir = floorSandbox(houseJson(), { modes: { '.githooks/pre-commit': 0o644 } });
  const { json } = run(dir, ['--only=guard', '--json']);
  assert.ok(Array.isArray(json.findings) && Array.isArray(json.warnings));
  for (const e of [...json.findings, ...json.warnings]) {
    assert.deepEqual(Object.keys(e).sort(), ['family', 'kind', 'line', 'message', 'path']);
    assert.equal(e.family, 'guard');
    assert.equal(e.line, null);
  }
});

// R4: ONE definition of the floor, spelled in three languages.
//
// The checker (JS), the arming script (bash) and the module manifest (JSON)
// each carry the list, because none of them can read either of the others at
// the moment it needs it: check.mjs ships as a standalone payload copied into
// an adopter repo, the arming script runs from the plugin with no node
// guaranteed, and module.json is what render reads. Three copies with no test
// between them is how a checker comes to call a floor complete that the arming
// script calls unrendered, and how a new floor file gets vendored but never
// verified. This is that test: it fails the moment the three disagree.
const REPO_ROOT = join(dirname(CHECK_SRC), '..', '..', '..');
const ARM_SRC = join(REPO_ROOT, 'plugins', 'house', 'hooks', 'arm-git-hooks.sh');
const GITHUB_MODULE_JSON = join(REPO_ROOT, 'plugins', 'house', 'modules', 'github', 'module.json');

test('guard floor: check.mjs, arm-git-hooks.sh and the github module agree on which files ARE the floor', () => {
  const checkerList = (() => {
    const src = readFileSync(CHECK_SRC, 'utf8');
    const block = src.match(/const GUARD_FLOOR_FILES = \[([\s\S]*?)\];/);
    assert.ok(block, 'GUARD_FLOOR_FILES is not a literal array in check.mjs any more');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  })();

  const armingList = (() => {
    const src = readFileSync(ARM_SRC, 'utf8');
    const block = src.match(/^FLOOR_FILES="([\s\S]*?)"$/m);
    assert.ok(block, 'FLOOR_FILES is not a literal assignment in arm-git-hooks.sh any more');
    // A bash line continuation is a backslash-newline; what is left is the list.
    return block[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean).map((rel) => `.githooks/${rel}`);
  })();

  const moduleList = JSON.parse(readFileSync(GITHUB_MODULE_JSON, 'utf8'))
    .files.map((f) => f.dest).filter((d) => d.startsWith('.githooks/'));

  const sorted = (a) => [...a].sort();
  assert.equal(checkerList.length, 7, `the floor is seven files, check.mjs has ${checkerList.length}`);
  assert.deepEqual(sorted(armingList), sorted(checkerList), 'arm-git-hooks.sh and check.mjs disagree about the floor');
  assert.deepEqual(sorted(moduleList), sorted(checkerList), 'the github module vendors a different set than check.mjs verifies');
  // ...and the list the cases above exercise is that same set, so a file added
  // to the floor cannot slip past this file untested either.
  assert.deepEqual(sorted(FLOOR_FILES), sorted(checkerList));
});
