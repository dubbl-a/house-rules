#!/usr/bin/env node
// scripts/house/scan-dist-secrets.mjs
//
// The house content scanner. It began as the built-output check and grew two
// git modes (#402), so the name no longer says everything it does; it stays
// because adopters and their workflows already reference it.
//
// Dist mode (default): second, independent layer against a secret reaching a
// published static build output. Scans the built output directory for secret
// material and fails if it finds any, regardless of whether env-stripping
// earlier in the build missed something.
//
// Git modes, the fallback where the plan refuses push protection:
//   --staged   scan the index content of staged added/modified files; meant
//              for a pre-commit hook. Reads blobs, never the working tree.
//   --history  scan every blob any commit on any ref added or changed, and
//              name the commit (the earliest by commit date) and path of each
//              hit. One `git log` pass plus one `git cat-file --batch` stream
//              with each blob read once, so the cost is linear in history
//              size. Also reads a blob a tag points at directly. Refuses a
//              shallow clone.
//   --history --rev=<rev>
//              scan only the history reachable from <rev> instead of every ref
//              (a blob only a tag points at is then out of scope). The allowlist
//              is read from the checkout, so CI passes --rev=HEAD: the scan
//              judges exactly the history the checked-out commit carries, and a
//              waiver that lives only on another branch cannot fail it (#431).
//   Both apply RULES (named key formats) plus the vars-file and --patterns
//   markers, minus the allowlist: .house/secret-allow, one
//   `<path-glob> <rule-name>  # reason` per line (the reason is required and
//   each applied waiver is printed). --staged reads the allowlist from the
//   index. In the git modes a vars-file value that is one plain word or a bare
//   number is not a marker, and a URL contributes its password, not its
//   hostname. CI has no .dev.vars, so those markers act in a local hook only.
//   Binary blobs and blobs over MAX_BLOB_BYTES are skipped and counted. A git
//   error or unreadable blob is an error, never a pass.
//   What it misses against a broad scanner: any key format not in RULES, a
//   secret with no recognisable prefix, base64 or otherwise encoded content
//   (URL-encoded and \n-escaped keys are matched), a key split across lines,
//   and (known gap) a tag on a tree; a tag chain is followed only as far as
//   the installed git's %(*objecttype) peels it.
//
// Dist-mode markers:
//   - every value in a vars file (--vars-file=<path>, default .dev.vars) that
//     is at least MIN_MARKER_LENGTH characters. Values that parse as a URL
//     (a connection string) also contribute their password and hostname as
//     separate markers, so a reformatted or partially interpolated
//     connection string still trips the scan.
//   - unconditional patterns that need no vars file at all, so the scan
//     still means something with no secrets configured (a fresh worktree,
//     most of CI): postgres://, postgresql://, sk-ant-.
//   - extra patterns supplied by the caller, so this file never needs
//     editing to add a project-specific marker (see --patterns / env below).
//
// Usage:
//   node scan-dist-secrets.mjs [--dist-dir=dist] [--vars-file=.dev.vars]
//                               [--patterns=path/to/patterns.json]
//   node scan-dist-secrets.mjs --staged|--history [--repo=<path>]
//                               [--vars-file=...] [--patterns=...]
//                               [--rev=<rev>]  (--history only)
//   node scan-dist-secrets.mjs --self-test
//
// Exit: 0 clean, 1 a hit, 2 an error (git failure, unreadable blob, bad
// allowlist line).
//
// Extra patterns, two ways (composable, both optional):
//   --patterns=<path>            JSON file: an array of either plain strings
//                                 or {"name": "...", "value": "..."} objects.
//   SCAN_DIST_SECRETS_PATTERNS   comma-separated literal substrings in an
//                                 env var, for a one-off addition with no file.
//
// A hit prints the offending file path (and the commit, in --history) and the
// marker or rule NAME (the vars-file key, e.g. "DATABASE_URL:password", the
// built-in literal, e.g. "postgres://", the rule, e.g. "github-token", or for
// a caller pattern "pattern#<position>" or its object name) — never the value
// that matched.

import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// This file is vendored to <repo>/scripts/house/scan-dist-secrets.mjs, two
// directories below the repo root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIN_MARKER_LENGTH = 8;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const ALLOW_FILE = '.house/secret-allow';

