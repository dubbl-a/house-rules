// Tests for scripts/check-harness-release.mjs: the pure parsing functions
// directly, and the CLI end to end against a fixture changelog via
// --changelog and --survey (offline, no network).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastSurveyed, versionsSince } from '../scripts/check-harness-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'check-harness-release.mjs');

test('lastSurveyed: last heading wins across both heading shapes', () => {
  const text = [
    '## Re-survey, 2026-09-20 (Claude Code 2.1.278)',
    '',
    'body',
    '',
    '## Addendum, 2026-09-22: Claude Code 2.1.280',
    '',
    'more body',
  ].join('\n');
  assert.equal(lastSurveyed(text), '2.1.280');
});

test('lastSurveyed: a file with no version returns null', () => {
  const text = '## Method\n\nno version mentioned here\n\n## Result\n\nstill none\n';
  assert.equal(lastSurveyed(text), null);
});

test('versionsSince: numeric compare, not string compare', () => {
  const changelog = '## 2.1.100\n\nchanges\n\n## 2.1.99\n\nchanges\n';
  const newer = versionsSince(changelog, '2.1.99');
  assert.deepEqual(newer, ['2.1.100']);
});

test('versionsSince: none newer', () => {
  const changelog = '## 2.1.5\n\nchanges\n\n## 2.1.4\n\nchanges\n';
  assert.deepEqual(versionsSince(changelog, '2.1.5'), []);
});

test('versionsSince: newest first across several versions', () => {
  const changelog = '## 2.2.0\n\nx\n\n## 2.1.283\n\nx\n\n## 2.1.280\n\nx\n\n## 2.1.100\n\nx\n';
  assert.deepEqual(versionsSince(changelog, '2.1.100'), ['2.2.0', '2.1.283', '2.1.280']);
});

test('CLI: exits 0 when the fixture changelog has no version newer than the survey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-release-'));
  try {
    const changelogPath = join(dir, 'CHANGELOG.md');
    writeFileSync(changelogPath, '## 2.1.280\n\nnothing new\n\n## 2.1.278\n\nolder\n');
    const surveyPath = join(dir, 'harness-survey.md');
    writeFileSync(surveyPath, '## Addendum, 2026-09-22: Claude Code 2.1.280\n\nbody\n');
    let stdout, status;
    try {
      stdout = execFileSync(process.execPath, [SCRIPT, `--changelog=${changelogPath}`, `--survey=${surveyPath}`, '--json'], { encoding: 'utf8' });
      status = 0;
    } catch (e) {
      stdout = e.stdout;
      status = e.status;
    }
    assert.equal(status, 0);
    const report = JSON.parse(stdout);
    assert.equal(report.status, 0);
    assert.deepEqual(report.newer, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Runs the CLI with --json and returns its exit status and parsed report.
function runCli(args) {
  let stdout, status;
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, ...args, '--json'], { encoding: 'utf8' });
    status = 0;
  } catch (e) {
    stdout = e.stdout;
    status = e.status;
  }
  return { status, report: JSON.parse(stdout) };
}

test('CLI: an empty --survey= exits 3 as a bad argument', () => {
  const { status, report } = runCli(['--survey=', '--changelog=/nonexistent/CHANGELOG.md']);
  assert.equal(status, 3);
  assert.equal(report.status, 3);
  assert.match(report.verdict, /--survey needs a path/);
});

test('CLI: an unreadable survey file exits 3 and names the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-release-'));
  try {
    const surveyPath = join(dir, 'no-such-survey.md');
    const { status, report } = runCli([`--survey=${surveyPath}`, '--changelog=/nonexistent/CHANGELOG.md']);
    assert.equal(status, 3);
    assert.ok(report.verdict.includes(surveyPath), `the verdict does not name ${surveyPath}: ${report.verdict}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: exits 1 when the fixture changelog has a version newer than the survey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-release-'));
  try {
    const changelogPath = join(dir, 'CHANGELOG.md');
    writeFileSync(changelogPath, '## 2.1.283\n\nnewer\n\n## 2.1.280\n\nolder\n');
    const surveyPath = join(dir, 'harness-survey.md');
    writeFileSync(surveyPath, '## Addendum, 2026-09-22: Claude Code 2.1.280\n\nbody\n');
    let stdout, status;
    try {
      stdout = execFileSync(process.execPath, [SCRIPT, `--changelog=${changelogPath}`, `--survey=${surveyPath}`, '--json'], { encoding: 'utf8' });
      status = 0;
    } catch (e) {
      stdout = e.stdout;
      status = e.status;
    }
    assert.equal(status, 1);
    const report = JSON.parse(stdout);
    assert.equal(report.status, 1);
    assert.ok(report.newer.includes('2.1.283'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
