import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandbox, run } from './helpers.mjs';
// #550: the lockfile family. `npm ci` and `npm ls --all` accept a lockfile
// whose workspace entry has drifted from its manifest (a caret range where the
// manifest pins exactly) and an allowScripts version the lock no longer
// installs. Each test pairs the clean fixture with one planted drift.

const FIX = 'npm install --package-lock-only --ignore-scripts';

const ROOT = { name: 'root', private: true, workspaces: ['brain'], allowScripts: { 'better-sqlite3@13.0.3': true }, devDependencies: { vitest: '^5.1.0' } };
const BRAIN = { name: 'brain', dependencies: { postgres: '4.1.0', 'better-sqlite3': '13.0.3' } };

function lockOf({ brainDeps = BRAIN.dependencies, sqlite = '13.0.3', extra = {} } = {}) {
  return {
    name: 'root',
    lockfileVersion: 3,
    packages: {
      '': { name: 'root', workspaces: ['brain'], devDependencies: { vitest: '^5.1.0' } },
      brain: { name: 'brain', dependencies: brainDeps },
      'node_modules/brain': { resolved: 'brain', link: true },
      'node_modules/better-sqlite3': { version: sqlite },
      'node_modules/brain/node_modules/nested': { version: '1.0.0' },
      ...extra,
    },
  };
}

function repo({ root = ROOT, brain = BRAIN, lock = lockOf(), lockName = 'package-lock.json' } = {}) {
  const files = { 'package.json': JSON.stringify(root), [lockName]: JSON.stringify(lock) };
  if (brain) files['brain/package.json'] = JSON.stringify(brain);
  return sandbox(files);
}

function lockfile(dir) {
  const r = run(dir, ['--only=lockfile', '--json']);
  assert.ok(r.json, r.out);
  const fam = r.json.findings.filter((f) => f.family === 'lockfile');
  assert.equal(r.code, fam.length ? 1 : 0, r.out);
  assert.deepEqual(r.json.warnings.filter((w) => w.family === 'lockfile'), []);
  return fam;
}

test('lockfile: a lock that mirrors its manifests and allowScripts is clean', () => {
  assert.deepEqual(lockfile(repo()), []);
});

test('lockfile: a shrinkwrap is read the same way', () => {
  const bad = lockOf({ brainDeps: { postgres: '^4.1.0', 'better-sqlite3': '13.0.3' } });
  assert.equal(lockfile(repo({ lock: bad, lockName: 'npm-shrinkwrap.json' })).length, 1);
  assert.deepEqual(lockfile(repo({ lockName: 'npm-shrinkwrap.json' })), []);
});

test('lockfile: a caret range in the lock where the workspace pins exactly is a finding naming both values and the fix', () => {
  const fs = lockfile(repo({ lock: lockOf({ brainDeps: { postgres: '^4.1.0', 'better-sqlite3': '13.0.3' } }) }));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].kind, 'lock-drift');
  assert.equal(fs[0].path, 'package-lock.json');
  assert.match(fs[0].message, /brain\/package\.json/);
  assert.match(fs[0].message, /dependencies\.postgres/);
  assert.match(fs[0].message, /"4\.1\.0"/);
  assert.match(fs[0].message, /"\^4\.1\.0"/);
  assert.ok(fs[0].message.includes(FIX));
});

test('lockfile: a dependency present on one side only is a finding', () => {
  const fs = lockfile(repo({ lock: lockOf({ brainDeps: { postgres: '4.1.0' } }) }));
  assert.equal(fs.length, 1);
  assert.match(fs[0].message, /better-sqlite3/);
  assert.match(fs[0].message, /absent/);
});

test('lockfile: the root entry is compared too', () => {
  const lock = lockOf();
  lock.packages[''].devDependencies = { vitest: '^5.2.0' };
  const fs = lockfile(repo({ lock }));
  assert.equal(fs.length, 1);
  assert.match(fs[0].message, /devDependencies\.vitest/);
  assert.match(fs[0].message, /\bpackage\.json\b/);
});

test('lockfile: every dependency field is compared', () => {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const lock = lockOf();
    lock.packages.brain = { name: 'brain', dependencies: BRAIN.dependencies, [field]: { x: '1.0.0' } };
    const fs = lockfile(repo({ brain: { ...BRAIN, [field]: { x: '2.0.0' } }, lock }));
    assert.equal(fs.length, 1, field);
    assert.match(fs[0].message, new RegExp(`${field}\\.x`));
  }
});

test('lockfile: an allowScripts version the lock no longer installs is a finding naming the fix', () => {
  const fs = lockfile(repo({ lock: lockOf({ sqlite: '12.11.1' }) }));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].kind, 'allow-scripts');
  assert.equal(fs[0].path, 'package.json');
  assert.match(fs[0].message, /better-sqlite3@13\.0\.3/);
  assert.match(fs[0].message, /12\.11\.1/);
  assert.match(fs[0].message, /edit the allowScripts version/);
});

test('lockfile: an allowScripts package the lock does not install at all is a finding', () => {
  const lock = lockOf();
  delete lock.packages['node_modules/better-sqlite3'];
  const fs = lockfile(repo({ lock }));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].kind, 'allow-scripts');
});

test('lockfile: a scoped allowScripts key is split at its last @', () => {
  const root = { ...ROOT, allowScripts: { '@scope/pkg@2.0.0': true } };
  const lock = lockOf({ extra: { 'node_modules/@scope/pkg': { version: '2.0.0' } } });
  assert.deepEqual(lockfile(repo({ root, lock })), []);
  const stale = lockOf({ extra: { 'node_modules/@scope/pkg': { version: '2.0.1' } } });
  assert.equal(lockfile(repo({ root, lock: stale })).length, 1);
});