const UNCONDITIONAL_PATTERNS = [
  { name: 'postgres://', value: 'postgres://' },
  { name: 'postgresql://', value: 'postgresql://' },
  { name: 'sk-ant-', value: 'sk-ant-' },
];

// Named key formats for the git modes. Each anchors on a vendor prefix and a
// length so ordinary prose and hashes do not trip it. Each starts on START
// rather than \b, which an underscore defeats: a token may follow a non-
// alphanumeric (token_<key>), a %XX URL-encoded byte (token%3D<key>), or a
// literal \n, \r or \t escape inside a quoted string. Add a rule here and a
// canary to CANARIES below; --self-test fails for a rule with no canary.
const START = String.raw`(?:(?<![A-Za-z0-9])|(?<=%[0-9A-Fa-f]{2})|(?<=\\[nrt]))`;
const rule = (name, source) => ({ name, re: new RegExp(source.replaceAll('<S>', START)) });
export const RULES = [
  rule('aws-access-key-id', String.raw`<S>(?:AKIA|ASIA)(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}(?![A-Za-z0-9])`),
  rule('github-token', String.raw`<S>(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{70,})`),
  // First numeric segment is 8+ digits (xoxb, xoxp, xoxs); xoxa-2- and
  // xoxe-1- put a one-digit version first and a long token after it.
  rule('slack-token', String.raw`<S>xox[abposre]-(?:\d{8,}(?:-\d+){0,2}|\d-\d{8,}(?:-\d+){0,2}|\d(?=-[A-Za-z0-9]{40,}))-[A-Za-z0-9]{10,}`),
  rule('stripe-live-key', String.raw`<S>[sr]k_live_[0-9A-Za-z]{24,}`),
  rule('google-api-key', String.raw`<S>AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])`),
  rule('private-key-header', String.raw`-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----`),
  rule('anthropic-key', String.raw`<S>sk-ant-[a-z]{2,6}\d{2}-[A-Za-z0-9_-]{40,}`),
  rule('openai-key', String.raw`<S>sk-proj-[A-Za-z0-9_-]{40,}`),
];

class ScanError extends Error {}

// Build {name, value} markers from a .dev.vars-style file. Values under the
// length floor are skipped — they're too short to be a real credential and
// too likely to false-positive against ordinary page text.
//
// gitModes narrows what counts as a secret, because a commit scan meets
// ordinary config text that a built-output scan does not: a value that is one
// plain word (ENVIRONMENT=development), lowercase words joined by - or _
// (production-us), or a bare number is skipped; a URL contributes its password
// but not its hostname, and a URL with no password is no marker at all
// (http://localhost:8787). Every other value is a marker.
function markersFromVarsFile(varsPath, gitModes = false) {
  if (!existsSync(varsPath)) return [];
  const parsed = parseEnv(readFileSync(varsPath, 'utf8'));
  const markers = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (!value || value.length < MIN_MARKER_LENGTH) continue;
    if (gitModes && /^(?:[A-Za-z]+|\d+(?:\.\d+)?|[a-z]+(?:[-_][a-z]+)+)$/.test(value)) continue;
    let url = null;
    try {
      url = new URL(value);
    } catch {
      // Not a URL: the raw-value marker below covers it.
    }
    const passwordless = url && !url.password && /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    if (!(gitModes && passwordless)) markers.push({ name, value });
    if (url) {
      // Same length floor as the raw value — a one- or two-character
      // password/hostname isn't a usable marker, it's a false-positive
      // generator (it'll match arbitrary built output by coincidence).
      if (url.password && url.password.length >= MIN_MARKER_LENGTH) {
        markers.push({ name: `${name}:password`, value: url.password });
      }
      if (!gitModes && url.hostname && url.hostname.length >= MIN_MARKER_LENGTH) {
        markers.push({ name: `${name}:hostname`, value: url.hostname });
      }
    }
  }
  return markers;
}

