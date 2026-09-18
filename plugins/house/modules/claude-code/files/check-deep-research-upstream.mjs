#!/usr/bin/env node
// check-deep-research-upstream.mjs: watch Claude Code's bundled `deep-research`
// workflow for the change that retires house's per-stage model pins, and
// rebuild the pinned copy from the installed binary when asked.
//
// Why this exists (rule "Set the model explicitly on every subagent and
// workflow agent", claude-code module): the bundled workflow names no model
// on any agent() call and takes only a question string as args, so every one
// of its ~100 agents inherits the session model. Until the native workflow
// takes a model, the fix is a fork of its script with `model:` on each call.
// This tool keeps that fork honest without vendoring Anthropic's script text
// into a repo: it reads the script out of the locally installed binary.
//
// Usage:
//   node scripts/house/check-deep-research-upstream.mjs [--binary=<path>] [--baseline=<sha256>] [--json]
//   node scripts/house/check-deep-research-upstream.mjs --rebuild=<out.js> [--binary=<path>]
//
// Exit codes (the three-way contract a caller must read, never "non-zero = bad"):
//   0  native script unchanged since the recorded baseline; keep the fork
//   1  native script drifted (or the binary/script was not found); re-derive the fork with --rebuild
//   2  SUNSET: the native workflow now sets per-agent models or takes object args; delete the fork
//   3  usage or rebuild failure (an anchor the pins rely on no longer matches exactly once)

import { readFileSync, writeFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

// Baseline: sha256 of the unescaped native script body (from `// deep-research:`
// through the closing brace of its final return) as shipped in the version named.
// Update both fields together when re-deriving the fork after a drift report.
export const BASELINE = {
  version: '2.1.276',
  sha256: '0eb1a5cf377310b9fbd256c5e4982654999cbab4fc964c1e7983414f6e059224',
};

const BODY_START = '// deep-research:';
const BODY_END_ANCHOR = 'agentCalls:';

// The five agent() option objects the fork adds a model to. Each must match
// exactly once in the native body or the rebuild refuses, so a silently
// mismatched pin can never ship.
export const PINS = [
  ['{ label: "scope", schema: SCOPE_SCHEMA }', '{ label: "scope", schema: SCOPE_SCHEMA, model: MODELS.scope }'],
  ['phase: "Search", schema: SEARCH_SCHEMA\n', 'phase: "Search", schema: SEARCH_SCHEMA, model: MODELS.search\n'],
  ['schema: EXTRACT_SCHEMA,\n', 'schema: EXTRACT_SCHEMA,\n          model: MODELS.fetch,\n'],
  ['schema: VERDICT_SCHEMA,\n', 'schema: VERDICT_SCHEMA,\n          model: MODELS.verify,\n'],
  ['{ label: "synthesize", schema: REPORT_SCHEMA }', '{ label: "synthesize", schema: REPORT_SCHEMA, model: MODELS.synthesize }'],
];
const QUESTION_LINE = 'const QUESTION = (typeof args === "string" && args.trim()) || ""';
const QUESTION_REPLACEMENT = `const ARGS_OBJ = (args && typeof args === "object" && !Array.isArray(args)) ? args : {}
const QUESTION = (typeof args === "string" && args.trim()) || (typeof ARGS_OBJ.question === "string" && ARGS_OBJ.question.trim()) || ""
// Per-stage model pins. Conservative by default: the wide fan-out (search,
// fetch, verify) runs on the middle tier; judgment (scope, synthesize) on the
// top tier below the session's. Override any stage via args.models.
const MODELS = Object.assign(
  { scope: "opus", search: "sonnet", fetch: "sonnet", verify: "sonnet", synthesize: "opus" },
  ARGS_OBJ.models || {}
)
log("Models: scope=" + MODELS.scope + " search=" + MODELS.search + " fetch=" + MODELS.fetch + " verify=" + MODELS.verify + " synthesize=" + MODELS.synthesize)`;

const META = (version, sha) => `export const meta = {
  name: 'deep-research-pinned',
  description: 'Deep research harness with per-stage model pins: fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.',
  whenToUse: 'House fork of the bundled deep-research workflow (Claude Code ${version}, native body sha256 ${sha.slice(0, 12)}). Run by scriptPath. args: a question string, or {question, models: {scope, search, fetch, verify, synthesize}}. Retire when check-deep-research-upstream.mjs exits 2.',
  phases: [{"title":"Scope","detail":"Decompose question (from args) into 5 search angles"},{"title":"Search","detail":"5 parallel WebSearch agents, one per angle"},{"title":"Fetch","detail":"URL-dedup, fetch top 15 sources, extract falsifiable claims"},{"title":"Verify","detail":"3-vote adversarial verification per claim (need 2/3 refutes to kill)"},{"title":"Synthesize","detail":"Merge semantic dupes, rank by confidence, cite sources"}],
}

`;

export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

/** Find the installed Claude Code binary: --binary, $CLAUDE_BINARY, `claude` on PATH, else the newest versions/ entry. */
export function locateBinary(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.CLAUDE_BINARY) candidates.push(process.env.CLAUDE_BINARY);
  try {
    const onPath = execFileSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim();
    if (onPath) candidates.push(realpathSync(onPath));
  } catch { /* not on PATH */ }
  const versionsDir = join(homedir(), '.local', 'share', 'claude', 'versions');
  if (existsSync(versionsDir)) {
    const versions = readdirSync(versionsDir).filter((v) => /^\d+\.\d+\.\d+/.test(v)).sort(compareSemver);
    if (versions.length) candidates.push(join(versionsDir, versions[versions.length - 1]));
  }
  return candidates.find((c) => { try { return statSync(c).isFile(); } catch { return false; } }) || null;
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export function versionOf(binaryPath) {
  const m = basename(binaryPath).match(/^\d+\.\d+\.\d+(?:[-.][\w.]+)?/);
  return m ? m[0] : 'unknown';
}

/** Pull the native body out of the binary and undo its template-literal escaping. */
export function extractNativeBody(bytes) {
  const start = bytes.indexOf(BODY_START);
  if (start < 0) return null;
  const endAnchor = bytes.indexOf(BODY_END_ANCHOR, start);
  if (endAnchor < 0) return null;
  const close = bytes.indexOf('\n}', endAnchor);
  if (close < 0) return null;
  let body = bytes.slice(start, close + 2).toString('utf8');
  // The script is stored inside a JS template literal, so its backslashes are
  // doubled. Detect that by the URL regex the body always carries.
  if (body.includes(':\\\\/\\\\/')) {
    body = body.replace(/\\\\/g, '\\').replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
  }
  return body;
}

/** True when the native workflow no longer needs the fork. */
export function sunsetReached(body) {
  const reasons = [];
  if (/\bmodel\s*:/.test(body)) reasons.push('native agent() calls now carry a model');
  if (/typeof args === "object"/.test(body)) reasons.push('native args now accept an object (a model map can be passed)');
  return reasons;
}

export function rebuild(body, version) {
  let s = body;
  if (s.split(QUESTION_LINE).length !== 2) throw new Error(`anchor not found exactly once: ${QUESTION_LINE}`);
  s = s.replace(QUESTION_LINE, QUESTION_REPLACEMENT);
  for (const [from, to] of PINS) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`anchor matched ${n} times, expected 1: ${JSON.stringify(from)}`);
    s = s.replace(from, to);
  }
  return META(version, sha256(body)) + s;
}

