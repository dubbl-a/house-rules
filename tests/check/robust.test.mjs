import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, run, houseJson, CHECK_SRC } from './helpers.mjs';

// #165: inputs a repo can plant must end in a named finding or a bounded
// result, never a stack trace, a hang, or truncated output.

function lockWith(path) {
  return JSON.stringify({ files: [{ path, module: 'git-workflow', source: 'modules/git-workflow/rules/branching.md', bodySha256: 'x' }] });
}

test('robust: a lock whose content is null is a named finding, not a TypeError', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': 'null', 'docs/a.md': '# a\n' });
  const r = run(dir);
  assert.doesNotMatch(r.out, /TypeError|at .*check\.mjs/, r.out);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lock is null/);
});

for (const p of ['docs', 'docs/']) {
  test(`robust: a lock path naming a directory (${p}) is a named finding, not EISDIR`, () => {
    const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': lockWith(p), 'docs/a.md': '# a\n' });
    const r = run(dir);
    assert.doesNotMatch(r.out, /EISDIR|at .*check\.mjs/, r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /directory/);
  });
}

test('robust: a lock path naming a symlink to a directory is a named finding, not EISDIR', () => {
  const dir = sandbox({ 'house.json': houseJson(), '.house/lock.json': lockWith('link'), 'docs/a.md': '# a\n' });
  symlinkSync('docs', join(dir, 'link'));
  const r = run(dir);
  assert.doesNotMatch(r.out, /EISDIR|at .*check\.mjs/, r.out);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /directory/);
});

test('robust: a long line of unclosed docs markers scans in linear time (1 MB)', () => {
  const dir = sandbox({ 'house.json': houseJson(), 'README.md': `${'<!-- docs-drift-ignore: '.repeat(40_000)}\n` });
  const t = Date.now();
  const r = spawnSync('node', [CHECK_SRC, '--repo', dir], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.error, undefined, 'checker timed out');
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
});

test('robust: --json output over 64 KB reaches a piped consumer whole', () => {
  const lines = [];
  for (let i = 0; i < 150; i++) lines.push(`Mentions \`src/missing-${i}-${'x'.repeat(400)}.ts\` here.`);
  const dir = sandbox({ 'house.json': houseJson(), 'README.md': lines.join('\n') + '\n', 'src/real.ts': 'export const x = 1;\n' });
  const out = execFileSync('sh', ['-c', `node "${CHECK_SRC}" --repo "${dir}" --json | cat; true`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.ok(out.length > 65536, `fixture too small: ${out.length}`);
  assert.doesNotThrow(() => JSON.parse(out), 'output was cut off');
});

test('robust: a FIFO at AGENTS.md is a named finding, not a hang', () => {
  const dir = sandbox({ 'house.json': houseJson(), 'README.md': '# r\n' });
  execFileSync('mkfifo', [join(dir, 'AGENTS.md')]);
  const r = spawnSync('node', [CHECK_SRC, '--repo', dir, '--only=lengths'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.error, undefined, 'checker hung');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /AGENTS\.md.*not a regular file/s);
});

test('robust: a FIFO at house.json is a named finding, not a hang', () => {
  const dir = sandbox({ 'README.md': '# r\n' });
  execFileSync('mkfifo', [join(dir, 'house.json')]);
  const r = spawnSync('node', [CHECK_SRC, '--repo', dir], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.error, undefined, 'checker hung');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /house\.json.*not a regular file/s);
});

test('robust: a FIFO at GEMINI.md is named, not read as empty', () => {
  const dir = sandbox({ 'house.json': houseJson({ targets: ['claude-code', 'gemini'] }), 'README.md': '# r\n' });
  execFileSync('mkfifo', [join(dir, 'GEMINI.md')]);
  const r = spawnSync('node', [CHECK_SRC, '--repo', dir, '--only=guard'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.error, undefined, 'checker hung');
  assert.match(r.stdout, /GEMINI\.md.*not a regular file/s);
  assert.doesNotMatch(r.stdout, /nothing here points it at AGENTS\.md/);
});
