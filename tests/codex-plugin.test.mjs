// Black-box tests for the Codex plugin surface: the manifest at
// plugins/house/.codex-plugin/plugin.json, the hooks file it names
// (plugins/house/hooks/codex-hooks.json), and the one SessionStart command in it.
//
// The formats follow the openai/codex source at tag rust-v0.164.0 (core-plugins
// manifest.rs and loader.rs, hooks discovery.rs and session_start.rs). Nothing
// here ran against a live codex. The loader enforces no manifest field; the
// required set below is the docs' and the store's rule, held here on purpose.
// A SessionStart command that exits 0 with plain text on stdout becomes model
// context, and one that prints JSON-looking text it cannot parse is marked
// failed, so the command is held to one plain "house:" line, never JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PLUGIN = join(ROOT, 'plugins', 'house');
const FLOOR_FILES = ['pre-commit', 'pre-push', 'reference-transaction', 'house-lib.sh',
  'pre-commit.d/10-house-branch', 'pre-push.d/10-house-branch', 'reference-transaction.d/10-house-branch'];
const HAS_JQ = spawnSync('jq', ['--version']).status === 0;

const readJson = (rel) => JSON.parse(readFileSync(join(PLUGIN, rel), 'utf8'));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).stdout.trim();
}

// A repo the arming script treats as applicable and rendered: branchPolicy pr
// and all seven floor files, executable. The files are stubs; arming only
// checks that they exist.
function armableRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'house-codex-'));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'house.json'), `${JSON.stringify({ version: '0.0.0', branchPolicy: 'pr' })}\n`);
  for (const rel of FLOOR_FILES) {
    const f = join(repo, '.githooks', rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(f, 0o755);
  }
  return repo;
}

