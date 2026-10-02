#!/usr/bin/env node
// check-upstreams.mjs: walk the pins in scripts/upstream-pins.json and say
// which REUSE and BORROW rows of docs/handbook/upstreams.md have moved
// upstream since they were consulted, so staying current is a deliberate,
// diffable act rather than a glance at the ledger at the quarterly trim.
//
// A branch pin compares the remote's branch head to the recorded sha. A tag
// pin lists the remote's tags and reports any that sorts newer by version
// than the pinned one (a prerelease counts only when its numbers are higher).
// The checker reports and never merges: a moved BORROW row is a review of the
// named paths, a moved REUSE row is a re-vendor at the new version.
//
// Usage:
//   node scripts/check-upstreams.mjs [--json] [--only=<upstream substring>] [--pins=<path>]
//
// Exit codes (read the verdict by name, never "non-zero = bad"):
//   0  every walked row unchanged since its pin
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
  const m = /^v?(\d+(?:\.\d+)*)(?:[-+.]?([0-9A-Za-z.-]+))?$/.exec(tag);
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

export function remoteTags(remote) {
  const out = execFileSync('git', ['ls-remote', '--tags', remote], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  return parseTagRefs(out);
}

/** What a reader does about a moved row: a BORROW is a review, a REUSE is a re-vendor. */
export function actionFor(pin) {
  return pin.relationship === 'REUSE' ? 're-vendor at the new version' : `review these paths: ${pin.paths.join(' ')}`;
}

/** One row's verdict: unchanged, moved, or unreadable, never a guess. */
export function checkPin(pin) {
  const row = { upstream: pin.upstream, relationship: pin.relationship, remote: pin.remote, ref: pin.ref, consulted: pin.consulted, sha: pin.sha, paths: pin.paths, recheck: pin.recheck ?? null, watchedBy: pin.watchedBy ?? null };
  const label = pin.ref.tag ?? pin.sha.slice(0, 7);
  try {
    if (pin.ref.branch) {
      const head = remoteHead(pin.remote, pin.ref.branch);
      if (head === pin.sha) return { ...row, status: 'unchanged', pinned: label, current: head.slice(0, 7) };
      return { ...row, status: 'moved', pinned: label, current: head.slice(0, 7), head, action: actionFor(pin) };
    }
    const tags = remoteTags(pin.remote);
    if (!tags.has(pin.ref.tag)) return { ...row, status: 'unreadable', pinned: label, detail: `pinned tag ${pin.ref.tag} is not on the remote` };
    const newer = newerTags([...tags.keys()], pin.ref.tag);
    if (newer.length === 0) return { ...row, status: 'unchanged', pinned: label, current: pin.ref.tag };
    return { ...row, status: 'moved', pinned: label, current: newer[0], head: tags.get(newer[0]), newer, action: actionFor(pin) };
  } catch (e) {
    return { ...row, status: 'unreadable', pinned: label, detail: (e.stderr?.toString() || e.message).trim().split('\n')[0] };
  }
}

export function lineFor(r) {
  const head = `${r.status.padEnd(10)} ${r.upstream} [${r.relationship}]`;
  if (r.status === 'unchanged') return `${head} at ${r.current}`;
  if (r.status === 'moved') return `${head} pinned ${r.pinned}, current ${r.current}; ${r.action}`;
  return `${head} pinned ${r.pinned}; ${r.detail}`;
}

function main() {
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
  report.rows = pins.map(checkPin);
  const count = (s) => report.rows.filter((r) => r.status === s).length;
  const tally = `${count('moved')} moved, ${count('unchanged')} unchanged, ${count('unreadable')} unreadable, of ${report.rows.length}`;
  if (count('unreadable') > 0) emit(3, 'some upstreams could not be read', tally);
  if (count('moved') > 0) emit(1, 'some upstreams moved', tally);
  emit(0, 'every upstream unchanged since its pin', tally);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