test('lockfile: an allowScripts key that is not name@version is a finding, not a skip', () => {
  for (const key of ['better-sqlite3', '@scope/pkg', 'better-sqlite3@']) {
    const fs = lockfile(repo({ root: { ...ROOT, allowScripts: { [key]: true } } }));
    assert.equal(fs.length, 1, key);
    assert.equal(fs[0].kind, 'allow-scripts');
    assert.match(fs[0].message, /name@version/);
  }
});

test('lockfile: a workspace lock key whose package.json is missing is a finding', () => {
  const fs = lockfile(repo({ brain: null }));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].kind, 'lock-workspace-missing');
  assert.match(fs[0].message, /brain\/package\.json/);
});

test('lockfile: a nested node_modules path is not read as a workspace', () => {
  const lock = lockOf({ extra: { 'brain/node_modules/dep': { version: '1.0.0' } } });
  assert.deepEqual(lockfile(repo({ lock })), []);
});

test('lockfile: a repo declaring neither workspaces nor allowScripts is a no-op, drift and all', () => {
  const root = { name: 'root', devDependencies: { vitest: '^5.1.0' } };
  const lock = lockOf({ sqlite: '9.9.9' });
  lock.packages[''].devDependencies = { vitest: '^9.0.0' };
  assert.deepEqual(lockfile(repo({ root, brain: null, lock })), []);
});

test('lockfile: no tracked lockfile is a no-op', () => {
  assert.deepEqual(lockfile(sandbox({ 'package.json': JSON.stringify(ROOT) })), []);
});

test('lockfile: allowScripts alone, with no workspaces, is checked', () => {
  const root = { name: 'root', allowScripts: { 'better-sqlite3@13.0.3': true } };
  const lock = { lockfileVersion: 3, packages: { '': { name: 'root' }, 'node_modules/better-sqlite3': { version: '12.0.0' } } };
  assert.equal(lockfile(sandbox({ 'package.json': JSON.stringify(root), 'package-lock.json': JSON.stringify(lock) })).length, 1);
});

// A lock npm itself wrote (see fixtures/npm-lock/NOTE.txt): a root dependency
// listed in both `dependencies` and `optionalDependencies`, which npm keeps
// only under `optionalDependencies` in the lock entry, and an allowScripts
// entry naming a linked workspace, whose `node_modules/<name>` entry is a link
// with no version of its own.
const NPM_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'npm-lock');
const FIXTURE_FILES = ['package.json', 'package-lock.json', 'brain/package.json', 'vendor/localdep/package.json', 'vendor/other/package.json'];
function npmRepo(edit = {}) {
  const files = {};
  for (const f of FIXTURE_FILES) {
    const body = JSON.parse(readFileSync(join(NPM_FIXTURE, f), 'utf8'));
    (edit[f] ?? (() => {}))(body);
    files[f] = JSON.stringify(body, null, 2);
  }
  return sandbox(files);
}

test('lockfile: a lock written by real npm is clean, optional-and-regular duplicates and a linked workspace in allowScripts included', () => {
  assert.deepEqual(lockfile(npmRepo()), []);
});

test('lockfile: planting drift in the real npm lock yields exactly that finding', () => {
  const caret = lockfile(npmRepo({ 'package-lock.json': (l) => { l.packages.brain.dependencies.other = '^2.0.0'; } }));
  assert.equal(caret.length, 1);
  assert.equal(caret[0].kind, 'lock-drift');
  assert.match(caret[0].message, /brain\/package\.json/);
  assert.match(caret[0].message, /dependencies\.other/);
  const optional = lockfile(npmRepo({ 'package-lock.json': (l) => { l.packages[''].optionalDependencies.localdep = 'file:vendor/elsewhere'; } }));
  assert.equal(optional.length, 1);
  assert.match(optional[0].message, /optionalDependencies\.localdep/);
  const stale = lockfile(npmRepo({ 'package.json': (m) => { m.allowScripts = { 'brain@1.0.1': true }; } }));
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kind, 'allow-scripts');
  assert.match(stale[0].message, /brain@1\.0\.0/);
});

test('lockfile: a lockfileVersion 1 lock in a repo the family applies to warns that it cannot evaluate, and is no finding', () => {
  const dir = sandbox({ 'package.json': JSON.stringify(ROOT), 'package-lock.json': JSON.stringify({ lockfileVersion: 1, dependencies: {} }), 'brain/package.json': JSON.stringify(BRAIN) });
  const r = run(dir, ['--only=lockfile', '--json']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.findings.filter((f) => f.family === 'lockfile'), []);
  const ws = r.json.warnings.filter((w) => w.family === 'lockfile');
  assert.equal(ws.length, 1);
  assert.equal(ws[0].kind, 'lock-unevaluable');
  assert.match(ws[0].message, /cannot evaluate/);
  assert.match(ws[0].message, /lockfileVersion/);
});

test('lockfile: a lockfileVersion 1 lock where the family does not apply stays silent', () => {
  const dir = sandbox({ 'package.json': JSON.stringify({ name: 'root' }), 'package-lock.json': JSON.stringify({ lockfileVersion: 1 }) });
  const r = run(dir, ['--only=lockfile', '--json']);
  assert.deepEqual([...r.json.findings, ...r.json.warnings].filter((x) => x.family === 'lockfile'), []);
});
