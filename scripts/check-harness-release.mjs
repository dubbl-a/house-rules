#!/usr/bin/env node
// check-harness-release.mjs: watch whether Claude Code has shipped a version
// past the one this repo last surveyed (docs/handbook/sources/harness-survey.md),
// since the vendored rules and skills describe a harness surface that moves.
//
// Usage:
//   node scripts/check-harness-release.mjs [--changelog=<path>] [--survey=<path>] [--json]
//
// --changelog reads a local changelog file instead of fetching the upstream
// one, for tests and offline runs. --survey reads a survey file other than
// the repo's own, so a test's baseline does not move with each new survey.
//
// Exit codes (read the verdict by name, never "unchanged" vs "changed"):
//   0  no Claude Code version has shipped past the last surveyed one
//   1  newer versions exist; run the adapting-to-harness-updates skill
//   3  bad argument, or the survey/changelog could not be read; this is not "no newer version"
//
// Needs network for the default changelog source. Not part of `npm run
// verify` for that reason; the harness-watch workflow runs it on a schedule.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const CHANGELOG_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
const SURVEY_PATH = 'docs/handbook/sources/harness-survey.md';

/** The version from the LAST `## ` heading in the survey text that names a
 * `Claude Code X.Y.Z` version, or null if no heading names one. */
export function lastSurveyed(surveyText) {
  const headingRe = /^## .*$/gm;
  let match;
  let found = null;
  while ((match = headingRe.exec(surveyText)) !== null) {
    const versionMatch = match[0].match(/Claude Code (\d+\.\d+\.\d+)/);
    if (versionMatch) found = versionMatch[1];
  }
  return found;
}

/** Changelog versions newer than `version`, newest first, compared
 * numerically per dot segment rather than as strings. */
export function versionsSince(changelogText, version) {
  const baseline = version.split('.').map(Number);
  const headingRe = /^## (\d+\.\d+\.\d+)/gm;
  const versions = [];
  let match;
  while ((match = headingRe.exec(changelogText)) !== null) versions.push(match[1]);
  return versions
    .filter((v) => compareVersions(v.split('.').map(Number), baseline) > 0)
    .sort((a, b) => compareVersions(b.split('.').map(Number), a.split('.').map(Number)));
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseArgs(argv) {
  const out = { changelog: null, survey: null, json: false };
  for (const a of argv) {
    if (a.startsWith('--changelog=')) out.changelog = a.slice(12);
    else if (a.startsWith('--survey=')) out.survey = a.slice(9);
    else if (a === '--json') out.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function findRepoRoot(startDir) {
  // scripts/ sits one level under the repo root.
  return join(startDir, '..');
}

async function main() {
  const emit = (status, verdict, extra) => {
    const report = { status, verdict, ...extra };
    if (opts?.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else process.stdout.write(`harness release: ${verdict}\n`);
    process.exit(status);
  };
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { emit(3, `bad argument (${e.message})`); }

  const here = dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot(here);
  if (opts.survey === '') emit(3, 'bad argument (--survey needs a path)');
  const surveyFile = opts.survey || join(root, SURVEY_PATH);
  const surveyName = opts.survey || SURVEY_PATH;
  let surveyText;
  try { surveyText = readFileSync(surveyFile, 'utf8'); } catch (e) { emit(3, `could not read ${surveyName} (${e.message})`); }

  const surveyed = lastSurveyed(surveyText);
  if (!surveyed) emit(3, `no surveyed version found in ${surveyName}`);

  let changelogText;
  try {
    if (opts.changelog) changelogText = readFileSync(opts.changelog, 'utf8');
    else {
      const res = await fetch(CHANGELOG_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      changelogText = await res.text();
    }
  } catch (e) { emit(3, `could not read changelog (${e.message})`); }

  const newer = versionsSince(changelogText, surveyed);
  if (newer.length === 0) emit(0, `no newer version than ${surveyed} shipped`, { surveyed, latest: surveyed, newer: [] });

  emit(1, `Claude Code ${newer[0]} shipped; last surveyed ${surveyed}; newer: ${newer.join(', ')}; run the adapting-to-harness-updates skill`, { surveyed, latest: newer[0], newer });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
