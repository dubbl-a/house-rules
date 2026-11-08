#!/usr/bin/env node
// check-upstreams.mjs: walk the pins in scripts/upstream-pins.json and say
// which REUSE and BORROW rows of docs/handbook/upstreams.md have moved
// upstream since they were consulted, so staying current is a deliberate,
// diffable act rather than a glance at the ledger at the quarterly trim.
//
// A branch pin compares the remote's branch head to the recorded sha. A tag
// pin lists the remote's tags, reports the pinned tag itself as moved when its
// peeled target (refs/tags/<tag>^{}, or the bare ref for a lightweight tag) is
// no longer the recorded sha, and reports any tag that sorts newer by version
// than the pinned one (a prerelease counts only when its numbers are higher).
// The checker reports and never merges: a moved BORROW row is a review of the
// named paths, a moved REUSE row is a re-vendor at the new version.
//
// A moved github.com row is then narrowed by the GitHub compare API: it counts
// as moved only when a file under one of its watched paths changed between the
// pin and the new head, and the report lists those files and a compare URL. A
// row whose every changed file lies outside its watched paths is the quiet
// verdict `moved-unwatched`. Anything that stops the path check from proving
// "nothing watched changed" keeps the row `moved` (the fail-safe direction): an
// API error or rate limit, a compare that is not a plain fast-forward from the
// pin (force-push, unrelated pin), a file list at GitHub's 300-file cap or empty,
// a non-github remote, a row with no usable paths. GH_TOKEN (or GITHUB_TOKEN)
// is sent to api.github.com only, to lift the unauthenticated rate limit.
//
// Usage:
//   node scripts/check-upstreams.mjs [--json] [--only=<upstream substring>] [--pins=<path>]
//
// Exit codes (read the verdict by name, never "non-zero = bad"):
//   0  every walked row unchanged since its pin, or moved only outside its
//      watched paths (`moved-unwatched`, printed but not counted as moved)
//   1  at least one row moved; each moved row prints what to do about it
//   3  bad argument, a pins file that does not parse, an --only that matches
//      nothing, or a row that could not be read (no network, wrong url, the
//      pinned tag gone); this is not "unchanged", and any moved rows still print
//
// Needs network and a `git` on PATH, so it stays outside `npm run verify`;
// the weekly upstream-watch workflow runs it beside the kit checker.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { remoteHead } from './check-orchestration-kit-upstream.mjs';

export const PINS_PATH = fileURLToPath(new URL('./upstream-pins.json', import.meta.url));

export function parseArgs(argv) {
  const out = { pins: PINS_PATH, json: false, only: null };
  for (const a of argv) {
    if (a.startsWith('--pins=')) out.pins = a.slice(7);
    else if (a.startsWith('--only=')) out.only = a.slice(7);
    else if (a === '--json') out.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.pins) throw new Error('--pins must not be empty');
  if (out.only === '') throw new Error('--only must not be empty');
  return out;
}

/** The parsed pins file, or a thrown error naming the first bad entry. */
export function loadPins(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`pins file does not parse: ${e.message}`); }
  const pins = data?.pins;
  if (!Array.isArray(pins) || pins.length === 0) throw new Error('pins file has no pins array, or it is empty');
  for (const [i, p] of pins.entries()) {
    const at = `pins[${i}] (${p?.upstream ?? 'no upstream'})`;
    if (typeof p?.upstream !== 'string' || !p.upstream) throw new Error(`${at}: upstream must be the ledger row's Upstream cell`);
    if (p.relationship !== 'REUSE' && p.relationship !== 'BORROW') throw new Error(`${at}: relationship must be REUSE or BORROW`);
    if (typeof p.remote !== 'string' || !p.remote) throw new Error(`${at}: remote must be a git url or path`);
    const keys = Object.keys(p.ref ?? {});
    if (keys.length !== 1 || !['branch', 'tag'].includes(keys[0]) || typeof p.ref[keys[0]] !== 'string' || !p.ref[keys[0]]) throw new Error(`${at}: ref must be exactly one of { "branch" } or { "tag" }`);
    if (!/^[0-9a-f]{40}$/.test(p.sha ?? '')) throw new Error(`${at}: sha must be a full 40-character commit sha`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.consulted ?? '')) throw new Error(`${at}: consulted must be a YYYY-MM-DD date`);
    if (!Array.isArray(p.paths) || p.paths.length === 0) throw new Error(`${at}: paths must name what to review`);
  }
  return { pins, unpinned: data.unpinned ?? [] };
}

