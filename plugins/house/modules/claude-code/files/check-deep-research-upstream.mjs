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
// The fork also replaces the native's fixed fan-out (3 votes x 25 claims, a
// fetch cap that high-relevance results bypass) with a depth preset the
// caller picks per question: args.depth "light" | "standard" | "deep", any
// field overridable via args.budget. This tool keeps that fork honest without
// vendoring Anthropic's script text into a repo: it reads the script out of
// the locally installed binary.
//
// Usage:
//   node scripts/house/check-deep-research-upstream.mjs [--binary=<path>] [--baseline=<sha256>] [--json]
//   node scripts/house/check-deep-research-upstream.mjs --rebuild=<out.js> [--force] [--binary=<path>]
//
// Exit codes (the three-way contract a caller must read, never "non-zero = bad"):
//   0  native script unchanged since the recorded baseline; keep the fork
//   1  native script drifted, or no binary/no bundled script was found; re-derive the fork with --rebuild
//   2  SUNSET: the native workflow now sets per-agent models or reads a per-stage model map; delete the fork
//   3  bad argument, or a --rebuild failure (an anchor the pins rely on no longer matches exactly once)
//
// The binary locator assumes a POSIX shell and an XDG-style install layout
// (`sh -c 'command -v claude'`, `~/.local/share/claude/versions/`), so it does
// not resolve an install on Windows. An npm-global install names its binary
// with no version in the filename, so versionOf() reports it as "unknown"
// rather than guessing wrong.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
// The four fan-out constants the fork replaces with a depth-scaled budget.
// Native fixes them, so every non-trivial question costs the same ~110
// agents: 3 votes x 25 claims is 75 verifiers whatever the question, and the
// fetch cap only binds medium/low relevance, so high-relevance hits overshoot
// it (28 fetched against a cap of 15 on 2026-09-18). The block must match
// exactly once or the rebuild refuses, like the model pins.
export const BUDGET_LINE = 'const VOTES_PER_CLAIM = 3\nconst REFUTATIONS_REQUIRED = 2\nconst MAX_FETCH = 15\nconst MAX_VERIFY_CLAIMS = 25\n';
const BUDGET_REPLACEMENT = `const ARGS_OBJ = (args && typeof args === "object" && !Array.isArray(args)) ? args : {}
// Depth presets scale the fan-out to the question. Agents ~= 1 + angles +
// fetched + votes * verified + 1: light ~35, standard ~70, deep ~130 (native
// is ~110 on every question). Pick via args.depth; override any field via
// args.budget. fetchOverflow is how far past maxFetch a high-relevance result
// may still be fetched; native lets it run unbounded.
const DEPTH_PRESETS = {
  light: { maxFetch: 8, fetchOverflow: 2, maxVerifyClaims: 8, votes: 2, refutationsRequired: 2 },
  standard: { maxFetch: 15, fetchOverflow: 5, maxVerifyClaims: 15, votes: 3, refutationsRequired: 2 },
  deep: { maxFetch: 25, fetchOverflow: 8, maxVerifyClaims: 30, votes: 3, refutationsRequired: 2 },
}
const DEPTH = Object.prototype.hasOwnProperty.call(DEPTH_PRESETS, ARGS_OBJ.depth) ? ARGS_OBJ.depth : "standard"
const BUDGET = Object.assign({}, DEPTH_PRESETS[DEPTH], ARGS_OBJ.budget || {})
for (const k of Object.keys(DEPTH_PRESETS.standard)) {
  if (!Number.isInteger(BUDGET[k]) || BUDGET[k] < 0) return { error: "args.budget." + k + " must be a non-negative integer, got " + JSON.stringify(BUDGET[k]) }
}
if (BUDGET.votes < 1 || BUDGET.refutationsRequired < 1 || BUDGET.refutationsRequired > BUDGET.votes) {
  return { error: "args.budget: need 1 <= refutationsRequired <= votes, got votes=" + BUDGET.votes + " refutationsRequired=" + BUDGET.refutationsRequired }
}
const VOTES_PER_CLAIM = BUDGET.votes
const REFUTATIONS_REQUIRED = BUDGET.refutationsRequired
const MAX_FETCH = BUDGET.maxFetch
const MAX_VERIFY_CLAIMS = BUDGET.maxVerifyClaims
log("Depth: " + DEPTH + " (fetch<=" + (MAX_FETCH + BUDGET.fetchOverflow) + ", verify<=" + MAX_VERIFY_CLAIMS + " claims x " + VOTES_PER_CLAIM + " votes; at most ~" + (7 + MAX_FETCH + BUDGET.fetchOverflow + MAX_VERIFY_CLAIMS * VOTES_PER_CLAIM) + " agents)")
`;
// The fetch budget's bypass: native lets any high-relevance result through
// once the slots are spent, so the cap is soft. The fork bounds the overshoot.
export const FETCH_BYPASS_LINE = '      if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {\n';
const FETCH_BYPASS_REPLACEMENT = '      if (fetchSlots <= 0 && (relRank[r.relevance] >= 1 || fetchSlots <= -BUDGET.fetchOverflow)) {\n';