// Extra markers from --patterns=<file> (array of strings and/or
// {name,value} objects) and/or SCAN_DIST_SECRETS_PATTERNS (comma-separated
// literal substrings). Both optional, both composable with the built-ins.
//
// A pattern is a secret by definition, so a hit never prints its value: it is
// named pattern#<position> (file entries first, then the env list), or by the
// object's own name when the caller gave one.
function markersFromConfig(patternsFile, envValue) {
  const markers = [];
  let position = 0;
  if (patternsFile) {
    if (!existsSync(patternsFile)) {
      throw new Error(`--patterns file not found: ${patternsFile}`);
    }
    const parsed = JSON.parse(readFileSync(patternsFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`--patterns file must contain a JSON array: ${patternsFile}`);
    for (const entry of parsed) {
      const at = position++;
      if (typeof entry === 'string') {
        if (entry.length >= MIN_MARKER_LENGTH) markers.push({ name: `pattern#${at}`, value: entry });
      } else if (entry && typeof entry === 'object' && typeof entry.value === 'string') {
        if (entry.value.length >= MIN_MARKER_LENGTH) {
          markers.push({ name: typeof entry.name === 'string' ? entry.name : `pattern#${at}`, value: entry.value });
        }
      }
    }
  }
  if (envValue) {
    for (const raw of envValue.split(',').map((s) => s.trim()).filter(Boolean)) {
      const at = position++;
      if (raw.length >= MIN_MARKER_LENGTH) markers.push({ name: `pattern#${at}`, value: raw });
    }
  }
  return markers;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else if (st.isFile()) out.push(abs);
  }
  return out;
}

// Returns { hit: boolean, files: number }. Stops at the first hit — one leak
// is enough to fail the build, and we never want to accumulate matched
// values in memory or output.
export function scan(distDir, markers) {
  const files = walk(distDir);
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable as text — skip rather than crash the scan
    }
    for (const marker of markers) {
      if (text.includes(marker.value)) {
        console.error(`scan-dist-secrets: LEAK — ${file} contains marker "${marker.name}"`);
        return { hit: true, files: files.length };
      }
    }
  }
  return { hit: false, files: files.length };
}

// ---------------------------------------------------------------------------
// Git modes
// ---------------------------------------------------------------------------

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : String(r.stderr).trim();
    throw new ScanError(`git ${args[0]} failed: ${why}`);
  }
  return r.stdout;
}

// `<path-glob> <rule-name>  # reason` per line. The reason is required: a
// waiver nobody explained is a future accident. A blank or whole-line comment
// is skipped; any other malformed line is an error, so a typo cannot quietly
// waive nothing, or everything.
function parseAllowlist(text) {
  const entries = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(\S+)\s+(\S+)\s+#\s*(\S.*)$/.exec(line);
    if (!m) {
      throw new ScanError(`${ALLOW_FILE}:${i + 1}: expected "<path-glob> <rule-name>  # reason", and the reason is required`);
    }
    entries.push({ glob: m[1], re: globToRegExp(m[1]), rule: m[2], reason: m[3].trim() });
  });
  return entries;
}

// --staged reads the allowlist from the index, so a waiver counts only once it
// is staged (an unstaged edit is not what the commit will hold); --history
// reads the checked-out file. A missing file is no waivers.
function loadAllowlist(mode, root) {
  if (mode === 'staged') {
    const r = spawnSync('git', ['-C', root, 'show', `:${ALLOW_FILE}`], { maxBuffer: 1 << 26 });
    return r.status === 0 ? parseAllowlist(String(r.stdout)) : [];
  }
  const file = join(root, ALLOW_FILE);
  return existsSync(file) ? parseAllowlist(readFileSync(file, 'utf8')) : [];
}