/** Numeric version parts and a prerelease flag, or null for a non-version tag. */
function versionOf(tag) {
  const m = /^(?:[A-Za-z]{1,10}-)?v?(\d+(?:\.\d+)+)(?:[-+.]?([0-9A-Za-z.-]+))?$/.exec(tag);
  if (!m) return null;
  return { nums: m[1].split('.').map(Number), pre: Boolean(m[2]) };
}

/** >0 when a sorts after b, <0 before, 0 equal; null when either is not a version. */
export function compareVersions(a, b) {
  const va = versionOf(a);
  const vb = versionOf(b);
  if (!va || !vb) return null;
  const n = Math.max(va.nums.length, vb.nums.length);
  for (let i = 0; i < n; i++) {
    const d = (va.nums[i] ?? 0) - (vb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  return (va.pre ? 0 : 1) - (vb.pre ? 0 : 1);
}

/** Version tags newer than the pinned one, newest first. */
export function newerTags(tags, pinnedTag) {
  return tags.filter((t) => (compareVersions(t, pinnedTag) ?? 0) > 0).sort((a, b) => compareVersions(b, a));
}

/** `git ls-remote --tags` output as tag name to commit sha, peeled where annotated. */
export function parseTagRefs(out) {
  const tags = new Map();
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (!m) continue;
    if (m[3] || !tags.has(m[2])) tags.set(m[2], m[1]);
  }
  return tags;
}

/** `git ls-remote --tags` output as tag name to the tag's own ref sha (the tag object when annotated). */
export function parseTagObjects(out) {
  const objs = new Map();
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(.+)$/.exec(line.trim());
    if (m && !m[2].endsWith('^{}')) objs.set(m[2], m[1]);
  }
  return objs;
}

