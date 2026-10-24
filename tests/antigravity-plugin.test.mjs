// Black-box tests for the Antigravity CLI (agy) plugin surface: the manifest at
// plugins/house/.antigravity-plugin/plugin.json, hooks.json at plugins/house/,
// and the SessionStart hook it runs
// (plugins/house/hooks/antigravity-session-start.mjs).
//
// The formats follow antigravity.google/docs/plugins and /docs/hooks (CLI app).
// Nothing here ran against a live agy; the hook's exit-code and timeout
// behavior are undocumented upstream, so the wrapper is held to the strictest
// reading: exactly one parseable JSON object on stdout, exit 0, every time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..', 'plugins', 'house');
const HOOK_PATH = join(PLUGIN, 'hooks', 'antigravity-session-start.mjs');
const FLOOR_FILES = ['pre-commit', 'pre-push', 'reference-transaction', 'house-lib.sh',
  'pre-commit.d/10-house-branch', 'pre-push.d/10-house-branch', 'reference-transaction.d/10-house-branch'];

const readJson = (rel) => JSON.parse(readFileSync(join(PLUGIN, rel), 'utf8'));

// The user's global git config must not decide whether a temp repo is armed.
function run(stdin, env = {}) {
  const childEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env };
  const res = spawnSync(process.execPath, [HOOK_PATH], { input: stdin, encoding: 'utf8', env: childEnv });
  return { status: res.status, stdout: res.stdout };
}

function git(cwd, ...args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  return res.stdout.trim();
}

// A repo the arming script treats as applicable and rendered: branchPolicy pr
// and all seven floor files, executable. The files are stubs; arming only
// checks that they exist.
function armableRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'house-agy-'));
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

// Exactly one JSON object followed by a newline, nothing else.
function parseOnly(stdout) {
  assert.match(stdout, /^\{.*\}\n$/s, `stdout is not a single JSON line: ${JSON.stringify(stdout)}`);
  const obj = JSON.parse(stdout);
  assert.ok(obj && typeof obj === 'object' && !Array.isArray(obj));
  return obj;
}