function parseArgs(argv) {
  const out = { json: false };
  for (const a of argv) {
    if (a.startsWith('--binary=')) out.binary = a.slice(9);
    else if (a.startsWith('--baseline=')) out.baseline = a.slice(11);
    else if (a.startsWith('--rebuild=')) out.rebuild = a.slice(10);
    else if (a === '--json') out.json = true;
    else { console.error(`unknown argument: ${a}`); process.exit(3); }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const binary = locateBinary(opts.binary);
  const report = { binary, version: binary ? versionOf(binary) : null, baseline: opts.baseline || BASELINE.sha256, baselineVersion: BASELINE.version };
  const emit = (status, verdict, detail) => {
    Object.assign(report, { status, verdict, detail });
    if (opts.json) console.log(JSON.stringify(report));
    else console.log(`deep-research upstream: ${verdict}${detail ? ` (${detail})` : ''}`);
    process.exit(status);
  };
  if (!binary) emit(1, 'binary not found', 'pass --binary=<path> or set CLAUDE_BINARY');
  const body = extractNativeBody(readFileSync(binary));
  if (!body) emit(1, 'bundled deep-research script not found in binary', `${binary}; the workflow may have moved or been removed, which is itself a reason to revisit the fork`);
  report.sha256 = sha256(body);
  const reasons = sunsetReached(body);
  if (reasons.length) emit(2, 'SUNSET: delete the fork and run the bundled workflow by name', reasons.join('; '));
  if (opts.rebuild) {
    try {
      writeFileSync(opts.rebuild, rebuild(body, report.version));
      report.rebuilt = opts.rebuild;
    } catch (e) { emit(3, 'rebuild refused', e.message); }
  }
  if (report.sha256 !== report.baseline) {
    emit(1, `native script drifted since ${BASELINE.version}`, `installed ${report.version} sha256 ${report.sha256.slice(0, 12)}; ${opts.rebuild ? `fork rebuilt at ${opts.rebuild}; ` : 'rerun with --rebuild=<out.js>; '}then record the new sha in BASELINE`);
  }
  emit(0, `native script unchanged since ${BASELINE.version}`, opts.rebuild ? `fork rebuilt at ${opts.rebuild}` : `installed ${report.version}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) main();