function lsRemoteTags(remote) {
  return execFileSync('git', ['ls-remote', '--tags', remote], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
}

export function remoteTags(remote) {
  return parseTagRefs(lsRemoteTags(remote));
}

/** What a reader does about a moved row: a BORROW is a review, a REUSE is a re-vendor. */
export function actionFor(pin) {
  return pin.relationship === 'REUSE' ? 're-vendor at the new version' : `review these paths: ${Array.isArray(pin.paths) && pin.paths.length > 0 ? pin.paths.join(' ') : '(none named)'}`;
}

/** owner and repo of a plain github.com https remote, or null for any other remote. */
export function parseGithubRemote(remote) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote ?? '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

function compareUrlFor(remote, base, head) {
  const gh = parseGithubRemote(remote);
  return gh && FULL_SHA.test(base ?? '') && FULL_SHA.test(head ?? '') ? `https://github.com/${gh.owner}/${gh.repo}/compare/${base}...${head}` : null;
}

/** True when file is the watched path or lies under it; a directory matches by whole path segment, so `a/b` never matches `a/bc`. A path that cannot be read as one throws, which keeps the row moved. */
export function pathMatches(file, path) {
  if (typeof path !== 'string') throw new Error('a watched path is not a string');
  const dir = path.replace(/^(\.?\/)+/, '').replace(/\/+$/, '');
  if (dir === '' || dir === '.') return true;
  return file === dir || file.startsWith(`${dir}/`);
}

// GitHub lists at most 300 files for a compare, 100 a page.
const COMPARE_PAGE = 100;
const COMPARE_FILE_CAP = 300;

/** Files changed between base and head from the GitHub compare API (a rename lists both names), as { files, truncated }; throws unless the pin is a plain ancestor of head. */
export async function compareFiles(remote, base, head, { fetchFn = globalThis.fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) {
  const gh = parseGithubRemote(remote);
  if (!gh) throw new Error('not a github.com remote, so no compare API');
  if (!FULL_SHA.test(base ?? '') || !FULL_SHA.test(head ?? '')) throw new Error('compare needs two full shas');
  const files = [];
  for (let page = 1; page <= COMPARE_FILE_CAP / COMPARE_PAGE; page++) {
    const res = await fetchFn(`https://api.github.com/repos/${gh.owner}/${gh.repo}/compare/${base}...${head}?per_page=${COMPARE_PAGE}&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'house-rules-check-upstreams', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`compare API answered HTTP ${res.status}${res.status === 403 || res.status === 429 ? ' (rate limit or access)' : ''}`);
    const body = await res.json();
    if (body?.status !== 'ahead') throw new Error(`compare status is ${JSON.stringify(body?.status)}, not a fast-forward from the pin`);
    if (!Array.isArray(body.files)) throw new Error('compare response has no files list');
    for (const f of body.files) {
      if (typeof f?.filename !== 'string') throw new Error('compare response has a file with no name');
      files.push(f.filename);
      if (typeof f.previous_filename === 'string') files.push(f.previous_filename);
    }
    if (body.files.length < COMPARE_PAGE) return { files, truncated: false };
  }
  // Three full pages: the list is at GitHub's cap, so more files may exist unseen.
  return { files, truncated: true };
}

/** Narrow a moved row by its watched paths: `moved` with the changed files when one changed or nothing proves otherwise, `moved-unwatched` only when the compare proves none did. */
async function narrowMove(moved, pin, compare) {
  const compareUrl = compareUrlFor(pin.remote, pin.sha, moved.head);
  const row = compareUrl ? { ...moved, compareUrl } : moved;
  try {
    if (!Array.isArray(pin.paths) || pin.paths.length === 0) throw new Error('the row names no watched paths');
    const { files, truncated } = await compare(pin.remote, pin.sha, moved.head);
    if (truncated) throw new Error(`the compare file list is truncated (GitHub caps it at ${COMPARE_FILE_CAP} files)`);
    if (!Array.isArray(files) || files.length === 0) throw new Error('the compare lists no files');
    const changed = [...new Set(files.filter((f) => pin.paths.some((p) => pathMatches(f, p))))];
    if (changed.length > 0) return { ...row, pathCheck: 'changed', changed };
    return { ...row, status: 'moved-unwatched', pathCheck: 'unchanged', otherFiles: new Set(files).size, action: undefined };
  } catch (e) {
    return { ...row, pathCheck: 'unprovable', pathCheckDetail: (e.message || String(e)).trim().split('\n')[0] };
  }
}

/** One row's verdict: unchanged, moved, moved-unwatched, or unreadable, never a guess. */
export async function checkPin(pin, { compare = compareFiles } = {}) {
  const row = { upstream: pin.upstream, relationship: pin.relationship, remote: pin.remote, ref: pin.ref, consulted: pin.consulted, sha: pin.sha, paths: pin.paths, recheck: pin.recheck ?? null, watchedBy: pin.watchedBy ?? null };
  const label = pin.ref.tag ?? pin.sha.slice(0, 7);
  let moved;
  try {
    if (pin.ref.branch) {
      const head = remoteHead(pin.remote, pin.ref.branch);
      if (head === pin.sha) return { ...row, status: 'unchanged', pinned: label, current: head.slice(0, 7) };
      moved = { ...row, status: 'moved', pinned: label, current: head.slice(0, 7), head, action: actionFor(pin) };
    } else {
      const out = lsRemoteTags(pin.remote);
      const tags = parseTagRefs(out);
      if (!tags.has(pin.ref.tag)) return { ...row, status: 'unreadable', pinned: label, detail: `pinned tag ${pin.ref.tag} is not on the remote` };
      const newer = newerTags([...tags.keys()], pin.ref.tag);
      const target = tags.get(pin.ref.tag);
      // A pin may record an annotated tag's own object sha rather than its commit.
      if (target !== pin.sha && parseTagObjects(out).get(pin.ref.tag) !== pin.sha) moved = { ...row, status: 'moved', pinned: label, current: `tag ${pin.ref.tag} moved to ${target.slice(0, 7)}`, head: target, newer, action: actionFor(pin) };
      else if (newer.length === 0) return { ...row, status: 'unchanged', pinned: label, current: pin.ref.tag };
      else moved = { ...row, status: 'moved', pinned: label, current: newer[0], head: tags.get(newer[0]), newer, action: actionFor(pin) };
    }
  } catch (e) {
    return { ...row, status: 'unreadable', pinned: label, detail: (e.stderr?.toString() || e.message).trim().split('\n')[0] };
  }
  return narrowMove(moved, pin, compare);
}

const SHOWN_FILES = 8;

export function lineFor(r) {
  const head = `${r.status.padEnd(15)} ${r.upstream} [${r.relationship}]`;
  if (r.status === 'unchanged') return `${head} at ${r.current}`;
  const link = r.compareUrl ? `; compare ${r.compareUrl}` : '';
  if (r.status === 'moved-unwatched') return `${head} pinned ${r.pinned}, current ${r.current}; no watched path changed (${r.otherFiles} other file${r.otherFiles === 1 ? '' : 's'} did)${link}`;
  if (r.status === 'moved') {
    const why = r.changed ? `changed: ${r.changed.slice(0, SHOWN_FILES).join(' ')}${r.changed.length > SHOWN_FILES ? ` (+${r.changed.length - SHOWN_FILES} more)` : ''}` : `path check could not prove otherwise: ${r.pathCheckDetail}`;
    return `${head} pinned ${r.pinned}, current ${r.current}; ${r.action}; ${why}${link}`;
  }
  return `${head} pinned ${r.pinned}; ${r.detail}`;
}

/** The exit status, verdict, and tally for a set of rows; unreadable outranks moved, and moved-unwatched counts as neither. */
export function summarize(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const tally = `${count('moved')} moved, ${count('moved-unwatched')} moved outside watched paths, ${count('unchanged')} unchanged, ${count('unreadable')} unreadable, of ${rows.length}`;
  if (count('unreadable') > 0) return { status: 3, verdict: 'some upstreams could not be read', tally };
  if (count('moved') > 0) return { status: 1, verdict: 'some upstreams moved', tally };
  if (count('moved-unwatched') > 0) return { status: 0, verdict: 'no watched path changed since a pin (some upstreams moved elsewhere)', tally };
  return { status: 0, verdict: 'every upstream unchanged since its pin', tally };
}

async function main() {
  const report = { pins: null, status: null, verdict: null, rows: [] };
  let opts;
  const emit = (status, verdict, detail) => {
    Object.assign(report, { status, verdict, detail });
    if (opts?.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      for (const r of report.rows) process.stdout.write(`${lineFor(r)}\n`);
      process.stdout.write(`upstreams: ${verdict}${detail ? ` (${detail})` : ''}\n`);
    }
    process.exit(status);
  };
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { emit(3, 'bad argument', e.message); }
  report.pins = opts.pins;
  let pins;
  try { ({ pins } = loadPins(readFileSync(opts.pins, 'utf8'))); } catch (e) { emit(3, 'pins file unreadable', e.message); }
  if (opts.only) pins = pins.filter((p) => p.upstream.includes(opts.only));
  if (pins.length === 0) emit(3, 'no pin matches --only', opts.only);
  // One row at a time: each moved row makes a compare call, and the walk is small.
  for (const p of pins) report.rows.push(await checkPin(p));
  const { status, verdict, tally } = summarize(report.rows);
  emit(status, verdict, tally);
}

// An uncaught rejection would exit 1, which this checker reserves for "a row moved".
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main().catch((e) => { process.stderr.write(`check-upstreams: ${e.stack || e}\n`); process.exit(3); });
