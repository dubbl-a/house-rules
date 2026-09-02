// Shared sandbox harness for tests/check/*.test.mjs, mirroring repo-b's
// docs-drift-rules.test.mjs pattern: a throwaway git repo per test, holding
// a real copy of check.mjs plus whatever fixture files the test needs. The
// real script runs as a subprocess (never imported) so these are black-box
// tests of the shipped checker, not of a copy of its logic.

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHECK_SRC = join(HERE, '..', '..', 'plugins', 'house', 'payload', 'check.mjs');

/** Build a throwaway git repo containing `files` (path -> string content). */
export function sandbox(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'house-check-'));
  for (const [p, body] of Object.entries(files)) {
    const abs = join(dir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

/**
 * Run the real check.mjs against a sandbox dir. Returns {code, out, json}.
 * `env` overrides/extends process.env for this invocation (used to point
 * CLAUDE_CONFIG_DIR at a fixture installed_plugins.json without touching
 * the real ~/.claude).
 */
export function run(dir, extraArgs = [], env = {}) {
  try {
    const out = execFileSync('node', [CHECK_SRC, '--repo', dir, ...extraArgs], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: 0, out, json: tryJson(out) };
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { code: e.status, out, json: tryJson(e.stdout ?? '') };
  }
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Write files into an existing sandbox dir WITHOUT staging or committing
 * them: present on disk, absent from `git ls-files`. For testing the
 * gitignored-but-real disk fallback (kind-(c) path anchors).
 */
export function writeUntracked(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    const abs = join(dir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

/** Write more files into an existing sandbox dir and stage+commit them. */
export function addFiles(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    const abs = join(dir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'update'], { cwd: dir });
}

/** A fake ~/.claude config dir holding installed_plugins.json (for tamper/behind/manifest tests). */
export function fakeClaudeConfigDir(installed) {
  const dir = mkdtempSync(join(tmpdir(), 'house-cfg-'));
  if (installed !== undefined) {
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify(installed, null, 2));
  }
  return dir;
}

/** Write a plain (non-git) file tree, e.g. a fake plugin install directory. */
export function writeTree(baseDir, files) {
  for (const [p, body] of Object.entries(files)) {
    const abs = join(baseDir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

export function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Minimal valid house.json as a JS object, mergeable with overrides. */
export function houseJson(overrides = {}) {
  return JSON.stringify({
    version: '0.1.0',
    defaultBranch: 'main',
    branchPolicy: 'pr',
    modules: {},
    ...overrides,
  }, null, 2);
}