const QUESTION_LINE = 'const QUESTION = (typeof args === "string" && args.trim()) || ""';
const QUESTION_REPLACEMENT = `const QUESTION = (typeof args === "string" && args.trim()) || (typeof ARGS_OBJ.question === "string" && ARGS_OBJ.question.trim()) || ""
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
  description: 'Deep research harness with per-stage model pins and a depth-scaled budget: fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.',
  whenToUse: 'House fork of the bundled deep-research workflow (Claude Code ${version}, native body sha256 ${sha.slice(0, 12)}). Run by scriptPath. args: a question string, or {question, depth: "light" | "standard" | "deep", models: {scope, search, fetch, verify, synthesize}, budget: {maxFetch, fetchOverflow, maxVerifyClaims, votes, refutationsRequired}}. Retire when check-deep-research-upstream.mjs exits 2.',
  phases: [{"title":"Scope","detail":"Decompose question (from args) into 5 search angles"},{"title":"Search","detail":"5 parallel WebSearch agents, one per angle"},{"title":"Fetch","detail":"URL-dedup, fetch the top sources the depth allows, extract falsifiable claims"},{"title":"Verify","detail":"Adversarial vote per claim, count and quorum set by the depth"},{"title":"Synthesize","detail":"Merge semantic dupes, rank by confidence, cite sources"}],
}

`;

export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

/**
 * Find the installed Claude Code binary: --binary, $CLAUDE_BINARY, `claude` on
 * PATH, else the newest versions/ entry. An explicit --binary is never mixed
 * into the fallback chain: given and invalid, it throws rather than silently
 * reporting on a different binary.
 */