// A glob with no slash matches the basename at any depth; `**` crosses
// directories, `*` and `?` do not.
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${glob.includes('/') ? '' : '(?:.*/)?'}${out}$`);
}

// One entry per changed blob: { oid, path, commit, time }. Parses the
// NUL-separated `git diff --raw` / `git log --raw` stream: a ":modes oids
// status" token is followed by exactly one path token (renames are off), and a
// "commit <oid> <committer-time>" token names the commit the following entries
// belong to.
function parseRaw(buf) {
  const entries = [];
  const tokens = buf.toString('utf8').split('\0');
  let commit = null;
  let time = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^\n+/, '');
    if (!tok) continue;
    const raw = /^:(\d{6}) (\d{6}) [0-9a-f]+ ([0-9a-f]+) ([A-Z])$/.exec(tok);
    if (raw) {
      const path = tokens[++i];
      if (path === undefined) throw new ScanError('git output ended inside a diff entry');
      const mode = raw[2];
      if (/^0+$/.test(raw[3]) || mode === '160000' || mode === '040000') continue; // deleted, submodule, tree
      entries.push({ oid: raw[3], path, commit, time });
      continue;
    }
    const c = /^commit ([0-9a-f]{40,64}) (\d+)$/.exec(tok);
    if (c) { commit = c[1]; time = Number(c[2]); continue; }
    throw new ScanError('unrecognised git output while listing changed files');
  }
  return entries;
}

function stagedEntries(root) {
  return parseRaw(git(root, ['diff', '--cached', '--raw', '-r', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--diff-filter=ACMRT']));
}

// A tag can point straight at a blob (lightweight or annotated), which no
// commit diff lists. How far a chain of tags is followed depends on how far the
// installed git's %(*objecttype) peels; a tag on a tree is a known gap.
function taggedBlobEntries(root) {
  const out = git(root, ['for-each-ref', '--format=%(objecttype) %(objectname) %(*objecttype) %(*objectname) %(refname)']).toString();
  const entries = [];
  for (const line of out.split('\n')) {
    const [type, oid, peeledType, peeledOid, ref] = line.split(' ');
    if (type === 'blob') entries.push({ oid, path: ref, commit: null, time: null });
    else if (type === 'tag' && peeledType === 'blob') entries.push({ oid: peeledOid, path: ref, commit: null, time: null });
  }
  return entries;
}

function historyEntries(root, rev) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).toString().trim() === 'true') {
    throw new ScanError('shallow clone: history is incomplete (fetch with full depth, e.g. actions/checkout fetch-depth: 0)');
  }
  // --root: without it `log.showRoot=false` in a user's config drops the root commit's files.
  if (rev !== null) git(root, ['rev-parse', '--verify', `${rev}^{commit}`]);
  // The trailing `--` keeps a path named like the rev (a root file `HEAD`) from making it ambiguous.
  const log = git(root, ['log', ...(rev === null ? ['--all'] : [rev]), '--root', '-m', '-r', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--format=commit %H %ct', '--']);
  // A verified rev always reaches a commit; an empty log means nothing was scanned, never clean.
  if (rev !== null && log.length === 0) throw new ScanError(`--rev=${rev} reached no commits, so nothing was scanned`);
  // A tag on a blob is reachable from no commit, so a --rev scan leaves it out.
  return rev === null ? [...parseRaw(log), ...taggedBlobEntries(root)] : parseRaw(log);
}

// Incremental reader over a child's stdout, so a large history never sits in
// memory at once.
class ByteReader {
  constructor(stream) {
    this.it = stream[Symbol.asyncIterator]();
    this.buf = Buffer.alloc(0);
  }

  async fill() {
    const { value, done } = await this.it.next();
    if (done) return false;
    this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : value;
    return true;
  }

  async line() {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) {
        const l = this.buf.toString('latin1', 0, i);
        this.buf = this.buf.subarray(i + 1);
        return l;
      }
      if (!(await this.fill())) return null;
    }
  }

  async take(n) {
    while (this.buf.length < n) {
      if (!(await this.fill())) throw new ScanError('git cat-file ended before the blob did');
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  async skip(n) {
    while (n > 0) {
      if (this.buf.length === 0 && !(await this.fill())) throw new ScanError('git cat-file ended before the blob did');
      const k = Math.min(n, this.buf.length);
      this.buf = this.buf.subarray(k);
      n -= k;
    }
  }
}

// Streams each blob through `visit(oid, buffer)`. A missing or non-blob
// object, or a non-zero exit from git, throws.
async function readBlobs(root, oids, stats, visit) {
  if (oids.length === 0) return;
  const child = spawn('git', ['-C', root, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let spawnError = null;
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdin.on('error', () => {});
  child.on('error', (e) => { spawnError = e; });
  const closed = new Promise((res) => child.on('close', res));
  child.stdin.end(oids.join('\n') + '\n');

  const reader = new ByteReader(child.stdout);
  for (let seen = 0; seen < oids.length; seen++) {
    const head = await reader.line();
    if (head === null) break;
    const parts = head.split(' ');
    if (parts[1] !== 'blob') throw new ScanError(`unreadable object ${parts[0]}`);
    const size = Number(parts[2]);
    if (size > MAX_BLOB_BYTES) {
      stats.large++;
      await reader.skip(size);
    } else {
      await visit(parts[0], await reader.take(size));
    }
    await reader.skip(1);
    stats.blobs++;
  }
  const code = await closed;
  if (spawnError) throw new ScanError(`git cat-file failed: ${spawnError.message}`);
  if (code !== 0 || stats.blobs !== oids.length) {
    throw new ScanError(`git cat-file read ${stats.blobs} of ${oids.length} blob(s) (exit ${code}) ${stderr.trim()}`.trim());
  }
}

function matchNames(text, markers) {
  const names = [];
  for (const rule of RULES) if (rule.re.test(text)) names.push(rule.name);
  for (const marker of markers) if (text.includes(marker.value)) names.push(marker.name);
  return names;
}

// Returns { hits: [{path, commit, time, name}], waived: Map<"path rule", reason>, blobs, binary, large }.
async function scanGit(mode, root, markers, rev = null) {
  const allow = loadAllowlist(mode, root);
  const entries = mode === 'staged' ? stagedEntries(root) : historyEntries(root, rev);
  const where = new Map();
  for (const e of entries) {
    if (!where.has(e.oid)) where.set(e.oid, []);
    where.get(e.oid).push(e);
  }
  const stats = { blobs: 0, binary: 0, large: 0 };
  const hits = [];
  const waived = new Map();
  const seen = new Set();
  await readBlobs(root, [...where.keys()], stats, (oid, body) => {
    if (body.subarray(0, 8000).includes(0)) { stats.binary++; return; }
    const names = matchNames(body.toString('utf8'), markers);
    for (const e of where.get(oid)) {
      for (const name of names) {
        const waiver = allow.find((a) => a.rule === name && a.re.test(e.path));
        if (waiver) { waived.set(`${e.path} ${name}`, waiver.reason); continue; }
        const key = `${e.commit}\0${e.path}\0${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ path: e.path, commit: e.commit, time: e.time, name });
      }
    }
  });
  return { hits, waived, ...stats };
}