// What Codex does with the command: text-substitute ${PLUGIN_ROOT}, then run it
// through a shell with the SessionStart payload on stdin. The cwd is unrelated
// to both the plugin and the repo, as it is when a session starts elsewhere.
function runHook(cwdInPayload) {
  const hooks = readJson('hooks/codex-hooks.json');
  const command = hooks.hooks.SessionStart[0].hooks[0].command.replaceAll('${PLUGIN_ROOT}', PLUGIN);
  const payload = JSON.stringify({ session_id: 's1', transcript_path: null, cwd: cwdInPayload, hook_event_name: 'SessionStart', model: 'm', permission_mode: 'default', source: 'startup' });
  const elsewhere = mkdtempSync(join(tmpdir(), 'house-codex-cwd-'));
  const res = spawnSync('bash', ['-c', command], { cwd: elsewhere, input: payload, encoding: 'utf8', env: GIT_ENV });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('the manifest sits in .codex-plugin/, leaving a root plugin.json unused; it carries the documented fields within their limits', () => {
  assert.ok(!existsSync(join(PLUGIN, 'plugin.json')), 'a root plugin.json that carries an Agent Plugins schema would win the discovery order');
  const j = readJson('.codex-plugin/plugin.json');
  assert.ok(!('$schema' in j), 'no $schema: Codex does not read one from this manifest');
  assert.ok(!('skills' in j), 'skills/ is discovered by default');
  assert.match(j.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(j.name.length <= 64);
  assert.equal(j.name, 'house-rules');
  assert.match(j.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof j.description, 'string');
  assert.ok(j.description.length > 0 && j.description.length <= 4000, `description is ${j.description.length} chars`);
  assert.equal(typeof j.author?.name, 'string');
  assert.ok(j.author.name.length > 0);
  assert.ok(j.interface && typeof j.interface === 'object' && !Array.isArray(j.interface));
  for (const k of ['displayName', 'shortDescription', 'developerName', 'category']) {
    assert.equal(typeof j.interface[k], 'string', `interface.${k}`);
    assert.ok(j.interface[k].length > 0, `interface.${k}`);
  }
});

test('the Codex manifest version is the Claude Code manifest version, so a release bumps both', () => {
  assert.equal(readJson('.codex-plugin/plugin.json').version, readJson('.claude-plugin/plugin.json').version,
    'bump plugins/house/.codex-plugin/plugin.json with plugins/house/.claude-plugin/plugin.json');
});

test('the manifest names its hooks file with an explicit ./ path that exists, which replaces the default hooks/hooks.json discovery', () => {
  const j = readJson('.codex-plugin/plugin.json');
  assert.equal(typeof j.hooks, 'string', 'without an explicit hooks value Codex falls back to the Claude Code hooks/hooks.json');
  assert.ok(j.hooks.startsWith('./'), j.hooks);
  assert.ok(existsSync(join(PLUGIN, j.hooks)), `${j.hooks} does not exist`);
  assert.equal(j.hooks, './hooks/codex-hooks.json');
});

test('the hooks file is one SessionStart command running arm-git-hooks.sh, and names no Claude Code hook', () => {
  const raw = readFileSync(join(PLUGIN, 'hooks', 'codex-hooks.json'), 'utf8');
  const j = JSON.parse(raw);
  // Codex's HooksFile denies unknown fields, so an extra top-level key makes it skip the whole file.
  assert.deepEqual(Object.keys(j).filter((k) => k !== 'description' && k !== 'hooks'), [], 'only description and hooks at the top level');
  assert.deepEqual(Object.keys(j.hooks), ['SessionStart']);
  assert.equal(j.hooks.SessionStart.length, 1);
  const group = j.hooks.SessionStart[0];
  assert.ok(!('matcher' in group));
  assert.equal(group.hooks.length, 1);
  const h = group.hooks[0];
  assert.equal(h.type, 'command');
  assert.equal(h.timeout, 10);
  assert.equal(h.command, 'bash "${PLUGIN_ROOT}/hooks/arm-git-hooks.sh"');
  assert.ok(existsSync(join(PLUGIN, 'hooks', 'arm-git-hooks.sh')));
  assert.doesNotMatch(raw, /hooks\.json|no-direct-master|PreToolUse/);
});

test('the Claude Code hooks files do not name the Codex one', () => {
  assert.doesNotMatch(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'), /codex/i);
  assert.doesNotMatch(readFileSync(join(PLUGIN, 'hooks.json'), 'utf8'), /codex/i);
});

test('the marketplace entry Codex reads has the two required keys and a ./ source', () => {
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find((p) => p.name === 'house-rules');
  assert.ok(entry, 'no house-rules entry in .claude-plugin/marketplace.json');
  assert.equal(typeof entry.name, 'string');
  assert.ok(entry.source.startsWith('./'), entry.source);
  assert.ok(existsSync(join(ROOT, entry.source, '.codex-plugin', 'plugin.json')));
});

test('hook command: an armable repo prints exactly one plain "house: armed" line, exits 0, and arms core.hooksPath', { skip: !HAS_JQ && 'jq is missing; the script exits silently without it' }, () => {
  const repo = armableRepo();
  assert.equal(git(repo, 'config', '--get', 'core.hooksPath'), '', 'unarmed to start');
  const r = runHook(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^house: armed git hooks \(core\.hooksPath=[^\n]*\)\n$/, JSON.stringify(r.stdout));
  assert.ok(!/^\s*[{[]/.test(r.stdout), 'stdout that looks like JSON would be parsed, and a parse failure marks the hook failed');
  assert.equal(r.stdout.trimEnd().split('\n').length, 1);
  assert.match(git(repo, 'config', '--get', 'core.hooksPath'), /\.githooks\/?$/);
  // Armed already: the second session has nothing to say.
  const again = runHook(repo);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, '');
});

test('hook command: a cwd that is not a git repo prints nothing and exits 0', () => {
  const plain = mkdtempSync(join(tmpdir(), 'house-codex-plain-'));
  const r = runHook(plain);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('hook command: a cwd that does not exist prints nothing and exits 0', () => {
  const r = runHook('/nonexistent/house-codex');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('the skills that drive the CLI give Codex the node form, since bin/ on its PATH is unverified', () => {
  for (const d of ['doctor', 'sync', 'bootstrap']) {
    assert.match(readFileSync(join(PLUGIN, 'skills', d, 'SKILL.md'), 'utf8'), /On Codex,.*run `node <that directory>\/scripts\/house <args>`/, d);
  }
});