export function locateBinary(explicit) {
  if (explicit !== undefined) {
    let isFile = false;
    try { isFile = statSync(explicit).isFile(); } catch { /* not found */ }
    if (!isFile) throw new Error(`--binary path is not a readable file: ${explicit}`);
    return explicit;
  }
  const candidates = [];
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

// A model-map read on args: `args.models`, `args?.models`, `args["models"]`,
// or a `{ models }` destructure off args. Reading merely `typeof args ===
// "object"` proves nothing by itself: the Workflow tool has always accepted
// object args, so that alone cannot signal a native model pin.
const MODEL_MAP_READ = /\bargs\s*\??\.\s*models\b|\bargs\s*\[\s*(['"])models\1\s*\]|\{[^{}]*\bmodels\b[^{}]*\}\s*=\s*args\b/;

/**
 * Slice out just the five agent() option-object regions the PINS anchors
 * locate, keyed on each pin's SCHEMA constant at its call site (`schema:
 * X_SCHEMA`, not the `const X_SCHEMA =` definition). Works whether or not a
 * `model:` property has already been added, which is exactly what
 * sunsetReached needs to check without a false hit from a prose "model:" in a
 * prompt string elsewhere in the body.
 */
function agentOptionRegions(body) {
  const regions = [];
  for (const [from] of PINS) {
    const schemaName = from.match(/([A-Z][A-Z0-9_]*_SCHEMA)/)?.[1];
    if (!schemaName) continue;
    const anchor = new RegExp(`schema\\s*:\\s*${schemaName}\\b`).exec(body);
    if (!anchor) continue;
    const open = body.lastIndexOf('{', anchor.index);
    const close = body.indexOf('}', anchor.index);
    if (open < 0 || close < 0) continue;
    regions.push(body.slice(open, close + 1));
  }
  return regions;
}

/** True when the native workflow no longer needs the fork. */
export function sunsetReached(body) {
  const reasons = [];
  if (agentOptionRegions(body).some((region) => /\bmodel\s*:/.test(region))) {
    reasons.push('native agent() calls now carry a model');
  }
  if (/typeof args === "object"/.test(body) && MODEL_MAP_READ.test(body)) {
    reasons.push('native args now read a per-stage model map (args.models)');
  }
  return reasons;
}

export function rebuild(body, version) {
  let s = body;
  // Order matters: the budget block defines ARGS_OBJ, which the question
  // replacement reads, and both sit above the first use in the native body.
  for (const [from, to] of [[BUDGET_LINE, BUDGET_REPLACEMENT], [FETCH_BYPASS_LINE, FETCH_BYPASS_REPLACEMENT], [QUESTION_LINE, QUESTION_REPLACEMENT]]) {
    if (s.split(from).length !== 2) throw new Error(`anchor not found exactly once: ${from.trim().split('\n')[0]}`);
    s = s.replace(from, to);
  }
  for (const [from, to] of PINS) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`anchor matched ${n} times, expected 1: ${JSON.stringify(from)}`);
    s = s.replace(from, to);
  }
  return META(version, sha256(body)) + s;
}

function parseArgs(argv) {
  const out = { json: false, force: false };
  for (const a of argv) {
    if (a.startsWith('--binary=')) out.binary = a.slice(9);
    else if (a.startsWith('--baseline=')) out.baseline = a.slice(11);
    else if (a.startsWith('--rebuild=')) out.rebuild = a.slice(10);
    else if (a === '--json') out.json = true;
    else if (a === '--force') out.force = true;
    else { console.error(`unknown argument: ${a}`); process.exit(3); }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = { binary: null, version: null, baseline: opts.baseline || BASELINE.sha256, baselineVersion: BASELINE.version };
  const emit = (status, verdict, detail) => {
    Object.assign(report, { status, verdict, detail });
    if (opts.json) console.log(JSON.stringify(report));
    else console.log(`deep-research upstream: ${verdict}${detail ? ` (${detail})` : ''}`);
    process.exit(status);
  };
  let binary;
  try {
    binary = locateBinary(opts.binary);
  } catch (e) { report.binary = opts.binary; emit(3, 'invalid --binary', e.message); }
  report.binary = binary;
  report.version = binary ? versionOf(binary) : null;
  if (!binary) emit(1, 'binary not found', 'pass --binary=<path> or set CLAUDE_BINARY');
  const body = extractNativeBody(readFileSync(binary));
  if (!body) emit(1, 'bundled deep-research script not found in binary', `${binary}; the workflow may have moved or been removed, which is itself a reason to revisit the fork`);
  report.sha256 = sha256(body);
  const reasons = sunsetReached(body);
  if (reasons.length) emit(2, 'SUNSET: delete the fork and run the bundled workflow by name', reasons.join('; '));
  if (opts.rebuild) {
    if (existsSync(opts.rebuild) && !opts.force) {
      emit(3, 'rebuild refused', `refusing to overwrite an existing file without --force: ${opts.rebuild}`);
    }
    try {
      mkdirSync(dirname(opts.rebuild), { recursive: true });
      writeFileSync(opts.rebuild, rebuild(body, report.version));
      report.rebuilt = opts.rebuild;
    } catch (e) { emit(3, 'rebuild refused', e.message); }
  }
  if (report.sha256 !== report.baseline) {
    emit(1, `native script drifted since ${BASELINE.version}`, `installed ${report.version} sha256 ${report.sha256.slice(0, 12)}; ${opts.rebuild ? `fork rebuilt at ${opts.rebuild}; ` : 'rerun with --rebuild=<out.js>; '}then record the new sha in BASELINE`);
  }
  emit(0, `native script unchanged since ${BASELINE.version}`, opts.rebuild ? `fork rebuilt at ${opts.rebuild}` : `installed ${report.version}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