// One line per (path, rule): a secret that survives 19 commits is one leak.
// The commit named is the one with the earliest commit date; a tie goes to the
// one listed later, which is the older in log order.
function reportHits(hits) {
  const grouped = new Map();
  for (const h of hits) {
    const key = `${h.path}\0${h.name}`;
    const g = grouped.get(key);
    if (!g) { grouped.set(key, { ...h, count: 1 }); continue; }
    g.count++;
    if (h.time !== null && (g.time === null || h.time <= g.time)) { g.commit = h.commit; g.time = h.time; }
  }
  for (const h of grouped.values()) {
    const more = h.count > 1 ? `, and ${h.count - 1} later` : '';
    const at = h.commit ? ` (oldest commit ${h.commit.slice(0, 12)}${more})` : '';
    console.error(`scan-dist-secrets: LEAK — ${h.path}${at} matches "${h.name}"`);
  }
  console.error(`scan-dist-secrets: if a hit is a known false positive, add "<path-glob> <rule-name>  # reason" to ${ALLOW_FILE}`);
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

// A canary per rule, built from parts so this file (and any repo that vendors
// it) never holds a literal that push protection or this scanner would flag.
// The first string of each list is the one planted in the temp repo.
const CANARIES = {
  'aws-access-key-id': [['AK', 'IA', 'ZZSELFTEST000000'].join('')],
  'github-token': [
    ['gh', 'p_', 'a'.repeat(36)].join(''),
    ['gh', 'o_', 'a'.repeat(36)].join(''),
    ['gh', 'u_', 'a'.repeat(36)].join(''),
    ['gh', 's_', 'a'.repeat(36)].join(''),
    ['gh', 'r_', 'a'.repeat(36)].join(''),
    ['github', '_pat_', 'b'.repeat(70)].join(''),
  ],
  'slack-token': [
    ['xo', 'xb-', '123456789012-1234567890123-abcdefghijklmnopqrstuvwx'].join(''),
    ['xo', 'xp-', '1234567890-1234567890-1234567890-0123456789abcdef0123456789abcdef'].join(''),
  ],
  'stripe-live-key': [['sk', '_live_', 'a1'.repeat(12)].join('')],
  'google-api-key': [['AI', 'za', 'A'.repeat(35)].join('')],
  'private-key-header': [
    ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join(''),
    ['-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----'].join(''),
    ['-----BEGIN ', 'PRIVATE', ' KEY-----'].join(''),
  ],
  'anthropic-key': [['sk-', 'ant-', 'api03-', 'x'.repeat(40)].join('')],
  'openai-key': [['sk-', 'proj-', 'y'.repeat(40)].join('')],
};

function selfTestFail(message) {
  console.error(`scan-dist-secrets: self-test FAILED — ${message}`);
  process.exit(1);
}

// Proves the scanner itself works: plant a known canary in a throwaway
// directory (and a throwaway repo) and confirm detection fires. Runnable
// anywhere, no real secrets needed — this is what CI can run alongside the
// real scan.
async function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-dist-secrets-selftest-'));
  try {
    // Dist mode.
    const marker = { name: 'SELF_TEST_CANARY', value: 'zz_self_test_canary_0000000000' };
    writeFileSync(join(dir, 'index.html'), `<html>${marker.value}</html>`);
    if (!scan(dir, [marker]).hit) selfTestFail('planted canary was not detected');

    // Every rule fires on its canaries, and none on plain text.
    for (const rule of RULES) {
      if (!CANARIES[rule.name]) selfTestFail(`rule ${rule.name} has no canary`);
      for (const c of CANARIES[rule.name]) {
        if (!matchNames(c, []).includes(rule.name)) selfTestFail(`rule ${rule.name} did not match its canary`);
      }
    }
    if (matchNames('nothing secret here, just prose and a sha ' + 'a'.repeat(40), []).length) {
      selfTestFail('a rule matched plain text');
    }

    // Git modes against a throwaway repo, isolated from the caller's git
    // environment (a hook sets GIT_INDEX_FILE and friends).
    for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const g = (...a) => git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a]);
    g('init', '-q');
    const names = RULES.map((r) => r.name);
    for (const n of names) writeFileSync(join(repo, `canary-${n}.txt`), `${CANARIES[n][0]}\n`);
    writeFileSync(join(repo, 'clean.txt'), 'nothing secret here\n');
    g('add', '-A');
    const staged = await scanGit('staged', repo, []);
    for (const n of names) {
      if (!staged.hits.some((h) => h.name === n && h.path === `canary-${n}.txt`)) selfTestFail(`--staged missed ${n}`);
    }
    if (staged.hits.some((h) => h.path === 'clean.txt')) selfTestFail('--staged flagged a clean file');

    g('commit', '-q', '-m', 'plant canaries');
    for (const n of names) rmSync(join(repo, `canary-${n}.txt`));
    g('add', '-A');
    g('commit', '-q', '-m', 'remove canaries');
    if ((await scanGit('staged', repo, [])).hits.length) selfTestFail('--staged flagged a tree with nothing staged');
    const history = await scanGit('history', repo, []);
    for (const n of names) {
      if (!history.hits.some((h) => h.name === n && h.path === `canary-${n}.txt` && h.commit)) {
        selfTestFail(`--history missed ${n} after the file was deleted`);
      }
    }
    if (history.hits.some((h) => h.path === 'clean.txt')) selfTestFail('--history flagged a clean file');

    // Allowlist waives one (path, rule) pair and nothing else.
    mkdirSync(join(repo, '.house'));
    writeFileSync(join(repo, ALLOW_FILE), '# self-test waiver\ncanary-github-token.txt github-token  # planted on purpose\n');
    const waived = await scanGit('history', repo, []);
    if (waived.hits.some((h) => h.name === 'github-token')) selfTestFail('the allowlist did not waive its entry');
    if (waived.hits.length !== history.hits.length - history.hits.filter((h) => h.name === 'github-token').length) {
      selfTestFail('the allowlist waived more than its entry');
    }

    // --rev scans only what the revision reaches: a canary committed on a
    // side branch is out of HEAD's history, in the all-refs scan.
    g('checkout', '-q', '-b', 'side');
    writeFileSync(join(repo, 'side-canary.txt'), `${CANARIES['github-token'][0]}\n`);
    g('add', '-A');
    g('commit', '-q', '-m', 'side canary');
    g('checkout', '-q', '-');
    if (!(await scanGit('history', repo, [])).hits.some((h) => h.path === 'side-canary.txt')) selfTestFail('--history missed a side branch');
    if ((await scanGit('history', repo, [], 'HEAD')).hits.some((h) => h.path === 'side-canary.txt')) selfTestFail('--history --rev read a ref HEAD does not reach');
    if (!(await scanGit('history', repo, [], 'side')).hits.some((h) => h.path === 'side-canary.txt')) selfTestFail('--history --rev missed its own history');

    // Fail closed: a directory that is not a repo is an error, not a pass.
    let threw = false;
    try { await scanGit('history', dir, []); } catch (e) { threw = e instanceof ScanError; }
    if (!threw) selfTestFail('a git error did not fail the scan');

    console.log(`scan-dist-secrets: self-test OK — planted canary was detected (dist, ${names.length} rules, --staged, --history, --rev, allowlist)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runGitMode(mode, args) {
  try {
    const revArgs = args.filter((a) => a.startsWith('--rev='));
    if (revArgs.length > 1) throw new ScanError('--rev may be given once');
    const rev = revArgs.length ? revArgs[0].slice('--rev='.length) : null;
    if (revArgs.length && mode !== 'history') throw new ScanError('--rev goes with --history only');
    if (revArgs.length && (!rev || rev.startsWith('-') || rev.startsWith('^'))) {
      throw new ScanError('--rev needs one revision, not an option or an exclusion (^rev)');
    }
    const repoArg = args.find((a) => a.startsWith('--repo='));
    const top = git(repoArg ? resolve(repoArg.slice('--repo='.length)) : process.cwd(), ['rev-parse', '--show-toplevel']).toString().trim();
    const varsArg = args.find((a) => a.startsWith('--vars-file='));
    const varsFile = varsArg ? resolve(top, varsArg.slice('--vars-file='.length)) : join(top, '.dev.vars');
    const patternsArg = args.find((a) => a.startsWith('--patterns='));
    const patternsFile = patternsArg ? resolve(top, patternsArg.slice('--patterns='.length)) : null;
    const markers = [
      ...markersFromVarsFile(varsFile, true),
      ...markersFromConfig(patternsFile, process.env.SCAN_DIST_SECRETS_PATTERNS),
    ];
    const result = await scanGit(mode, top, markers, rev);
    for (const [what, reason] of result.waived) console.log(`scan-dist-secrets: waived ${what}: ${reason}`);
    if (result.hits.length) {
      reportHits(result.hits);
      process.exit(1);
    }
    const skipped = [result.binary && `${result.binary} binary`, result.large && `${result.large} over ${MAX_BLOB_BYTES} bytes`].filter(Boolean);
    console.log(`scan-dist-secrets: clean — ${mode}, ${result.blobs} blob(s), ${RULES.length} rule(s), ${markers.length} marker(s)${skipped.length ? `, skipped ${skipped.join(' and ')}` : ''}`);
    process.exit(0);
  } catch (e) {
    console.error(`scan-dist-secrets: ERROR — ${e.message}`);
    process.exit(2);
  }
}

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  await runSelfTest();
  process.exit(0);
} else if (args.includes('--staged') || args.includes('--history')) {
  if (args.includes('--staged') && args.includes('--history')) {
    console.error('scan-dist-secrets: ERROR — choose one of --staged and --history');
    process.exit(2);
  }
  await runGitMode(args.includes('--staged') ? 'staged' : 'history', args);
} else {
  const varsArg = args.find((a) => a.startsWith('--vars-file='));
  const varsFile = varsArg ? resolve(ROOT, varsArg.slice('--vars-file='.length)) : join(ROOT, '.dev.vars');

  const distArg = args.find((a) => a.startsWith('--dist-dir='));
  const distDir = distArg ? resolve(ROOT, distArg.slice('--dist-dir='.length)) : join(ROOT, 'dist');

  const patternsArg = args.find((a) => a.startsWith('--patterns='));
  const patternsFile = patternsArg ? resolve(ROOT, patternsArg.slice('--patterns='.length)) : null;

  if (!existsSync(distDir)) {
    console.error(`scan-dist-secrets: ${distDir} does not exist — run the build first`);
    process.exit(1);
  }

  const markers = [
    ...markersFromVarsFile(varsFile),
    ...markersFromConfig(patternsFile, process.env.SCAN_DIST_SECRETS_PATTERNS),
    ...UNCONDITIONAL_PATTERNS,
  ];
  const result = scan(distDir, markers);
  if (result.hit) process.exit(1);
  console.log(`scan-dist-secrets: clean — ${result.files} file(s), ${markers.length} marker(s) checked`);
  process.exit(0);
}