test('the manifest sits in .antigravity-plugin/, leaving a root plugin.json free; it carries only the allowed keys and a valid name', () => {
  assert.ok(!existsSync(join(PLUGIN, 'plugin.json')), 'a root plugin.json is the Codex portable layout\'s path');
  const j = readJson('.antigravity-plugin/plugin.json');
  const allowed = new Set(['$schema', 'name', 'description']);
  for (const k of Object.keys(j)) assert.ok(allowed.has(k), `plugin.json key ${k} is outside the Antigravity schema`);
  assert.equal(j.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
  assert.match(j.name, /^[a-zA-Z0-9-_]+$/);
  assert.equal(j.name, 'house-rules');
  assert.equal(typeof j.description, 'string');
  assert.ok(j.description.length > 0);
  assert.ok(!('version' in j), 'the Antigravity plugin schema has no version field');
});

test('hooks.json is one named hook running the wrapper by ${extensionPath} on SessionStart', () => {
  const j = readJson('hooks.json');
  assert.deepEqual(Object.keys(j), ['house-arm-git-hooks']);
  const hook = j['house-arm-git-hooks'];
  assert.deepEqual(Object.keys(hook), ['SessionStart']);
  assert.equal(hook.SessionStart.length, 1);
  const h = hook.SessionStart[0];
  assert.equal(h.type, 'command');
  assert.equal(h.timeout, 10);
  assert.equal(h.command, 'node "${extensionPath}/hooks/antigravity-session-start.mjs"');
  // The command names a file this plugin ships.
  assert.ok(existsSync(HOOK_PATH));
  assert.ok(!('hooks' in j), 'a top-level hooks key would load as a single hook named hooks');
});

test('the Claude Code hooks.json is untouched by the Antigravity one: no wrapper in it', () => {
  assert.doesNotMatch(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'), /antigravity/);
});

test('wrapper: empty stdin prints {} and exits 0', () => {
  const r = run('');
  assert.equal(r.status, 0);
  assert.deepEqual(parseOnly(r.stdout), {});
});

test('wrapper: malformed stdin, and stdin that is not an object, print {} and exit 0', () => {
  for (const input of ['{ not json', 'null', '[]', '"x"', '{"workspacePaths":"/tmp"}', '{"workspacePaths":[1,null,""]}']) {
    const r = run(input);
    assert.equal(r.status, 0, input);
    assert.deepEqual(parseOnly(r.stdout), {}, input);
  }
});

test('wrapper: a path that does not exist, and a directory that is not a repo, print {}', () => {
  const plain = mkdtempSync(join(tmpdir(), 'house-agy-plain-'));
  const r = run(JSON.stringify({ workspacePaths: ['/nonexistent/house-agy', plain] }));
  assert.equal(r.status, 0);
  assert.deepEqual(parseOnly(r.stdout), {});
});

test('wrapper: an armable repo gets core.hooksPath set, and the report is one ephemeralMessage', () => {
  const repo = armableRepo();
  assert.equal(git(repo, 'config', '--get', 'core.hooksPath'), '', 'unarmed to start');
  const r = run(JSON.stringify({ conversationId: 'c1', workspacePaths: [repo], modelName: 'm' }));
  assert.equal(r.status, 0);
  const out = parseOnly(r.stdout);
  assert.match(git(repo, 'config', '--get', 'core.hooksPath'), /\.githooks\/?$/);
  assert.deepEqual(Object.keys(out), ['injectSteps']);
  assert.equal(out.injectSteps.length, 1);
  assert.deepEqual(Object.keys(out.injectSteps[0]), ['ephemeralMessage']);
  assert.match(out.injectSteps[0].ephemeralMessage, /^house: /);
  // Armed already: the second run has nothing to say.
  assert.deepEqual(parseOnly(run(JSON.stringify({ workspacePaths: [repo] })).stdout), {});
});

test('wrapper: several workspace paths are each armed, and the lines join into one message', () => {
  const a = armableRepo();
  const b = armableRepo();
  const r = run(JSON.stringify({ workspacePaths: [a, '/nonexistent/house-agy', b] }));
  assert.equal(r.status, 0);
  const out = parseOnly(r.stdout);
  assert.equal(out.injectSteps.length, 1);
  assert.equal(out.injectSteps[0].ephemeralMessage.split('\n').length, 2);
  for (const repo of [a, b]) assert.match(git(repo, 'config', '--get', 'core.hooksPath'), /\.githooks\/?$/);
});

test('wrapper: a missing bash prints {} and exits 0', () => {
  const r = run(JSON.stringify({ workspacePaths: [armableRepo()] }), { PATH: '/nonexistent' });
  assert.equal(r.status, 0);
  assert.deepEqual(parseOnly(r.stdout), {});
});

// agy cuts a SKILL.md body past 24 KB, so a skill that grows past it loses its tail there.
test('every skill body stays under the 24 KB Antigravity cuts at', () => {
  const skills = readdirSync(join(PLUGIN, 'skills')).filter((d) => existsSync(join(PLUGIN, 'skills', d, 'SKILL.md')));
  assert.ok(skills.length > 0);
  for (const d of skills) {
    const bytes = statSync(join(PLUGIN, 'skills', d, 'SKILL.md')).size;
    assert.ok(bytes < 24 * 1024, `skills/${d}/SKILL.md is ${bytes} bytes, past 24 KB`);
  }
});

test('the skills that drive the CLI tell a host without CLAUDE_PLUGIN_ROOT to run bin/house, which runs from any cwd', () => {
  for (const d of ['doctor', 'sync', 'bootstrap']) {
    assert.match(readFileSync(join(PLUGIN, 'skills', d, 'SKILL.md'), 'utf8'), /Outside Claude Code \(Antigravity CLI\).*run `house <args>`/, d);
  }
  const elsewhere = mkdtempSync(join(tmpdir(), 'house-agy-cwd-'));
  const r = spawnSync(join(PLUGIN, 'bin', 'house'), ['--help'], { cwd: elsewhere, encoding: 'utf8' });
  assert.notEqual(r.error?.code, 'ENOENT');
  // --help is not a subcommand: the CLI prints usage to stderr and exits 2. A broken forwarder
  // exits 1 with a module-not-found error and no usage line, so both assertions can fail.
  assert.equal(r.status, 2, `bin/house --help exited ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /^usage: house /m, 'bin/house ran and printed usage from a foreign cwd');
});
