import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sandbox, run, CHECK_SRC, houseJson } from './helpers.mjs';

test('cli: drift can run with defaults when house.json is absent (no exit-2)', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  const { code } = run(dir, ['--only=drift']);
  assert.equal(code, 0);
});

test('cli: tamper/manifest/coload exit 2 when house.json is missing and any of them is requested', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  for (const only of ['tamper', 'manifest', 'coload']) {
    const { code } = run(dir, [`--only=${only}`]);
    assert.equal(code, 2, `--only=${only} should exit 2`);
  }
});

test('cli: a mixed --only where one family needs house.json still exits 2 overall, others still run', () => {
  const dir = sandbox({ 'CLAUDE.md': '# Repo\n\nTODO: fix this.\n' });
  const { code, out } = run(dir, ['--only=todo,manifest']);
  assert.equal(code, 2); // unusable house.json dominates
  assert.match(out, /\[todo\]/); // todo still ran and reported its finding
  assert.match(out, /skipped: house\.json unusable/);
});

test('cli: default (no --only) runs every family', () => {
  const dir = sandbox({ 'CLAUDE.md': '# Repo\n\nTODO: fix this.\n', 'house.json': houseJson() });
  const { out } = run(dir, ['--json']);
  const j = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
  assert.ok(j.findings.some((f) => f.family === 'todo'));
});

test('cli: --only limits to the named families only', () => {
  const dir = sandbox({ 'CLAUDE.md': '# Repo\n\nTODO: fix this.\n', 'house.json': houseJson() });
  const { json } = run(dir, ['--only=drift', '--json']);
  assert.ok(!json.findings.some((f) => f.family === 'todo'));
});

test('cli: an unknown --only name is ignored (not a crash), warns on stderr', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  let stderr = '';
  let code = 0;
  try {
    execFileSync('node', [CHECK_SRC, '--repo', dir, '--only=bogus,drift'], { encoding: 'utf8' });
  } catch (e) {
    stderr = e.stderr ?? '';
    code = e.status;
  }
  // drift still ran (bogus was dropped, not fatal)
  assert.notEqual(code, 2);
});

test('cli: --json emits {findings, warnings, scannedDocs, coloadWorst}', () => {
  const dir = sandbox({ 'README.md': '# Hello\n', 'house.json': houseJson() });
  const { json } = run(dir, ['--json']);
  assert.ok(json);
  assert.ok('findings' in json);
  assert.ok('warnings' in json);
  assert.ok('scannedDocs' in json);
  assert.ok('coloadWorst' in json);
});

test('cli: exit 0 clean, exit 1 with findings', () => {
  const clean = sandbox({ 'README.md': '# Hello\n' });
  assert.equal(run(clean, ['--only=drift']).code, 0);

  const dirty = sandbox({ 'README.md': 'See `src/missing.ts`.\n', 'src/real.ts': 'export const x = 1;\n' });
  assert.equal(run(dirty, ['--only=drift']).code, 1);
});

test('cli: a failing run ends with the three remediations, a clean run does not', () => {
  // Both directions: a report that names no remedy teaches nothing, and a
  // clean report that names remedies is noise on every green run.
  const dirty = sandbox({ 'README.md': 'See `src/missing.ts`.\n', 'src/real.ts': 'export const x = 1;\n' });
  const bad = run(dirty, ['--only=drift']);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /Fix a finding one of three ways:/);
  assert.match(bad.out, /change the document/);
  assert.match(bad.out, /change the code/);
  assert.match(bad.out, /record the exception with its reason/);

  const clean = sandbox({ 'README.md': '# Hello\n' });
  const good = run(clean, ['--only=drift']);
  assert.equal(good.code, 0, good.out);
  assert.doesNotMatch(good.out, /Fix a finding one of three ways:/);
});

test('cli: --repo works from a different cwd than the target repo', () => {
  const dir = sandbox({ 'README.md': '# Hello\n' });
  // cwd is the house package repo itself -- a different git repo entirely
  // from the sandbox -- proving --repo overrides cwd-based resolution.
  const houseRepoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const out = execFileSync('node', [CHECK_SRC, '--repo', dir, '--only=drift'], {
    encoding: 'utf8',
    cwd: houseRepoRoot,
  });
  assert.match(out, /0 finding/);
});
