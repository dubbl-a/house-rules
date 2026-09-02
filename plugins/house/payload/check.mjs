#!/usr/bin/env node
// House self-contained checker.
//
// Vendored BYTE-IDENTICAL into every consuming repo as `.house/check.mjs`.
// Runs on node:20+ builtins plus the `git` binary only: no npm dependencies,
// no assumption that a package.json exists in the checker's OWN directory
// (the target repo being checked may or may not have one; see per-check
// notes below). Do not import anything from this repo's other files.
//
// Usage:
//   node check.mjs [--only=fam,fam,...] [--json] [--accept-lengths] [--repo <path>]
//
// Families (default: all): drift, todo, tamper, behind, shape, lengths,
// coload, manifest, minutes, guard.
//
// Repo root: `git rev-parse --show-toplevel` from cwd, or the literal path
// given to --repo (used as-is, not re-resolved through git).
//
// Config is read from <repoRoot>/house.json (schema:
// plugins/house/schema/house.schema.json in the house package repo) and the
// lock from <repoRoot>/.house/lock.json when present. Every knob a specific
// consuming repo might need is a config key, not a hardcoded namespace; the
// full list this file reads, and where each one lives in house.json:
//
//   modules.docs.config.excludeFiles         array<glob|path|{path,why}>   drift doc-set exclusion;
//                                              an object entry records why the exclusion is
//                                              deliberate (ADR 0009) and satisfies the P9 nudge
//   modules.docs.config.archiveDirs          array<glob|path|{path,why}>   drift archive exclusion
//                                              (see scanArchive; object form as excludeFiles)
//   modules.docs.config.scanArchive          boolean, default false
//   modules.docs.config.roots                array<glob|path>   drift self-consistency: each must
//                                                                resolve to >=1 tracked .md, and every
//                                                                tracked .md under it must land in the
//                                                                scanned set (catches an exclude/archive
//                                                                glob that over-matches a root you meant
//                                                                to always cover)
//   modules.docs.config.bareScriptAllowlist  array<string|{token,kind,why}>   drift anchor kind (b)
//                                              exemptions; an object entry records a token that is
//                                              deliberately not a script (ADR 0009) and satisfies
//                                              the P3 stale-allowlist warning
//   modules.docs.config.extraPathRoots       array<string>      drift anchor kind (c) extra top dirs
//   modules.docs.config.packageRoots         array<dir|{dir}>   drift: a doc under a listed dir
//                                              resolves npm-script anchors (kinds (a)(b)) against
//                                              that dir's package.json (unioned with the root's)
//                                              and path anchors (kind (c)) against that dir first,
//                                              then the repo root; the P3 allowlist check consults
//                                              every listed dir's scripts too
//   modules.docs.config.buildArtifactPrefixes array<string>     drift anchor kind (c) existence-exempt
//   modules.docs.config.haystackDirs         array<glob|path>   drift anchor kinds (d)(e)(f)(h) haystack
//   modules.docs.config.classPrefixes        array<string>      drift anchor kind (e)
//   modules.docs.config.componentSuffixes    array<string>      drift anchor kind (h)
//   modules.docs.config.componentAllowlist   array<string>      drift anchor kind (h) exemptions
//   modules.docs.config.componentRoots       array<dir>, default ["src"]   drift anchor kind (h)
//                                                                basename set: the dirs whose
//                                                                component files name the tokens
//                                                                a doc is allowed to cite
//   modules.docs.config.componentExts        array<ext>, default
//                                                [".astro",".jsx",".tsx",".vue",".svelte"]
//   modules.docs.config.lengthLimits         object<glob|path, int|{lines,bytes}>   lengths family
//                                              The lengths family ALSO warns on the auto-memory
//                                              index, which has no config slot at all: it lives at
//                                              <CLAUDE_CONFIG_DIR|~/.claude>/projects/<repo root
//                                              with "/" turned into "-", or the name given by
//                                              CLAUDE_CODE_PROJECT_DIR_NAME when that is set beside
//                                              CLAUDE_CONFIG_DIR, as the harness requires
//                                              >/memory/MEMORY.md,
//                                              loads every session, and is cut at 200 lines or
//                                              25KB with no notice. Warning only, never a
//                                              finding, and silent when the file is absent,
//                                              because it is machine-local and outside git.
//                                              See ADR 0008.
//   modules.docs.config.maxCoLoadLines       integer, default 400                   coload family
//                                                (above 400 needs a `coload-ceiling` deviation: manifest family)
//   modules.docs.config.emDash               object, default                        shape family
//                                              {"mode":"public","paths":["README.md","CHANGELOG.md",
//                                              "docs/**/*.md"],"exclude":[]}
//                                              Which surfaces the em-dash ban covers. `mode`
//                                              "public" scans `paths`; "all" scans `paths` plus
//                                              every rule file; "off" scans nothing, and an
//                                              explicit `"paths": []` is a second off switch
//                                              (an empty array wins over the default and is not
//                                              a manifest finding). `paths` and `exclude`
//                                              entries are a glob/path string or the
//                                              {path, why} object form, matched exactly like
//                                              every other docs path slot (a wildcard-free entry
//                                              means that file, or that directory and everything
//                                              under it). `exclude` narrows `paths` only: under
//                                              "all" it can never drop a rule file. A malformed
//                                              field is a manifest finding and falls back to its
//                                              own default here, so a typo reverts that field to
//                                              the default set rather than turning the scan off,
//                                              and the manifest family names it.
//   modules.github.config.actionsBudgetMinutes   integer, default 2000                  minutes family
//
// Plus the schema's own top-level keys as already defined: version,
// defaultBranch, branchPolicy, protectedBranches, carveOuts, guard, modules,
// deviations, ratchet, ratchetRaises. `manifest` hand-validates house.json
// against those; every config key above lives inside a module's `config`
// object, which the schema already leaves open (`{"type":"object"}`, no
// additionalProperties restriction), so none of this needs a schema change
// to be valid today. Root-level additionalProperties is false, so a new
// top-level key needs a schema update first (`guard`, added for ADR 0009,
// is the precedent).
//
// Exit codes: 0 clean (warnings allowed), 1 findings, 2 unusable house.json
// (only when a requested family that needs it -- tamper, manifest, coload,
// guard -- can't get one; drift/todo/behind/shape/lengths/minutes degrade
// gracefully with defaults instead of failing the whole run).
//
// House-managed files (a rule or payload file whose first line after any
// frontmatter is the `<!-- house-managed ... -->` header) are scanned, but
// their prose describes the PACKAGE, not the repo it was vendored into. A
// consuming repo cannot edit them and cannot create the package's handbook,
// its tests tree, or its npm scripts, so a token that fails to resolve there
// is not a defect that repo can fix. Two rules follow from that, and both
// exist because the package's own dogfood run is a false negative for every
// consumer (the package repo has all of those files, so it never sees the
// failure):
//   - a script anchor (kinds (a) and (b)) on a managed file names the
//     adopting repo's script surface, which the package cannot know, so an
//     absent script there is skipped outright;
//   - a token naming the package's own surface (see PACKAGE_SURFACE_PREFIXES)
//     is dropped OUTRIGHT in a consumer rather than downgraded: no PR there
//     can ever resolve it, and it stays a finding in the package repo, which
//     is the run that gates it (ADR 0010);
//   - every other unresolved token on a managed file is a FINDING when this
//     repo is the package repo itself (plugins/house/modules/ is present, so
//     the prose and its referents are both editable here) and a WARNING
//     anywhere else.
// Frontmatter `paths:` validation is NOT downgraded: a vendored rule scoped
// to a glob that matches nothing in THIS repo loads nowhere, which is a
// defect of this repo's house.json and is fixed by re-rendering.

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const ALL_FAMILIES = ['drift', 'todo', 'tamper', 'behind', 'shape', 'lengths', 'coload', 'manifest', 'minutes', 'guard'];
const NEEDS_HOUSE_JSON = new Set(['tamper', 'manifest', 'coload', 'guard']);

// ── generic helpers ─────────────────────────────────────────────────────

function arr(x) { return Array.isArray(x) ? x : []; }
function safeRead(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
function mk(family, path, line, kind, message) { return { family, path, line: line ?? null, kind, message }; }
function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function isNonEmptyString(x) { return typeof x === 'string' && x.trim().length > 0; }
function isArrayOfNonEmptyStrings(x) { return Array.isArray(x) && x.every(isNonEmptyString); }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
function gitLsFilesZ(repoRoot, extraArgs = []) {
  let out;
  try { out = git(repoRoot, ['ls-files', '-z', ...extraArgs]); } catch { return []; }
  return out.split('\0').filter(Boolean);
}
// #18: which of `paths` do git's ignore rules swallow? Asked of git itself
// (every .gitignore, info/exclude, core.excludesFile), never parsed by hand.
// --no-index evaluates a path even if it is tracked; paths need not exist.
// Returns Map<path, 'source:line "pattern"'> (empty when none is ignored) or
// null when git could not answer, so the caller can say "unknown" instead of
// printing a pass it did not earn.
function gitIgnoredMap(repoRoot, paths) {
  if (!paths.length) return new Map();
  const res = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z', '-v'], {
    cwd: repoRoot, input: `${paths.join('\0')}\0`, encoding: 'utf8',
  });
  if (res.error || (res.status !== 0 && res.status !== 1)) return null;
  const f = (res.stdout || '').split('\0');
  const out = new Map();
  for (let i = 0; i + 3 < f.length; i += 4) {
    // A pattern starting with `!` is a negation: the path is NOT ignored,
    // though -v may still print the match on some git versions.
    if (f[i + 2].startsWith('!')) continue;
    out.set(f[i + 3], `${f[i]}:${f[i + 1]} "${f[i + 2]}"`);
  }
  return out;
}

// `**` crosses `/`, `*` does not, `?` matches one non-slash char, and a bare
// pattern with no `/` at all matches its basename at any depth (mirrors how
// Claude Code matches a bare filename glob in `paths:` frontmatter -- see
// docs/decisions/0007-path-scoped-rules-load-on-read.md in the house repo).
function globToRegExp(glob) {
  let pat = glob;
  if (!pat.includes('/')) pat = `**/${pat}`;
  let re = '';
  let i = 0;
  while (i < pat.length) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        const j = i + 2;
        if (pat[j] === '/') { re += '(?:.*/)?'; i = j + 1; continue; }
        re += '.*'; i = j; continue;
      }
      re += '[^/]*'; i += 1; continue;
    }
    if (c === '?') { re += '[^/]'; i += 1; continue; }
    re += escapeRegExp(c); i += 1;
  }
  return new RegExp(`^${re}$`);
}

// Looser matcher used for the convenience config lists (excludeFiles,
// archiveDirs, roots, haystackDirs, lengthLimits keys): a literal path with
// no wildcard char is treated as "this file, or this directory and
// everything under it" (matching repo-b's EXCLUDES prefix convention);
// anything with `*` or `?` goes through the real glob engine above.
function matchesConfigPath(file, pattern) {
  if (/[*?]/.test(pattern)) return globToRegExp(pattern).test(file);
  const trimmed = pattern.replace(/\/+$/, '');
  return file === trimmed || file.startsWith(`${trimmed}/`);
}

function frontmatterCloseIndex(lines) {
  if (lines[0]?.trim() !== '---') return -1;
  return lines.findIndex((l, i) => i > 0 && l.trim() === '---');
}
function stripFrontmatter(raw) {
  const lines = raw.split('\n');
  const closeIdx = frontmatterCloseIndex(lines);
  if (closeIdx <= 0) return raw;
  return lines.slice(closeIdx + 1).join('\n');
}
function countLinesExcludingFrontmatter(raw) {
  return (stripFrontmatter(raw).match(/\n/g) || []).length;
}

// The head window a file-level marker must sit in: the first `n` lines, or,
// when the file opens with YAML frontmatter, the first `n` lines after the
// closing fence (nothing can sit above the fence without breaking whatever
// parses the frontmatter, which is what made the fixed window unusable for
// frontmatter-carrying docs). An unterminated fence leaves the window at the
// top of the file; those lines sit inside the broken fence, which is the
// file's own defect to fix.
// The top-of-file window is always included, not replaced: a doc whose first
// line is a Markdown thematic-break `---` (with another `---` further down)
// LOOKS like frontmatter to frontmatterCloseIndex, and relocating the window
// wholesale would silently un-honour a marker that sat in the old fixed
// window. The union keeps every marker the fixed window accepted and adds the
// after-the-fence position frontmatter files need.
function headWindow(lines, n = 3) {
  const top = lines.slice(0, n);
  const closeIdx = frontmatterCloseIndex(lines);
  if (closeIdx > 0) return [...top, ...lines.slice(closeIdx + 1, closeIdx + 1 + n)];
  return top;
}

// The `paths:` YAML-list mini-parser shared by drift's frontmatter validator
// and coload's rule-file glob extraction.
function parseRuleFrontmatterPaths(raw) {
  const lines = raw.split('\n');
  const closeIdx = frontmatterCloseIndex(lines);
  if (closeIdx <= 0) return { hasFrontmatter: false, globs: [] };
  const globs = [];
  let inPathsList = false;
  for (let i = 1; i < closeIdx; i++) {
    const l = lines[i];
    if (/^paths\s*:\s*$/.test(l)) { inPathsList = true; continue; }
    if (inPathsList && /^[a-zA-Z]/.test(l)) inPathsList = false;
    if (!inPathsList) continue;
    const m = l.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
    if (m) globs.push(m[1]);
  }
  return { hasFrontmatter: true, globs };
}

function extractHeadings(raw) {
  const out = [];
  const lines = raw.split('\n');
  let inFence = false;
  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: idx + 1 });
  });
  return out;
}

// GitHub-slug simplification exactly as specced: lowercase, spaces to
// hyphens, strip punctuation. Not the full GitHub algorithm (no de-dup
// counter suffixes) -- deliberately, so this stays predictable to test.
function githubSlug(text) {
  return text.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return false;
}

// Paths in the house PACKAGE repo's own tree. Managed prose names them as its
// receipts (docs/handbook/), its decision records (docs/decisions/), its
// module sources (plugins/house/), and its own test controls (tests/). None
// is a render destination, so no consumer can create one and no PR in a
// consuming repo can fix a reference to one. Unlike scripts/house/* and
// .house/*, which ARE destinations whose absence signals a per-repo
// enablement choice worth a warning, these are dropped outright in consumers
// (ADR 0010): two adopters each printed ~119 identical, permanently
// unactionable warnings per run, which is the train-to-ignore-warnings
// failure the P9 comment below argues against. The control is the package
// repo's own run, where each of these tokens stays a FINDING, plus the
// stale-prefix self-check in checkDrift. `.github/` must never join this
// list: .github files are real render destinations in consumers, so their
// drift is actionable there.
const PACKAGE_SURFACE_PREFIXES = ['docs/handbook/', 'docs/decisions/', 'plugins/house/', 'tests/'];

const LIFECYCLE_NAMES = new Set(['prebuild', 'postbuild', 'predev', 'prepare', 'preinstall']);
function isBareScriptToken(tok) {
  return LIFECYCLE_NAMES.has(tok) || /^[a-z][a-z0-9-]*(:[a-z0-9-]+)+$/.test(tok);
}

// The namespace ("first segment") of every script name that is ITSELF
// colon-namespaced, e.g. {build, check, results} from {build:cards,
// check:docs, results:call}. A bare, colonless script (`"astro": "astro"`)
// contributes nothing here: its own name is not evidence the repo treats
// that word as a namespace, so it must not make `astro:assets` (the Astro
// built-in module import, not a script) look script-shaped.
function scriptNamespaces(npmScripts) {
  const out = new Set();
  if (!npmScripts) return out;
  for (const name of npmScripts) {
    const i = name.indexOf(':');
    if (i > 0) out.add(name.slice(0, i));
  }
  return out;
}

function sha256Hex(str) { return createHash('sha256').update(str, 'utf8').digest('hex'); }

// A managed file's "body" is everything after its first line when that
// first line is a whole-line HTML comment (the managed-header convention);
// otherwise the body is the whole file.
function managedBody(raw) {
  const nl = raw.indexOf('\n');
  const firstLine = nl === -1 ? raw : raw.slice(0, nl);
  if (/^<!--.*-->\s*$/.test(firstLine.trim())) return nl === -1 ? '' : raw.slice(nl + 1);
  return raw;
}

// True when this document carries the managed header render writes: the
// first line, or the first line after a closing frontmatter fence, is an
// HTML comment opening with `house-managed`. This is the only marker a
// consuming repo can read without the lock, and the lock is not consulted
// here on purpose -- a file the lock forgot is still not the adopter's prose.
function isHouseManagedDoc(raw) {
  const lines = raw.split('\n');
  const closeIdx = frontmatterCloseIndex(lines);
  const start = closeIdx > 0 ? closeIdx + 1 : 0;
  for (let i = start; i < Math.min(start + 3, lines.length); i++) {
    const t = lines[i].trim();
    if (!t) continue;
    return /^<!--\s*house-managed\b/.test(t);
  }
  return false;
}

// A repo-relative path from tracked config (a lock entry, a module dest, a
// docs exclude glob) must stay inside the repo it claims to describe.
// `path.relative` is the only reliable test: a plain string check misses
// `a/../../b`, and an absolute path resolves outside without ever spelling
// `..`. Returns true when `rel` resolves to something at or under `root`.
function isInsideRoot(root, rel) {
  if (typeof rel !== 'string' || rel === '') return false;
  const r = relative(root, resolve(root, rel));
  return r !== '..' && !r.startsWith(`..${sep}`) && !r.startsWith('../') && !/^([A-Za-z]:)?[\\/]/.test(r);
}

// ── house.json / lock.json / installed_plugins.json ────────────────────

// P2 helper: the set of repo-relative paths the lock records as managed. Used
// to authenticate the house-managed downgrade so a forged marker cannot dodge
// the gate. Returns an empty Set when no lock is present or parseable.
// One reader for .house/lock.json's entry list (bare array or {files: []}).
// null when the lock is absent or unparseable; the tamper family reports the
// unparseable case, every other caller treats null as "nothing recorded".
function readLockEntries(repoRoot) {
  const p = join(repoRoot, '.house', 'lock.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(j) ? j : (Array.isArray(j.files) ? j.files : []);
  } catch { return null; }
}
function loadLockManagedPaths(repoRoot) {
  const set = new Set();
  for (const e of readLockEntries(repoRoot) || []) if (isPlainObject(e) && typeof e.path === 'string') set.add(e.path);
  return set;
}
// path -> bodySha256, for the callers that must know not only that the lock
// records a file but that the on-disk body is still the one it recorded.
function loadLockManagedHashes(repoRoot) {
  const map = new Map();
  for (const e of readLockEntries(repoRoot) || []) {
    if (isPlainObject(e) && typeof e.path === 'string' && typeof e.bodySha256 === 'string') map.set(e.path, e.bodySha256);
  }
  return map;
}

// P1 helper: signs that a render has run and integrity checking should be on.
// A repo with vendored house rules or a file-vendoring module enabled but NO
// lock has its whole tamper family silently disabled, so that absence is a
// finding, not a skip. A never-adopted repo (no rules/house, no such module)
// legitimately has no lock and is left alone.
function renderLooksComplete(repoRoot, house) {
  if (existsSync(join(repoRoot, '.claude', 'rules', 'house'))) return true;
  const mods = isPlainObject(house?.data?.modules) ? house.data.modules : {};
  return Object.values(mods).some((m) => isPlainObject(m) && m.enabled === true);
}

function loadHouseJson(repoRoot) {
  const p = join(repoRoot, 'house.json');
  if (!existsSync(p)) return { present: false, data: null, path: p };
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch { return { present: true, data: null, path: p }; }
  try { return { present: true, data: JSON.parse(raw), path: p, raw }; }
  catch { return { present: true, data: null, path: p, raw }; }
}
function moduleConfig(house, name) {
  const m = house?.data?.modules?.[name];
  return (m && isPlainObject(m.config) && m.config) || {};
}

function readInstalledPlugins() {
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const p = join(cfgDir, 'plugins', 'installed_plugins.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
// version-2 shape: .plugins["house-rules@house-rules"] is an array of per-install
// records; prefer the scope=="user" one, else the first available.
function resolveHousePluginRecord(installed) {
  if (!installed || !isPlainObject(installed.plugins)) return null;
  const list = installed.plugins['house-rules@house-rules'];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((r) => r && r.scope === 'user') || list[0];
}

// ── drift ────────────────────────────────────────────────────────────────

// Native floor: the hosted reviewer already flags a documented claim that a
// pull request makes outdated, at nit severity and only for a newly
// introduced violation, so this family is the deterministic local floor that
// resolves every anchor token in every scanned doc before the push.

// ADR 0009 object forms. Both normalizers drop a malformed entry so the drift
// family degrades gracefully; the manifest family validates the same entries
// loudly, so the defect is reported exactly once and never hides a scan.
// bareScriptAllowlist: a plain string, or {token, kind, why} for a token that
// is deliberately not a script and never will be.
function normalizeAllowlistEntry(e) {
  if (isNonEmptyString(e)) return { token: e.trim(), why: null };
  if (isPlainObject(e) && isNonEmptyString(e.token)) {
    return { token: e.token.trim(), why: isNonEmptyString(e.why) ? e.why : null };
  }
  return null;
}
// excludeFiles/archiveDirs: a plain glob/path string, or {path, why} when the
// exclusion is deliberate and its reason belongs in config rather than as an
// in-file point-in-time marker.
function normalizePathEntry(e) {
  if (isNonEmptyString(e)) return { path: e.trim(), why: null };
  if (isPlainObject(e) && isNonEmptyString(e.path)) {
    return { path: e.path.trim(), why: isNonEmptyString(e.why) ? e.why : null };
  }
  return null;
}

function collectHaystack(repoRoot, allTracked, haystackDirs) {
  if (!haystackDirs.length) return '';
  const parts = [];
  for (const entry of haystackDirs) {
    for (const f of allTracked) {
      if (matchesConfigPath(f, entry)) parts.push(safeRead(join(repoRoot, f)));
    }
  }
  return parts.join('\n');
}

function validateRulesFrontmatter(docPath, raw, repoRoot, findings, allTracked) {
  const { hasFrontmatter, globs } = parseRuleFrontmatterPaths(raw);
  if (!hasFrontmatter || globs.length === 0) {
    findings.push(mk('drift', docPath, 1, 'always-on rule', 'no `paths:` frontmatter'));
    return;
  }
  for (const glob of globs) {
    const firstGlob = glob.search(/[*[{]/);
    // The probe is the glob's LITERAL PARENT DIRECTORY, or the repo root
    // when the glob has no `/` before its first wildcard. Probing the raw
    // glob instead (what this did until the repo-d trial) made every
    // bare `name-*.ext` pattern fail on `existsSync("<root>/name-*.ext")`
    // no matter how many tracked files it really matched -- and a bare
    // pattern is exactly the shape Claude Code matches at any depth.
    // The parent-dir probe is a fast fail for a glob whose LITERAL PARENT
    // does not exist. It applies only when the glob actually has a wildcard:
    // a pure literal path (no wildcard, e.g. `.env.example`) has no parent to
    // probe separately from itself, so probing it here checked it more
    // strictly than a bare wildcard glob and disagreed with render's own
    // any-depth drop logic (the repo-d trial hit this). Let the unified
    // tracked-set check below decide the literal case.
    let probe = '';
    if (firstGlob !== -1) {
      const lastSlash = glob.lastIndexOf('/', firstGlob);
      probe = lastSlash === -1 ? '' : glob.slice(0, lastSlash);
    }
    if (probe && !existsSync(join(repoRoot, probe))) {
      findings.push(mk('drift', docPath, null, 'paths glob', glob));
      continue;
    }
    // Borrowed from ctxlint: the root-dir probe above only proves the glob's
    // literal prefix exists on disk, not that the glob actually selects
    // anything -- `src/pages/services*` passes the probe (`src/pages/`
    // exists) even when nothing under it starts with `services`. Re-check
    // against the real glob engine over the tracked set.
    if (!allTracked.some((f) => globToRegExp(glob).test(f))) {
      findings.push(mk('drift', docPath, null, 'paths glob', glob));
    }
  }
}

// A path inside a SKILL.md is conventionally relative to that skill's own
// folder (scripts/, references/, assets/ per .claude/skills/README.md), not
// the repo root. Ported from repo-b's checker, which has this fallback;
// ours lost it. Matches at any depth, not only the repo root, so a nested
// package's skills re-root the same way (#33).
function skillDirFor(docPath) {
  const m = docPath.match(/^((?:[^/]+\/)*\.claude\/skills\/[^/]+)\//);
  return m ? m[1] : null;
}

// Second chance for kind-(c) path anchors: some repos have real, useful
// directories that are gitignored (build reports, gold-set exports) and so
// never appear in `git ls-files`. The tracked set stays the primary check --
// it is also what gives kind (c) case-exactness on a case-insensitive
// filesystem like macOS's default APFS, where a bare `existsSync` would
// happily accept the wrong case.
//
// #21: this used to be a DISK probe, which made existence a property of the
// machine rather than of the repo. A gitignored path exists on the developer's
// checkout and never on a runner's, so `check:house` passed locally and the
// identical run failed in CI -- the pathology that hid in repo-d for a
// week while its `pull_request` trigger was off (`repo-g/.env`,
// `app/node_modules`, `.claude/worktrees/*`; all three correct, two of which
// must never be committed). A check that only passes where the untracked files
// happen to be is not a check.
//
// So ask git what it IGNORES instead of asking the filesystem what is there.
// Ignore rules are committed, so the answer is the same on every checkout, and
// "git deliberately keeps this out of the tree" is a far better reason to
// exempt a path than "it happens to be on this disk".
//
// Returns 'ignored' | 'local-only' | null. 'local-only' means the rule that
// hid it does NOT travel with the repo (.git/info/exclude, or a global
// core.excludesFile), so it resolves here and nowhere else -- the same
// divergence in a quieter form. That still passes, but it warns.
function ignoreStatus(repoRoot, relPath, cache) {
  if (cache.has(relPath)) return cache.get(relPath);
  // Probe BOTH spellings. A `dir/` pattern matches only a directory, and git
  // cannot tell that a path it can't see is one, so `.claude/worktrees` misses
  // a `.claude/worktrees/` rule while `.claude/worktrees/` hits it. Asking for
  // both in one call costs nothing and covers the file and directory forms.
  const withSlash = `${relPath}/`;
  const m = gitIgnoredMap(repoRoot, [relPath, withSlash]);
  // A null map means git could not answer (not a repo, no git on PATH). Say
  // nothing rather than print a pass we did not earn.
  const source = m === null ? null : m.get(relPath) ?? m.get(withSlash) ?? null;
  const status = source === null ? null : (/(^|\/)\.gitignore:/.test(source) ? 'ignored' : 'local-only');
  cache.set(relPath, status);
  return status;
}

function checkAnchorToken(tok, docPath, lineNo, o) {
  // (g) heading link path/to/file.md#slug -- checked first since it also
  // contains `.md` and would otherwise never match kind (c)'s charset (no
  // `#` allowed there), but keeping it first avoids relying on that.
  const headingLinkMatch = tok.match(/^([^\s#`]+\.md)#([a-z0-9][a-z0-9-]*)$/);
  if (headingLinkMatch) {
    const [, relPath, slug] = headingLinkMatch;
    // Same re-rooting order as kind (c): repo root, then this doc's package
    // root (#33), then its skill dir. Without it a doc under a package root
    // linking a sibling .md#slug relative to that root is a false finding.
    const skillDir = skillDirFor(docPath);
    const candidates = [relPath];
    if (o.docPkgRoot) candidates.push(`${o.docPkgRoot}/${relPath}`);
    if (skillDir) candidates.push(`${skillDir}/${relPath}`);
    const found = candidates.map((p) => join(o.repoRoot, p)).find((abs) => existsSync(abs));
    if (!found) { o.findings.push(mk('drift', docPath, lineNo, 'heading link', tok)); return; }
    const headings = extractHeadings(safeRead(found));
    if (!headings.some((h) => githubSlug(h.text) === slug)) {
      o.findings.push(mk('drift', docPath, lineNo, 'heading link', tok));
    }
    return;
  }

  // (a) npm run <name>
  const npmMatch = tok.match(/^npm run ([a-zA-Z0-9:_-]+)(?:\s+-{0,2}.*)?$/);
  if (npmMatch) {
    if (o.npmScripts === null) return; // no package.json in the target repo: not applicable
    if (o.houseManaged) return; // a managed file names the package's script vocabulary, not this repo's
    if (!o.npmScripts.has(npmMatch[1])) o.findings.push(mk('drift', docPath, lineNo, 'npm script', tok));
    return;
  }

  // (b) bare script name: a lifecycle name, or a colon-namespaced token
  // whose first segment matches the namespace of at least one existing
  // package.json script. That extra gate is what keeps this kind from
  // firing on every `key:value`-shaped prose token (`og:description`,
  // `astro:assets`, `stale:true`, `limit:1`, ...) -- it fires only when the
  // repo's own scripts establish that segment as a real script namespace.
  if (isBareScriptToken(tok)) {
    if (o.bareScriptAllowlist.has(tok)) return;
    if (o.npmScripts === null) return; // no package.json in the target repo: not applicable
    if (o.houseManaged) return; // same reason as (a): the package cannot know this repo's scripts
    if (!LIFECYCLE_NAMES.has(tok)) {
      const namespace = tok.slice(0, tok.indexOf(':'));
      if (!o.scriptNamespaces.has(namespace)) return; // no sibling script in this namespace
    }
    if (!o.npmScripts.has(tok)) o.findings.push(mk('drift', docPath, lineNo, 'bare script', tok));
    return;
  }

  // (c) file path under a real top-level dir (of the repo, or of this doc's
  // own package root when one is declared, #33)
  if ((o.pathPrefixRe && o.pathPrefixRe.test(tok)) || (o.pkgPathPrefixRe && o.pkgPathPrefixRe.test(tok))) {
    // P10: match on a path SEGMENT boundary, so a `dist` prefix exempts
    // `dist/x` but not `distribution/x`.
    if (o.buildArtifactPrefixes.some((p) => { const q = p.replace(/\/$/, ''); return tok === q || tok.startsWith(q + '/'); })) return;
    if (/[*[]/.test(tok)) {
      // #21: the same tracked-set-then-ignore-rules resolution as a plain path
      // below. This used to be a bare existsSync, which made a glob parent
      // resolve on the machine that had the directory and nowhere else.
      const dir = tok.replace(/\/[^/]*[*[][^/]*.*$/, '');
      if (!o.pathExists(dir) && !(o.docPkgRoot && o.pathExists(`${o.docPkgRoot}/${dir}`))) {
        o.findings.push(mk('drift', docPath, lineNo, 'glob parent', tok));
      }
      return;
    }
    if (o.pathExists(tok)) return;
    // #33: a doc under a declared package root resolves against that root
    // first, the way a skill doc resolves against its own dir just below.
    if (o.docPkgRoot && o.pathExists(`${o.docPkgRoot}/${tok}`)) return;
    // A path inside a skill's own doc is conventionally relative to that
    // skill's directory (scripts/, references/, assets/), not repo root.
    const skillDir = skillDirFor(docPath);
    if (skillDir && o.pathExists(`${skillDir}/${tok}`)) return;
    o.findings.push(mk('drift', docPath, lineNo, 'file path', tok));
    return;
  }

  // (h) CamelCase component name >= 4 chars ending in a configured suffix.
  //
  // Resolved against the EXACT basename set built from componentRoots x
  // componentExts, never against a substring of the haystack. A substring
  // test passes `RaceCard` on the strength of a file called
  // `RaceCardV2.astro`, so the single most common drift shape in a component
  // tree -- rename by suffix -- stops being caught at all. The set is
  // rebuilt per run from the tracked tree, so a renamed file leaves the set
  // in the same commit that renames it.
  //
  // #14: a backticked reference may spell the extension out (`Foo.astro`).
  // The CamelCase test below never matched that (the `.` breaks it), so the
  // token fell through unchecked and a renamed `Foo.astro` reference went
  // silently stale. Strip a trailing `.astro` before resolving, so the
  // (extension-less) basename set can answer it. The finding still reports
  // the token exactly as written.
  //
  // P11: when componentSuffixes is empty this whole kind is a DELIBERATE
  // no-op -- the common, correct case of a repo with no component namespace
  // (`.some()` over [] is false). That silent-disable is intended, not a hole:
  // there is nothing to resolve against, so nothing is flagged and nothing is
  // warned.
  // Every configured extension, not only `.astro`: the basename set is built
  // from all of them, so a `Foo.tsx` reference must be able to reach it too.
  const ext = arr(o.componentExts).find((e) => tok.endsWith(e));
  const componentName = ext ? tok.slice(0, -ext.length) : tok;
  if (/^[A-Z][A-Za-z0-9]+$/.test(componentName) && componentName.length >= 4 && o.componentSuffixes.some((s) => componentName.endsWith(s))) {
    if (o.componentAllowlist.has(componentName)) return;
    if (o.componentBasenames.has(componentName)) return;
    o.findings.push(mk('drift', docPath, lineNo, 'component', tok));
    return;
  }

  // (d) section id reference: `#name`
  const idMatch = tok.match(/^#([a-z][a-z0-9-]+)$/);
  if (idMatch) {
    const id = idMatch[1];
    if (!o.haystackText.includes(`id="${id}"`) && !o.haystackText.includes(`id='${id}'`)) {
      o.findings.push(mk('drift', docPath, lineNo, 'section id', tok));
    }
    return;
  }

  // (e) configured class-prefix token.
  // P11: an empty classPrefixes is a DELIBERATE no-op, the same as (h)'s empty
  // componentSuffixes -- `find()` over [] is undefined, so no class token ever
  // resolves and none is flagged. A repo with no class namespace is the common,
  // correct case; the silent-disable is intended, not a suppression hole.
  const stripped = tok.replace(/^\./, '');
  if (/^[a-z][a-z0-9-]*$/.test(stripped)) {
    const prefix = o.classPrefixes.find((p) => stripped.startsWith(p));
    if (prefix) {
      if (!o.haystackText.includes(stripped)) o.findings.push(mk('drift', docPath, lineNo, 'class', tok));
      return;
    }
  }

  // (f) ALL_CAPS_WITH_UNDERSCORES, >= 6 chars
  if (/^[A-Z][A-Z0-9_]{5,}$/.test(tok) && tok.includes('_')) {
    if (!o.haystackText.includes(tok)) o.findings.push(mk('drift', docPath, lineNo, 'env/const', tok));
    return;
  }

  // Anything else: skip silently. We only enforce anchors that look load-bearing.
}

const DEFAULT_COMPONENT_ROOTS = ['src'];
const DEFAULT_COMPONENT_EXTS = ['.astro', '.jsx', '.tsx', '.vue', '.svelte'];

// Every basename (extension dropped) of a tracked file under one of the
// component roots whose extension is one of the component extensions. This
// is the answer-key kind (h) resolves against, and it is derived from the
// tree rather than declared, so it cannot drift away from the files.
function collectComponentBasenames(allTracked, roots, exts) {
  const out = new Set();
  for (const f of allTracked) {
    if (!roots.some((r) => matchesConfigPath(f, r))) continue;
    const ext = exts.find((e) => f.endsWith(e));
    if (!ext) continue;
    const base = f.slice(f.lastIndexOf('/') + 1, f.length - ext.length);
    if (base) out.add(base);
  }
  return out;
}

function checkDrift(ctx) {
  const findings = [];
  const warnings = [];
  const cfg = moduleConfig(ctx.house, 'docs');
  const excludeEntries = arr(cfg.excludeFiles).map(normalizePathEntry).filter(Boolean);
  const archiveEntries = arr(cfg.archiveDirs).map(normalizePathEntry).filter(Boolean);
  const excludeFiles = excludeEntries.map((e) => e.path);
  const archiveDirs = archiveEntries.map((e) => e.path);
  const scanArchive = cfg.scanArchive === true;
  const roots = arr(cfg.roots);
  const allowlistEntries = arr(cfg.bareScriptAllowlist).map(normalizeAllowlistEntry).filter(Boolean);
  const bareScriptAllowlist = new Set(allowlistEntries.map((e) => e.token));
  const extraPathRoots = arr(cfg.extraPathRoots);
  // #33: nested npm packages. Longest dir first, so the deepest declared root
  // wins for a doc under nested roots (`apps` and `apps/web`).
  const packageRoots = arr(cfg.packageRoots)
    .map((e) => (isNonEmptyString(e) ? e : (isPlainObject(e) && isNonEmptyString(e.dir) ? e.dir : null)))
    .filter(Boolean)
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s && isInsideRoot(ctx.repoRoot, s))
    .sort((a, b) => b.length - a.length);
  const buildArtifactPrefixes = arr(cfg.buildArtifactPrefixes);
  const haystackDirs = arr(cfg.haystackDirs);
  const classPrefixes = arr(cfg.classPrefixes);
  const componentSuffixes = arr(cfg.componentSuffixes);
  const componentAllowlist = new Set(arr(cfg.componentAllowlist));
  const componentRoots = arr(cfg.componentRoots).length ? arr(cfg.componentRoots) : DEFAULT_COMPONENT_ROOTS;
  const componentExts = arr(cfg.componentExts).length ? arr(cfg.componentExts) : DEFAULT_COMPONENT_EXTS;
  const componentBasenames = collectComponentBasenames(ctx.allTracked, componentRoots, componentExts);

  // The package repo is the one that OWNS the managed prose: its module
  // sources are here, so an unresolved token in a vendored rule is editable
  // and must fail. Everywhere else the same token is a warning.
  const isPackageRepo = existsSync(join(ctx.repoRoot, 'plugins', 'house', 'modules'));

  // Companion to the consumer-side PACKAGE_SURFACE_PREFIXES drop (ADR 0010):
  // a prefix that matches nothing tracked HERE would silence consumer
  // warnings for a surface that no longer exists, invisibly. Same hole the
  // P3 warning below closes for the allowlist, so it fails the same way.
  if (isPackageRepo) {
    for (const p of PACKAGE_SURFACE_PREFIXES) {
      if (!ctx.allTracked.some((f) => f.startsWith(p))) {
        findings.push(mk('drift', '.house/check.mjs', null, 'stale suppression', `PACKAGE_SURFACE_PREFIXES entry \`${p}\` matches nothing tracked in the package repo; a prefix that names nothing suppresses consumer warnings for a surface that no longer exists`));
      }
    }
  }

  // P2: the findings->warnings downgrade must be AUTHENTICATED. A file gets the
  // house-managed treatment only if the lock records it as managed (or this IS
  // the package repo, whose module sources are the authority). Otherwise a
  // consumer could paste `<!-- house-managed -->` atop any README to demote its
  // real drift to non-blocking warnings. A marker on an unlocked file is itself
  // a finding (a forged managed header).
  const lockedManaged = loadLockManagedPaths(ctx.repoRoot);
  const lockedHashes = loadLockManagedHashes(ctx.repoRoot);

  const ALWAYS_INCLUDE = ['.claude/rules/', '.claude/skills/', '.claude/commands/'];
  const allMd = ctx.allTracked.filter((f) => f.endsWith('.md'));

  const scanned = allMd.filter((f) => {
    if (ALWAYS_INCLUDE.some((p) => f.startsWith(p))) return true;
    if (excludeFiles.some((p) => matchesConfigPath(f, p))) return false;
    if (!scanArchive && archiveDirs.some((p) => matchesConfigPath(f, p))) return false;
    return true;
  });
  const scannedSet = new Set(scanned);

  // Self-consistency: a configured root must resolve to something, and
  // everything tracked under it must have survived into `scanned`.
  for (const root of roots) {
    const matches = allMd.filter((f) => matchesConfigPath(f, root));
    if (matches.length === 0) {
      findings.push(mk('drift', 'house.json', null, 'zero-match root', `modules.docs.config.roots entry \`${root}\` matches zero tracked .md files`));
      continue;
    }
    for (const f of matches) {
      if (!scannedSet.has(f)) {
        findings.push(mk('drift', f, null, 'root missing from scan', `tracked under configured root \`${root}\` but excluded from the scanned set`));
      }
    }
  }

  // P9: an excludeFiles/archiveDirs entry that drops a tracked .md is only
  // self-checked by the opt-in roots loop above, which most repos leave empty.
  // A doc removed from the scan that does NOT itself carry a
  // `docs-drift-ignore-file` marker never opted out, so its exclusion is
  // suspicious (repo-a's design-history.md carried a live gate claim
  // behind exactly such an exclude): warn, do not block. Scoped to consumer
  // repos on purpose: the house package repo legitimately excludes dozens of
  // its own authored sources (module rules, templates, evals, handbook, ADRs)
  // that would otherwise flood drift with false findings, and warning on all
  // of them every run would train maintainers to ignore warnings. The same
  // `isPackageRepo` authority that vouches for its managed markers (P2) exempts
  // its exclusions here; consumers, where the check matters, get full coverage.
  if (!isPackageRepo) {
    for (const f of allMd) {
      if (scannedSet.has(f)) continue;
      const head = headWindow(safeRead(join(ctx.repoRoot, f)).split('\n'));
      const optedOut = head.some((l) => /<!--\s*docs-drift-ignore-file(?::[^>]*?)?\s*-->/.test(l));
      // ADR 0009: an exclusion whose config entry carries a `why` opted out in
      // house.json, which is the right home when the file is a living doc the
      // checker cannot scan rather than a point-in-time record (the marker's
      // documented meaning).
      const droppedWithReason = [...excludeEntries, ...archiveEntries]
        .some((e) => e.why && matchesConfigPath(f, e.path));
      if (!optedOut && !droppedWithReason) {
        warnings.push(mk('drift', f, null, 'excluded', 'tracked doc is dropped from the drift scan by excludeFiles/archiveDirs but never opted out: it carries no `docs-drift-ignore-file` marker and its config entry has no `why`. Add the marker (with a reason) if the doc is a point-in-time record, give the entry the {"path", "why"} form if the exclusion is structural, or drop the entry.'));
      }
    }
  }

  let pkg = null;
  const pkgPath = join(ctx.repoRoot, 'package.json');
  if (existsSync(pkgPath)) { try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { pkg = null; } }
  const npmScripts = pkg ? new Set(Object.keys(pkg.scripts || {})) : null;
  const bareScriptNamespaces = scriptNamespaces(npmScripts);

  // #33: read each declared package root's package.json once. A doc under a
  // root sees the UNION of that root's scripts and the repo root's (a monorepo
  // doc may legitimately name either), so declaring a root can only resolve
  // more tokens, never fewer.
  const rootPkgScripts = new Map();
  for (const dir of packageRoots) {
    const p = join(ctx.repoRoot, dir, 'package.json');
    if (!existsSync(p)) continue;
    try {
      rootPkgScripts.set(dir, new Set(Object.keys(JSON.parse(readFileSync(p, 'utf8')).scripts || {})));
    } catch { /* malformed nested package.json: that root resolves against the repo root only */ }
  }
  const scriptsCache = new Map();
  const scriptsForRoot = (dir) => {
    const key = dir || '';
    if (scriptsCache.has(key)) return scriptsCache.get(key);
    const sub = dir ? rootPkgScripts.get(dir) : null;
    let merged;
    if (!sub) merged = npmScripts;
    else {
      merged = new Set(sub);
      if (npmScripts) for (const s of npmScripts) merged.add(s);
    }
    scriptsCache.set(key, merged);
    return merged;
  };
  const namespacesCache = new Map();
  const namespacesForRoot = (dir) => {
    const key = dir || '';
    if (!namespacesCache.has(key)) namespacesCache.set(key, dir && rootPkgScripts.has(dir) ? scriptNamespaces(scriptsForRoot(dir)) : bareScriptNamespaces);
    return namespacesCache.get(key);
  };
  const packageRootFor = (docPath) => packageRoots.find((dir) => docPath.startsWith(`${dir}/`)) || null;

  // P3: an allowlist is a pure exemption that is never validated, so a stale or
  // aspirational entry hides drift forever. A `check:`-namespaced (or any
  // colon-namespaced) bareScriptAllowlist token that names NO existing script
  // is almost certainly masking a genuinely-missing command that a doc claims
  // as live (repo-c's check:unmapped / check:books). Warn so the exemption is
  // visible and can be removed once the script exists or the doc is corrected.
  // Every declared package root's scripts count as existing (#33), and an
  // entry carrying a `why` recorded itself as never-a-script (ADR 0009).
  const allScriptSets = [npmScripts, ...rootPkgScripts.values()].filter(Boolean);
  if (allScriptSets.length) {
    for (const e of allowlistEntries) {
      if (e.why) continue;
      if (e.token.includes(':') && !allScriptSets.some((s) => s.has(e.token))) {
        warnings.push(mk('drift', 'house.json', null, 'allowlist', `bareScriptAllowlist entry \`${e.token}\` names no script in package.json${packageRoots.length ? ' (repo root or any packageRoots manifest)' : ''}. If a doc claims it as live, that claim is drift the allowlist is hiding; drop the entry once the script exists, correct the doc to future tense, or record it as {"token": "${e.token}", "kind": "not-a-script", "why": "..."} if it will never be one.`));
      }
    }
  }

  const topDirs = new Set();
  for (const f of ctx.allTracked) {
    const i = f.indexOf('/');
    if (i !== -1) topDirs.add(f.slice(0, i));
  }
  for (const r of extraPathRoots) topDirs.add(r.replace(/\/$/, ''));
  for (const p of buildArtifactPrefixes) { const seg = p.split('/')[0]; if (seg) topDirs.add(seg); }
  const topDirsList = [...topDirs].filter(Boolean);
  const pathPrefixRe = topDirsList.length
    ? new RegExp(`^(${topDirsList.map(escapeRegExp).join('|')})/[A-Za-z0-9._/\\[\\]*-]+$`)
    : null;

  // #33: a doc under a package root may name paths relative to that root
  // (`lib/x.mjs` for `<root>/lib/x.mjs`), whose first segment is not a
  // repo-level top dir. Classify those against the root's OWN top-level dirs,
  // built per root and applied only to docs under it, so docs elsewhere in
  // the repo keep exactly the classifier they had.
  const pkgPrefixReCache = new Map();
  const pkgPrefixReForRoot = (dir) => {
    if (!pkgPrefixReCache.has(dir)) {
      const subDirs = new Set();
      const prefix = `${dir}/`;
      for (const f of ctx.allTracked) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i !== -1) subDirs.add(rest.slice(0, i));
      }
      const list = [...subDirs].filter(Boolean);
      pkgPrefixReCache.set(dir, list.length ? new RegExp(`^(${list.map(escapeRegExp).join('|')})/[A-Za-z0-9._/\\[\\]*-]+$`) : null);
    }
    return pkgPrefixReCache.get(dir);
  };

  const trackedSet = new Set();
  for (const f of ctx.allTracked) {
    trackedSet.add(f);
    let i = f.indexOf('/');
    while (i !== -1) { trackedSet.add(f.slice(0, i)); trackedSet.add(f.slice(0, i + 1)); i = f.indexOf('/', i + 1); }
  }
  // #21: paths whose only resolution was a local-only ignore rule, collected
  // during the scan and reported once at the end so the divergence is visible
  // where it can still be fixed -- locally, not in a CI log.
  const ignoreCache = new Map();
  const localOnly = new Map();
  const pathExists = (p) => {
    const trimmed = p.replace(/\/$/, '');
    if (trackedSet.has(p) || trackedSet.has(trimmed)) return true;
    const status = ignoreStatus(ctx.repoRoot, trimmed, ignoreCache);
    if (status === 'local-only') localOnly.set(trimmed, true);
    return status !== null;
  };

  const haystackText = collectHaystack(ctx.repoRoot, ctx.allTracked, haystackDirs);

  for (const docPath of scanned) {
    const abs = join(ctx.repoRoot, docPath);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, 'utf8');
    const lines = raw.split('\n');

    if (docPath.startsWith('.claude/rules/')) validateRulesFrontmatter(docPath, raw, ctx.repoRoot, findings, ctx.allTracked);

    // Managed prose belongs to the package. Route its unresolved tokens to
    // warnings unless this IS the package repo (see the header comment).
    const markerPresent = isHouseManagedDoc(raw);
    // P2: a marker only authenticates when the lock (or the package repo)
    // vouches for this file. A marker on a file the lock does not record is a
    // forgery: its findings are NOT demoted, and the forged header is flagged.
    const lockVouches = isPackageRepo || lockedManaged.has(docPath);
    if (markerPresent && !lockVouches) {
      findings.push(mk('drift', docPath, 1, 'forged managed header', 'carries a `<!-- house-managed -->` marker but is not recorded in .house/lock.json; a repo-authored file cannot claim managed status to dodge the gate'));
    }
    const houseManaged = markerPresent && lockVouches;
    // ADR 0010's silent drop demands MORE than the downgrade: the on-disk
    // body must still be the one the lock recorded. A locally modified
    // managed file keeps the loud downgrade warnings, so the silence can
    // never hide a hand edit (the tamper family names the edit itself, but
    // only when that family runs).
    const bodyMatchesLock = isPackageRepo || lockedHashes.get(docPath) === sha256Hex(managedBody(raw));
    // A managed rule may name a sibling module's vendored destination
    // (scripts/house/* or .house/*). Whether that file exists is a per-repo
    // enablement choice, not drift, so those tokens are always warnings in a
    // managed file, even in the package repo. Every other unresolved token in
    // a managed file is a warning in a consumer (the package owns the surface)
    // but a real finding in the package repo, which must catch its own drift.
    const siblingDest = (f) => f.kind === 'file path' && typeof f.message === 'string' && /^(scripts\/house\/|\.house\/)/.test(f.message);
    // ADR 0010: a token naming the package's own tree in a lock-vouched
    // managed file is permanently unactionable in a consumer, so it is
    // dropped, not downgraded. Receipts lines are HEADING LINKS, not file
    // paths, which is why the predicate matches three kinds.
    const packageSurface = (f) => typeof f.message === 'string'
      && (f.kind === 'file path' || f.kind === 'heading link' || f.kind === 'glob parent')
      && PACKAGE_SURFACE_PREFIXES.some((p) => f.message.startsWith(p));
    const downgrade = (f, why) => warnings.push({ ...f, message: `${f.message} ${why}` });
    const sink = houseManaged
      ? { push: (f) => {
          if (siblingDest(f)) return downgrade(f, '(house-managed file: names a sibling module\'s vendored file, present only when that module is enabled here)');
          if (!isPackageRepo) {
            if (packageSurface(f) && bodyMatchesLock) return;
            return downgrade(f, '(house-managed file: this token names the house package\'s own surface, or a wiring step this repo has not done yet; it is gated in the package repo, not here)');
          }
          findings.push(f);
        } }
      : findings;

    // P13: a whole-file opt-out must record WHY, mirroring a deviations entry.
    // Capture the reason after the colon; a marker with no non-empty reason
    // suppresses ALL of a file's drift with no justification, so warn. The file
    // is still exempted (this does not block); it just refuses to let a blanket
    // opt-out stay silent about its reason.
    let fileIgnored = false;
    let fileIgnoreReason = null;
    for (const l of headWindow(lines)) {
      const m = l.match(/<!--\s*docs-drift-ignore-file(?::([^>]*?))?\s*-->/);
      if (m) { fileIgnored = true; fileIgnoreReason = m[1] ?? null; break; }
    }
    if (fileIgnored) {
      if (!isNonEmptyString(fileIgnoreReason)) {
        warnings.push(mk('drift', docPath, null, 'ignore-file', 'whole-file `docs-drift-ignore-file` opt-out carries no reason. Add one after a colon (`<!-- docs-drift-ignore-file: why this file opts out -->`) so a blanket suppression always records why.'));
      }
      continue;
    }

    // Every value here is a per-doc constant, so build the option object once
    // per doc, not once per token. docPkgRoot re-roots kinds (a)(b)(c) for a
    // doc under a declared package root (#33).
    const docPkgRoot = packageRootFor(docPath);
    const docOpts = {
      npmScripts: scriptsForRoot(docPkgRoot), scriptNamespaces: namespacesForRoot(docPkgRoot),
      bareScriptAllowlist, pathPrefixRe, pkgPathPrefixRe: docPkgRoot ? pkgPrefixReForRoot(docPkgRoot) : null,
      buildArtifactPrefixes, pathExists, componentAllowlist, componentSuffixes, componentBasenames,
      componentExts, haystackText, classPrefixes, repoRoot: ctx.repoRoot, houseManaged,
      findings: sink, docPkgRoot,
    };

    let inFence = false;
    let fenceStart = -1;
    let inComment = false;
    let pendingIgnore = false;

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      if (/^\s*```/.test(line)) { inFence = !inFence; fenceStart = inFence ? lineNo : -1; return; }
      if (inFence) return;

      let scan = line;
      if (inComment) {
        const end = scan.indexOf('-->');
        if (end === -1) return;
        scan = scan.slice(end + 3);
        inComment = false;
      }
      while (scan.includes('<!--')) {
        const start = scan.indexOf('<!--');
        const end = scan.indexOf('-->', start + 4);
        if (end === -1) { scan = scan.slice(0, start); inComment = true; break; }
        scan = scan.slice(0, start) + scan.slice(end + 3);
      }

      // The marker suppresses the line IMMEDIATELY below it and nothing
      // else, blank or not. Skipping blank lines to reach the next non-blank
      // one lets one stray or orphaned marker cover a claim written later
      // and somewhere else, which is the opposite of what a deliberate,
      // narrow suppression is for.
      const ignoreMatch = line.match(/<!--\s*docs-drift-ignore(?!-file)\b(?::[^>]*?)?\s*-->/);
      if (ignoreMatch) { pendingIgnore = true; return; }
      if (pendingIgnore) { pendingIgnore = false; return; }

      for (const m of scan.matchAll(/`([^`]+)`/g)) {
        checkAnchorToken(m[1], docPath, lineNo, docOpts);
      }
    });
    if (inFence) sink.push(mk('drift', docPath, fenceStart, 'unclosed fence', '```'));
  }

  // #21: a pass that depends on an uncommitted ignore rule is a pass this
  // repo cannot reproduce anywhere else. Not a finding (the path really is
  // hidden on purpose here) but never silent either.
  for (const p of localOnly.keys()) {
    warnings.push(mk('drift', '.gitignore', null, 'local-only ignore', `\`${p}\` resolves only because a local-only rule hides it (.git/info/exclude, or a global core.excludesFile). Those do not travel with the repo, so a fresh checkout -- CI, or a teammate -- will flag this path instead. Commit the ignore rule, or list the path in modules.docs.config.buildArtifactPrefixes.`));
  }

  return { findings, warnings, scanned };
}

// ── todo ─────────────────────────────────────────────────────────────────

function checkTodo(ctx) {
  const findings = [];
  const abs = join(ctx.repoRoot, 'CLAUDE.md');
  if (!existsSync(abs)) return { findings, warnings: [] };
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('TODO:')) findings.push(mk('todo', 'CLAUDE.md', idx + 1, 'todo', line.trim()));
  });
  return { findings, warnings: [] };
}

// ── tamper ───────────────────────────────────────────────────────────────

function tamperMessage(p) {
  return `${p} no longer matches its managed source. Exits: propose the change upstream in house, ` +
    `record a deviation and unmanage this file, or run \`house render --force-managed ${p}\` to accept local drift.`;
}

function checkTamper(ctx) {
  const findings = [];
  const warnings = [];
  const lockPath = join(ctx.repoRoot, '.house', 'lock.json');
  if (!existsSync(lockPath)) {
    // P1: a completed render must leave a lock. Its absence turns off the whole
    // tamper family, so it is a finding when the repo shows signs of adoption,
    // and a legitimate no-op only for a never-adopted repo.
    if (renderLooksComplete(ctx.repoRoot, ctx.house)) {
      findings.push(mk('tamper', '.house/lock.json', null, 'lock', 'a rendered house repo has no .house/lock.json, so managed-file integrity checking (tamper and deletion detection) is off. Run `house render --apply` to restore it.'));
    }
    return { findings, warnings };
  }
  let lock;
  try { lock = JSON.parse(readFileSync(lockPath, 'utf8')); } catch {
    findings.push(mk('tamper', '.house/lock.json', null, 'lock', 'invalid JSON'));
    return { findings, warnings };
  }
  const entries = Array.isArray(lock) ? lock : Array.isArray(lock.files) ? lock.files : [];

  const record = resolveHousePluginRecord(readInstalledPlugins());
  const pin = ctx.house.data?.version;
  const installedVersion = record && typeof record.version === 'string' ? record.version : null;
  const installedNewer = typeof pin === 'string' && SEMVER_RE.test(pin)
    && installedVersion && SEMVER_RE.test(installedVersion) && semverGt(installedVersion, pin);

  for (const entry of entries) {
    if (!isPlainObject(entry) || !entry.path) continue;
    const { path: relPath, module, source, bodySha256 } = entry;
    // F9: a lock entry whose path escapes the repo root is a manifest-level
    // defect, not a file to read through as if it were managed.
    if (!isInsideRoot(ctx.repoRoot, relPath)) {
      findings.push(mk('tamper', '.house/lock.json', null, 'lock', `lock entry path \`${relPath}\` escapes the repo root; refusing to read it`));
      continue;
    }
    const abs = join(ctx.repoRoot, relPath);
    if (!existsSync(abs)) {
      findings.push(mk('tamper', relPath, null, 'missing', `managed file from module \`${module}\` is missing`));
      continue;
    }
    const localRaw = readFileSync(abs, 'utf8');
    const localHash = sha256Hex(managedBody(localRaw));

    // PRIMARY, and version-robust: the lock records exactly the body render
    // wrote at the pinned version, so a mismatch is a local hand-edit. This is
    // the ONLY tamper oracle. The installed plugin is NOT compared body-to-
    // body: a vendored rule file carries frontmatter and the managed header
    // that its module source does not, so managedBody() of the two never
    // matches, and using the installed source as the oracle reds CI on every
    // rule file the moment the plugin is installed (F13, and worse).
    if (typeof bodySha256 === 'string' && bodySha256.length > 0) {
      if (localHash !== bodySha256) {
        findings.push(mk('tamper', relPath, null, 'tamper', tamperMessage(relPath)));
        continue;
      }
    }

    // SECONDARY advisory: the installed plugin is strictly newer than the pin
    // AND its source for this file differs from the source render captured
    // (recorded as body-sha256=<hash of the full source file> in the vendored
    // managed header). That is "your pin is behind and the rule text moved" --
    // a nudge to `/house-rules:sync`, never a finding. Compared source-hash to
    // source-hash, so it is immune to the frontmatter/header asymmetry above.
    if (installedNewer && record && record.installPath && typeof source === 'string' && source) {
      if (!isInsideRoot(record.installPath, source)) {
        findings.push(mk('tamper', '.house/lock.json', null, 'lock', `lock entry source \`${source}\` escapes the installed plugin root; refusing to read it`));
      } else {
        const recordedSourceHash = extractHeaderSourceHash(localRaw);
        const upstreamPath = join(record.installPath, source);
        if (recordedSourceHash && existsSync(upstreamPath)) {
          let installedSourceHash = null;
          try { installedSourceHash = sha256Hex(readFileSync(upstreamPath, 'utf8')); } catch { installedSourceHash = null; }
          if (installedSourceHash && installedSourceHash !== recordedSourceHash) {
            warnings.push(mk('tamper', relPath, null, 'behind-text', `${relPath} is unmodified against the pinned v${pin}, but installed plugin v${installedVersion} ships different source text for it (\`/house-rules:sync\` to adopt the newer rule).`));
          }
        }
      }
    }
  }
  return { findings, warnings };
}

// Pull the source-file hash render stamped into a vendored file's managed
// header (`... body-sha256=<64 hex> ...`). Returns null for a plain vendored
// file (a copied module `files[]` entry has no such header).
function extractHeaderSourceHash(raw) {
  const m = raw.match(/house-managed\b[^\n]*\bbody-sha256=([0-9a-f]{64})\b/);
  return m ? m[1] : null;
}

// ── behind ───────────────────────────────────────────────────────────────

function checkBehind(ctx) {
  const warnings = [];
  const pin = ctx.house.data?.version;
  if (typeof pin !== 'string' || !SEMVER_RE.test(pin)) return { findings: [], warnings };
  const installed = readInstalledPlugins();
  if (!installed) return { findings: [], warnings };
  const record = resolveHousePluginRecord(installed);
  if (!record) return { findings: [], warnings };
  const v = record.version;
  if (typeof v !== 'string' || !SEMVER_RE.test(v)) return { findings: [], warnings }; // "unknown" etc: stay silent
  if (semverGt(v, pin)) {
    warnings.push(mk('behind', 'house.json', null, 'behind', `pinned v${pin}; v${v} is installed and available (\`/house-rules:sync\` to upgrade)`));
  }
  return { findings: [], warnings };
}

// ── shape ────────────────────────────────────────────────────────────────

const SHAPE_STOPLIST = new Set([
  'overview', 'background', 'summary', 'context', 'notes', 'rationale', 'scope', 'purpose',
  'goals', 'motivation', 'definitions', 'glossary', 'references', 'examples', 'faq',
]);

function normalizeHeading(text) {
  const stop = new Set(['a', 'the', 'an']);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !stop.has(w))
    .join(' ')
    .trim();
}

function splitByH2(lines, h2) {
  const blocks = [];
  for (let i = 0; i < h2.length; i++) {
    const start = h2[i].line;
    const end = i + 1 < h2.length ? h2[i + 1].line - 1 : lines.length;
    blocks.push({ heading: h2[i].text, startLine: start, lines: lines.slice(start - 1, end) });
  }
  return blocks;
}

function extractFrontmatterName(raw) {
  const lines = raw.split('\n');
  const closeIdx = frontmatterCloseIndex(lines);
  if (closeIdx <= 0) return null;
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(/^name\s*:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

function checkShapeFile(file, raw, findings) {
  const lines = raw.split('\n');
  const headings = extractHeadings(raw);
  const h2 = headings.filter((h) => h.level === 2);

  if (!h2.some((h) => h.text.trim() === "Don't")) {
    findings.push(mk('shape', file, null, 'shape', "missing required `## Don't` section"));
  }

  for (const h of h2) {
    if (h.text.trim() === "Don't") continue;
    const firstWord = (h.text.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z'-]/g, '');
    if (!firstWord) continue;
    if (SHAPE_STOPLIST.has(firstWord) || /ing$/.test(firstWord) || /ion$/.test(firstWord) || /s$/.test(firstWord)) {
      findings.push(mk('shape', file, h.line, 'shape', `heading "${h.text}" may not start with an imperative verb (\`${firstWord}\`)`));
    }
  }

  let inFence = false;
  let inComment = false;
  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;

    let scan = line;
    if (inComment) {
      const end = scan.indexOf('-->');
      if (end === -1) return;
      scan = scan.slice(end + 3);
      inComment = false;
    }
    while (scan.includes('<!--')) {
      const start = scan.indexOf('<!--');
      const end = scan.indexOf('-->', start + 4);
      if (end === -1) { scan = scan.slice(0, start); inComment = true; break; }
      scan = scan.slice(0, start) + scan.slice(end + 3);
    }

    if (/\b20\d\d-\d\d\b/.test(scan)) findings.push(mk('shape', file, idx + 1, 'shape', 'date-like token in rule prose'));
    if (/\d+%/.test(scan)) findings.push(mk('shape', file, idx + 1, 'shape', 'percent-like token in rule prose'));
  });

  const blocks = splitByH2(lines, h2);
  let noneCount = 0;
  for (const block of blocks) {
    const anchorLines = block.lines.filter((l) => /^\s*Anchor:/.test(l));
    if (anchorLines.length === 0) {
      findings.push(mk('shape', file, block.startLine, 'shape', `rule block "${block.heading}" has no \`Anchor:\` line`));
      continue;
    }
    for (const al of anchorLines) {
      const val = al.replace(/^\s*Anchor:\s*/, '').trim();
      if (/^none\b/.test(val)) {
        noneCount++;
        if (!/^none\s*\(because .+\)/.test(val)) {
          findings.push(mk('shape', file, block.startLine, 'shape', "`Anchor: none` must read `Anchor: none (because ...)`"));
        }
      }
    }
  }
  if (noneCount > 3) findings.push(mk('shape', file, null, 'shape', `more than three \`Anchor: none\` entries (${noneCount})`));

  const norms = new Map();
  for (const h of h2) {
    const norm = normalizeHeading(h.text);
    if (norms.has(norm)) {
      findings.push(mk('shape', file, h.line, 'shape', `heading "${h.text}" duplicates "${norms.get(norm)}" after normalization`));
    } else {
      norms.set(norm, h.text);
    }
  }
}

// The em-dash ban, split out of checkShapeFile because it no longer runs on
// the same file set: rule files are one surface it can cover, not the only
// one. Scans fences and comments too, on purpose -- a pasted snippet is still
// prose a reader copies.
function checkEmDashFile(file, raw, findings) {
  raw.split('\n').forEach((line, idx) => {
    if (line.includes('—')) findings.push(mk('shape', file, idx + 1, 'shape', 'em dash character'));
  });
}

const EM_DASH_DEFAULT = { mode: 'public', paths: ['README.md', 'CHANGELOG.md', 'docs/**/*.md'], exclude: [] };
const EM_DASH_MODES = new Set(['public', 'all', 'off']);

// modules.docs.config.emDash, read field by field: a malformed field falls
// back to its own default rather than taking the whole slot (and the scan)
// down with it. A typo therefore reverts that field to the default set rather
// than turning the scan off. That is not the same as widening: a repo whose
// `paths` is broader than the default loses the extra coverage until the typo
// is fixed, which is exactly why the manifest family names every defect
// instead of leaving it to be noticed.
function emDashConfig(house) {
  const raw = moduleConfig(house, 'docs').emDash;
  const cfg = isPlainObject(raw) ? raw : {};
  const list = (v, fallback) => {
    if (!Array.isArray(v)) return fallback;
    const out = v.map(normalizePathEntry);
    return out.every(Boolean) ? out.map((e) => e.path) : fallback;
  };
  return {
    mode: EM_DASH_MODES.has(cfg.mode) ? cfg.mode : EM_DASH_DEFAULT.mode,
    paths: list(cfg.paths, EM_DASH_DEFAULT.paths),
    exclude: list(cfg.exclude, EM_DASH_DEFAULT.exclude),
  };
}

function checkShape(ctx) {
  const findings = [];
  const ruleFiles = ctx.allTracked.filter((f) =>
    (matchesConfigPath(f, '.claude/rules/house') && f.endsWith('.md')) ||
    globToRegExp('plugins/house/modules/**/rules/*.md').test(f));
  for (const file of ruleFiles) {
    checkShapeFile(file, safeRead(join(ctx.repoRoot, file)), findings);
  }

  const em = emDashConfig(ctx.house);
  if (em.mode !== 'off') {
    const inPublic = ctx.allTracked.filter((f) =>
      em.paths.some((p) => matchesConfigPath(f, p)) && !em.exclude.some((p) => matchesConfigPath(f, p)));
    // `exclude` narrows the configured paths; under "all" the rule files come
    // back in whatever it says, because they are the surface this ban started
    // on and an exclusion must not be able to quietly drop them.
    const emFiles = em.mode === 'all' ? [...new Set([...inPublic, ...ruleFiles])] : inPublic;
    for (const file of emFiles) {
      checkEmDashFile(file, safeRead(join(ctx.repoRoot, file)), findings);
    }
  }

  const skillFiles = ctx.allTracked.filter((f) => /(^|\/)SKILL\.md$/.test(f));
  for (const file of skillFiles) {
    const raw = safeRead(join(ctx.repoRoot, file));
    const name = extractFrontmatterName(raw);
    const parts = file.split('/');
    const dirName = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (name && dirName && name !== dirName) {
      findings.push(mk('shape', file, null, 'shape', `SKILL.md frontmatter name \`${name}\` does not match its directory \`${dirName}\``));
    }
  }

  return { findings, warnings: [] };
}

// ── lengths ──────────────────────────────────────────────────────────────

// Native floor: the harness already measures its own auto-memory index when
// Claude writes it and warns or errors there, so this family's memory warning
// is a second surface for a machine-local file no repo gate can see, never
// the primary limit.

// Auto-memory index thresholds. The harness loads the first 200 lines of the
// index, or the first 25KB, whichever comes first, and drops the rest with no
// notice in the session, so the documented ceiling is a cliff and not a
// budget. MEMORY_INDEX_CAP_BYTES takes the conservative reading of "25KB"
// (25,000 rather than 25,600), and the two warn thresholds sit at roughly
// seven tenths of each cap: far enough below the cliff that the facts a long
// index is hiding can still be moved into their topic files in one pass,
// rather than after the tail has already stopped loading. A line past
// MEMORY_INDEX_MAX_LINE_CHARS has stopped being a cue to open a topic file and
// become the fact itself, which is what fills the cap in the first place.
const MEMORY_INDEX_CAP_LINES = 200;
const MEMORY_INDEX_CAP_BYTES = 25000;
const MEMORY_INDEX_WARN_LINES = 140;
const MEMORY_INDEX_WARN_BYTES = 17500;
const MEMORY_INDEX_MAX_LINE_CHARS = 160;

// Where the harness keeps this repo's auto-memory index. CLAUDE_CONFIG_DIR
// relocates the whole config tree (the same variable readInstalledPlugins
// honors). The project directory is named for the repo's absolute path with
// every separator turned into a dash (`/Users/x/repo` -> `-Users-x-repo`),
// unless CLAUDE_CODE_PROJECT_DIR_NAME names it instead, which the harness only
// honors when it is set BESIDE CLAUDE_CONFIG_DIR: on its own the harness
// ignores it, so reading it on its own here would point the check at a
// directory the harness never wrote. Returns a path that may well not exist:
// no CI checkout has one.
function memoryIndexPath(repoRoot) {
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const name = (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CODE_PROJECT_DIR_NAME) || repoRoot.replace(/\//g, '-');
  return join(cfgDir, 'projects', name, 'memory', 'MEMORY.md');
}

function checkLengths(ctx) {
  const findings = [];
  const cfg = moduleConfig(ctx.house, 'docs');
  const limits = isPlainObject(cfg.lengthLimits) ? cfg.lengthLimits : {};
  const ratchet = isPlainObject(ctx.house.data?.ratchet) ? ctx.house.data.ratchet : {};
  const ratchetRaises = Array.isArray(ctx.house.data?.ratchetRaises) ? ctx.house.data.ratchetRaises : [];

  if (Object.prototype.hasOwnProperty.call(ratchet, 'CLAUDE.md')) {
    findings.push(mk('lengths', 'house.json', null, 'ratchet', 'CLAUDE.md must never appear in `ratchet`'));
  }

  const warnings = [];

  // CLAUDE.md loads every session, so its length is the highest-value budget
  // in the package. It is also not ratchet-eligible (ADR 0003) and not
  // trimmable inside a mechanical adoption, which is why an over-limit
  // CLAUDE.md is a WARNING here, not a finding: loud, but it does not block
  // the gate while a trim follow-up is pending. The one thing it must never be
  // is INVISIBLE. If a repo configures no CLAUDE.md limit at all, absence of
  // config would silently disable the check (the repo-d v0.1.0 gap), so a
  // missing CLAUDE.md limit is itself a warning naming the house default.
  const HOUSE_CLAUDE_MD_TARGET = 100;
  if (existsSync(join(ctx.repoRoot, 'CLAUDE.md'))) {
    const claudeLimit = limits['CLAUDE.md'];
    const configuredLines = typeof claudeLimit === 'number' ? claudeLimit
      : (isPlainObject(claudeLimit) && typeof claudeLimit.lines === 'number' ? claudeLimit.lines : null);
    const claudeCount = countLinesExcludingFrontmatter(readFileSync(join(ctx.repoRoot, 'CLAUDE.md'), 'utf8'));
    if (configuredLines === null) {
      warnings.push(mk('lengths', 'CLAUDE.md', null, 'length', `${claudeCount} lines, no CLAUDE.md limit set in house.json (house target ${HOUSE_CLAUDE_MD_TARGET}). Set modules.docs.config.lengthLimits["CLAUDE.md"] so the budget is measured, not omitted.`));
    } else if (claudeCount > configuredLines) {
      warnings.push(mk('lengths', 'CLAUDE.md', null, 'length', `${claudeCount} lines over the ${configuredLines}-line limit. CLAUDE.md is not ratchet-eligible; split the excess into paths-scoped rule files (file a trim follow-up). Warns until it clears.`));
    }
  }

  // The auto-memory index is the other file that loads in full every session,
  // and the only one this checker reads from outside the repo (ADR 0008). It
  // is machine-local: untracked, absent from every CI checkout, and unfixable
  // by any PR, so it is a WARNING here and never a finding, and its absence is
  // silence rather than a complaint. There is deliberately no house.json slot
  // for the thresholds: the caps belong to the harness, not to a repo.
  const memIndex = memoryIndexPath(ctx.repoRoot);
  if (existsSync(memIndex)) {
    const memRaw = safeRead(memIndex);
    const memLines = memRaw.split('\n');
    if (memLines.length && memLines[memLines.length - 1] === '') memLines.pop();
    const memBytes = Buffer.byteLength(memRaw, 'utf8');
    const longLines = memLines.filter((l) => l.length > MEMORY_INDEX_MAX_LINE_CHARS);
    const over = [];
    if (memLines.length > MEMORY_INDEX_WARN_LINES) over.push(`${memLines.length} lines (warn over ${MEMORY_INDEX_WARN_LINES}, harness cap ${MEMORY_INDEX_CAP_LINES})`);
    if (memBytes > MEMORY_INDEX_WARN_BYTES) over.push(`${memBytes} bytes (warn over ${MEMORY_INDEX_WARN_BYTES}, harness cap ${MEMORY_INDEX_CAP_BYTES})`);
    if (longLines.length) {
      const sample = longLines.slice(0, 3).map((l) => `"${l.slice(0, 60)}"`).join(', ');
      over.push(`${longLines.length} line(s) over ${MEMORY_INDEX_MAX_LINE_CHARS} chars, first: ${sample}`);
    }
    if (over.length) {
      warnings.push(mk('lengths', memIndex, null, 'memory-index', `${over.join('; ')}. The harness loads the first ${MEMORY_INDEX_CAP_LINES} lines or ${MEMORY_INDEX_CAP_BYTES} bytes, whichever comes first, and drops the rest silently. Move each entry's detail into its topic file first, then shorten the index line to the cue that says when to open it.`));
    }
  }

  // P7: README.md and the vendored house rule files are also load-bearing, and
  // like CLAUDE.md their length budget must not be silently omitted. If the
  // repo has such a file but no limit configured for it, warn (do not skip).
  const hasLimitFor = (f) => Object.keys(limits).some((pat) => (/[*?]/.test(pat) ? globToRegExp(pat).test(f) : pat === f));
  if (existsSync(join(ctx.repoRoot, 'README.md')) && !hasLimitFor('README.md')) {
    warnings.push(mk('lengths', 'README.md', null, 'length', 'no README.md limit set in house.json (house target 110). Set modules.docs.config.lengthLimits["README.md"] so the budget is measured.'));
  }
  const vendoredRules = ctx.allTracked.filter((f) => /^\.claude\/rules\/house\/.*\.md$/.test(f));
  if (vendoredRules.length && !vendoredRules.every((f) => hasLimitFor(f))) {
    warnings.push(mk('lengths', 'house.json', null, 'length', 'no length limit covers .claude/rules/house/*.md (house target 200). Set modules.docs.config.lengthLimits[".claude/rules/house/*.md"] so vendored-rule budgets are measured.'));
  }
  // #33: the moment a repo does what the CLAUDE.md warning above asks (split
  // the excess into paths-scoped rule files), those files are the largest
  // rule bodies in the repo, and without a limit they are the only
  // load-bearing surface with no measured budget. Same nudge as the vendored
  // set, one aggregate line, sampling three.
  const authoredRules = ctx.allTracked.filter((f) => /^\.claude\/rules\/.*\.md$/.test(f)
    && !f.startsWith('.claude/rules/house/') && !f.endsWith('/README.md'));
  const uncoveredRules = authoredRules.filter((f) => !hasLimitFor(f));
  if (uncoveredRules.length) {
    warnings.push(mk('lengths', 'house.json', null, 'length', `no length limit covers ${uncoveredRules.length} repo-authored rule file(s) (${uncoveredRules.slice(0, 3).join(', ')}${uncoveredRules.length > 3 ? ', ...' : ''}); a paths-scoped rule loads in full whenever its glob matches, so its budget must be measured too. Set modules.docs.config.lengthLimits[".claude/rules/**/*.md"] (house target 200), which covers the vendored set as well.`));
  }

  const perFile = new Map();
  for (const [pattern, val] of Object.entries(limits)) {
    if (pattern === 'CLAUDE.md') continue; // handled above as a warning, never a blocking finding
    const limitLines = typeof val === 'number' ? val : (isPlainObject(val) && typeof val.lines === 'number' ? val.lines : null);
    const limitBytes = isPlainObject(val) && typeof val.bytes === 'number' ? val.bytes : null;
    // P5: a bytes-only limit (`{bytes: N}`, no lines) must still be enforced.
    // Only skip when BOTH are absent.
    if (limitLines === null && limitBytes === null) continue;
    const matches = /[*?]/.test(pattern)
      ? ctx.allTracked.filter((f) => globToRegExp(pattern).test(f))
      : (ctx.allTracked.includes(pattern) ? [pattern] : []);
    for (const f of matches) perFile.set(f, { limitLines, limitBytes });
  }

  const tighten = [];
  for (const [file, { limitLines, limitBytes }] of perFile) {
    const abs = join(ctx.repoRoot, file);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, 'utf8');
    const count = countLinesExcludingFrontmatter(raw);
    const ceilingFromRatchet = Object.prototype.hasOwnProperty.call(ratchet, file) ? ratchet[file] : null;
    // limitLines may be null for a bytes-only limit (P5); only compute a line
    // ceiling and compare lines when a line limit was actually configured.
    const effectiveCeiling = limitLines === null ? null
      : (ceilingFromRatchet !== null ? Math.max(ceilingFromRatchet, limitLines) : limitLines);
    const linesOver = effectiveCeiling !== null && count > effectiveCeiling;

    let bytes = null;
    let bytesOver = false;
    if (limitBytes !== null) {
      bytes = Buffer.byteLength(raw, 'utf8');
      bytesOver = bytes > limitBytes;
    }

    if (linesOver || bytesOver) {
      const raise = ctx.acceptLengths
        ? ratchetRaises.find((r) => isPlainObject(r) && r.path === file && isNonEmptyString(r.why) && typeof r.to === 'number' && r.to >= count)
        : null;
      if (raise) {
        tighten.push({ path: file, to: raise.to });
      } else {
        const linesMsg = linesOver ? `${count} lines (limit ${effectiveCeiling})` : '';
        const bytesMsg = bytesOver ? `${linesMsg ? ', ' : ''}${bytes} bytes (limit ${limitBytes})` : '';
        findings.push(mk('lengths', file, null, 'length', `${linesMsg}${bytesMsg}`));
      }
    } else if (ceilingFromRatchet !== null && count < ceilingFromRatchet) {
      tighten.push({ path: file, to: count });
    }
  }

  ctx.pendingRatchetTighten.push(...tighten);
  return { findings, warnings };
}

function maybeWriteRatchet(ctx, totalFindings) {
  if (!ctx.familiesRun.has('lengths')) return;
  if (totalFindings > 0) return;
  if (ctx.houseUnusable) return;
  if (ctx.pendingRatchetTighten.length === 0) return;
  const data = ctx.house.data;
  data.ratchet = isPlainObject(data.ratchet) ? data.ratchet : {};
  let changed = false;
  for (const { path, to } of ctx.pendingRatchetTighten) {
    if (data.ratchet[path] !== to) { data.ratchet[path] = to; changed = true; }
  }
  if (!changed) return;
  writeFileSync(ctx.house.path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ── coload ───────────────────────────────────────────────────────────────

// The docs module's maxCoLoadLines default; also the bar above which a
// configured ceiling must carry a `coload-ceiling` deviation (manifest family).
const DEFAULT_MAX_COLOAD_LINES = 400;

function checkCoload(ctx) {
  const findings = [];
  const cfg = moduleConfig(ctx.house, 'docs');
  const maxLines = Number.isFinite(cfg.maxCoLoadLines) ? cfg.maxCoLoadLines : DEFAULT_MAX_COLOAD_LINES;

  // P12: the co-load budget is "how many lines of rule prose load when a file
  // is opened". That is BOTH the vendored house rules (.claude/rules/house/**)
  // AND the repo's own authored rules (.claude/rules/*.md and any nested
  // non-house rule). Counting only the vendored set understates the true load
  // (repo-c's finance.md + services.md, 165 lines, never entered any sum), so a
  // passing budget could still be a genuine overload. A rule with no `paths:`
  // frontmatter is ALWAYS-ON: it loads for EVERY file, so it counts toward every
  // tracked path's total, not zero (globs=[] used to match nothing).
  const ruleFiles = ctx.allTracked.filter((f) => /^\.claude\/rules\/.*\.md$/.test(f));
  const rules = ruleFiles.map((f) => {
    const raw = safeRead(join(ctx.repoRoot, f));
    const { globs } = parseRuleFrontmatterPaths(raw);
    return { file: f, globs, lines: countLinesExcludingFrontmatter(raw), alwaysOn: globs.length === 0 };
  });

  // Every tracked path grouped by the exact set of rules that load on it; the
  // sum and the rule list are a function of that set, so they are stored once.
  const groups = new Map(); // rule-set key -> { sum, rules, paths }
  for (const path of ctx.allTracked) {
    const matched = rules.filter((r) => r.alwaysOn || r.globs.some((g) => globToRegExp(g).test(path)));
    if (matched.length === 0) continue;
    const key = matched.map((r) => r.file).sort().join('\n');
    let g = groups.get(key);
    if (!g) {
      g = { sum: matched.reduce((s, r) => s + r.lines, 0), rules: matched.map((r) => ({ file: r.file, lines: r.lines })), paths: [] };
      groups.set(key, g);
    }
    g.paths.push(path);
  }
  let worst = null;
  for (const g of groups.values()) {
    g.paths.sort();
    if (!worst || g.sum > worst.sum) worst = { path: g.paths[0], sum: g.sum, rules: g.rules };
  }

  // #19: one finding per DISTINCT over-budget rule set, not just the single
  // worst path. Reporting only the worst meant lowering a ceiling was a
  // loop of fix-one-discover-the-next; reporting every path would repeat one
  // collision once per file. The example path is the first in sort order,
  // the count says how many share it. `worst` (and --json coloadWorst) keeps
  // its shape for callers that already read it.
  for (const g of [...groups.values()].filter((g) => g.sum > maxLines).sort((a, b) => b.sum - a.sum)) {
    findings.push(mk('coload', g.paths[0], null, 'coload', `co-load ${g.sum} lines > ${maxLines} on ${g.paths.length} path(s), e.g. ${g.paths[0]}, from: ${g.rules.map((r) => `${r.file} (${r.lines})`).join(', ')}. Narrow the colliding module's path slot in house.json, tighten this repo's own rule paths, or trim; raise maxCoLoadLines only with a deviations entry (kind "coload-ceiling", \`ceiling\` set to the new value)`));
  }
  return { findings, warnings: [], worst };
}

// ── manifest ─────────────────────────────────────────────────────────────

const MANIFEST_TOP_KEYS = new Set(['version', 'defaultBranch', 'branchPolicy', 'protectedBranches', 'carveOuts', 'guard', 'modules', 'deviations', 'ratchet', 'ratchetRaises']);
const DEVIATION_KINDS = new Set(['disabled-module', 'branch-policy', 'carve-out', 'unmanaged-file', 'coload-ceiling', 'other']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readModuleDefaultsFrom(modulesDir) {
  const out = {};
  let entries;
  try { entries = readdirSync(modulesDir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const mp = join(modulesDir, ent.name, 'module.json');
    if (!existsSync(mp)) continue;
    try {
      const j = JSON.parse(readFileSync(mp, 'utf8'));
      // Keyed the way house.json, readModuleRuleCountsFrom, and the CLI key a
      // module: its module.json `name`, falling back to the directory. Keying
      // by directory alone let a module whose name differs from its directory
      // dodge the disabled-module deviation check.
      out[(typeof j.name === 'string' && j.name) || ent.name] = (j.default ?? 'on') === 'on';
    } catch { /* malformed module.json: skip this one module */ }
  }
  return out;
}

// {moduleName -> number of rule files it declares}, keyed by the module.json
// `name` (falling back to the directory), from the same source dir the
// defaults come from. Used to tell "this enabled module SHOULD have vendored
// a rule" from "this module legitimately ships no rule".
function readModuleRuleCountsFrom(modulesDir) {
  const out = {};
  let entries;
  try { entries = readdirSync(modulesDir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const mp = join(modulesDir, ent.name, 'module.json');
    if (!existsSync(mp)) continue;
    try {
      const j = JSON.parse(readFileSync(mp, 'utf8'));
      const name = (typeof j.name === 'string' && j.name) || ent.name;
      out[name] = Array.isArray(j.rules) ? j.rules.length : 0;
    } catch { /* malformed module.json: skip this one module */ }
  }
  return out;
}
function resolveModuleRuleCounts(ctx) {
  const record = resolveHousePluginRecord(readInstalledPlugins());
  if (record && record.installPath && existsSync(join(record.installPath, 'modules'))) {
    return readModuleRuleCountsFrom(join(record.installPath, 'modules'));
  }
  const local = join(ctx.repoRoot, 'plugins', 'house', 'modules');
  if (existsSync(local)) return readModuleRuleCountsFrom(local);
  return null;
}
// Read module defaults from the installed plugin when reachable, else from
// this repo's own plugins/house/modules/*/module.json (running inside the
// package repo itself), else null so the caller skips the sub-check.
function resolveModuleDefaults(ctx) {
  const record = resolveHousePluginRecord(readInstalledPlugins());
  if (record && record.installPath && existsSync(join(record.installPath, 'modules'))) {
    return readModuleDefaultsFrom(join(record.installPath, 'modules'));
  }
  const local = join(ctx.repoRoot, 'plugins', 'house', 'modules');
  if (existsSync(local)) return readModuleDefaultsFrom(local);
  return null;
}

function checkManifest(ctx) {
  const findings = [];
  const warnings = [];
  const d = ctx.house.data;
  if (!isPlainObject(d)) {
    findings.push(mk('manifest', 'house.json', null, 'manifest', 'house.json must be a JSON object'));
    return { findings, warnings };
  }

  for (const key of Object.keys(d)) {
    if (!MANIFEST_TOP_KEYS.has(key)) findings.push(mk('manifest', 'house.json', null, 'manifest', `unknown top-level key \`${key}\` (not in the schema)`));
  }
  for (const req of ['version', 'defaultBranch', 'branchPolicy', 'modules']) {
    if (!(req in d)) findings.push(mk('manifest', 'house.json', null, 'manifest', `missing required key \`${req}\``));
  }
  if ('version' in d && !SEMVER_RE.test(d.version)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`version` must match x.y.z'));
  if ('defaultBranch' in d && !isNonEmptyString(d.defaultBranch)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`defaultBranch` must be a non-empty string'));
  if ('branchPolicy' in d && !['pr', 'direct'].includes(d.branchPolicy)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`branchPolicy` must be "pr" or "direct"'));
  if ('protectedBranches' in d && !isArrayOfNonEmptyStrings(d.protectedBranches)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`protectedBranches` must be an array of non-empty strings'));
  if ('carveOuts' in d && !isArrayOfNonEmptyStrings(d.carveOuts)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`carveOuts` must be an array of non-empty strings'));

  if ('modules' in d) {
    if (!isPlainObject(d.modules)) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', '`modules` must be an object'));
    } else {
      for (const [name, entry] of Object.entries(d.modules)) {
        if (!isPlainObject(entry)) { findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\` must be an object`)); continue; }
        if (!('enabled' in entry)) findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\` missing required \`enabled\``));
        else if (typeof entry.enabled !== 'boolean') findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\`.enabled must be boolean`));
        for (const k of Object.keys(entry)) {
          if (k !== 'enabled' && k !== 'config') findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\` has unknown key \`${k}\``));
        }
        if ('config' in entry && !isPlainObject(entry.config)) findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\`.config must be an object`));
      }
    }
  }

  const deviations = Array.isArray(d.deviations) ? d.deviations : [];
  if ('deviations' in d && !Array.isArray(d.deviations)) {
    findings.push(mk('manifest', 'house.json', null, 'manifest', '`deviations` must be an array'));
  } else {
    deviations.forEach((dev, i) => {
      if (!isPlainObject(dev)) { findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}] must be an object`)); return; }
      for (const req of ['kind', 'what', 'why', 'decided']) {
        if (!(req in dev)) findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}] missing \`${req}\``));
      }
      if ('kind' in dev && !DEVIATION_KINDS.has(dev.kind)) findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}].kind \`${dev.kind}\` is not a valid kind`));
      if ('what' in dev && !isNonEmptyString(dev.what)) findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}].what must be a non-empty string`));
      if ('why' in dev && !isNonEmptyString(dev.why)) findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}].why must be a non-empty string`));
      if ('decided' in dev && !DATE_RE.test(dev.decided)) findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}].decided must be YYYY-MM-DD`));
      if (dev.kind === 'coload-ceiling' && !(Number.isInteger(dev.ceiling) && dev.ceiling > 0)) findings.push(mk('manifest', 'house.json', null, 'manifest', `deviations[${i}] (coload-ceiling) must carry an integer \`ceiling\` equal to modules.docs.config.maxCoLoadLines; prose in \`what\` is not parsed`));
    });
  }

  if ('ratchet' in d) {
    if (!isPlainObject(d.ratchet)) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', '`ratchet` must be an object'));
    } else {
      for (const [k, v] of Object.entries(d.ratchet)) {
        if (!(Number.isInteger(v) && v >= 1)) findings.push(mk('manifest', 'house.json', null, 'manifest', `ratchet[\`${k}\`] must be a positive integer`));
      }
    }
  }

  if ('ratchetRaises' in d) {
    if (!Array.isArray(d.ratchetRaises)) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', '`ratchetRaises` must be an array'));
    } else {
      d.ratchetRaises.forEach((r, i) => {
        if (!isPlainObject(r)) { findings.push(mk('manifest', 'house.json', null, 'manifest', `ratchetRaises[${i}] must be an object`)); return; }
        for (const req of ['path', 'from', 'to', 'why', 'decided']) {
          if (!(req in r)) findings.push(mk('manifest', 'house.json', null, 'manifest', `ratchetRaises[${i}] missing \`${req}\``));
        }
        if ('why' in r && !isNonEmptyString(r.why)) findings.push(mk('manifest', 'house.json', null, 'manifest', `ratchetRaises[${i}].why must be non-empty`));
        if ('decided' in r && !DATE_RE.test(r.decided)) findings.push(mk('manifest', 'house.json', null, 'manifest', `ratchetRaises[${i}].decided must be YYYY-MM-DD`));
      });
    }
  }

  // ADR 0009: a plugin-guarded repo records the choice instead of re-vendoring
  // the hook the plugin exists to retire. Validated whenever the key is
  // present, whatever branchPolicy says. Only a fully well-formed record
  // clears the guard family's warning (see pluginGuardRecord), so each defect
  // here is a finding rather than a silent drop.
  if ('guard' in d) {
    const g = d.guard;
    if (!isPlainObject(g)) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', '`guard` must be an object like {"by": "plugin", "decided": "YYYY-MM-DD", "why": "..."}'));
    } else {
      if (g.by !== 'plugin') findings.push(mk('manifest', 'house.json', null, 'manifest', '`guard.by` must be "plugin"'));
      if (typeof g.decided !== 'string' || !DATE_RE.test(g.decided)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`guard.decided` must be YYYY-MM-DD'));
      if (!isNonEmptyString(g.why)) findings.push(mk('manifest', 'house.json', null, 'manifest', '`guard.why` must be a non-empty string'));
      for (const k of Object.keys(g)) {
        if (!['by', 'decided', 'why'].includes(k)) findings.push(mk('manifest', 'house.json', null, 'manifest', `\`guard\` has unknown key \`${k}\``));
      }
    }
  }

  // ADR 0009 object forms in modules.docs.config: validated here so a
  // malformed entry reports loudly while the drift family drops it and keeps
  // scanning (a broken entry must not turn off a scan).
  const docsCfg = moduleConfig(ctx.house, 'docs');
  arr(docsCfg.bareScriptAllowlist).forEach((e, i) => {
    if (isNonEmptyString(e)) return;
    if (isPlainObject(e) && isNonEmptyString(e.token) && isNonEmptyString(e.why)
        && Object.keys(e).every((k) => ['token', 'kind', 'why'].includes(k))) return;
    findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.bareScriptAllowlist[${i}] must be a non-empty string or {"token", "why"} (optional "kind") with non-empty values and no other keys`));
  });
  for (const slot of ['excludeFiles', 'archiveDirs']) {
    arr(docsCfg[slot]).forEach((e, i) => {
      if (isNonEmptyString(e)) return;
      if (isPlainObject(e) && isNonEmptyString(e.path) && isNonEmptyString(e.why)
          && Object.keys(e).every((k) => ['path', 'why'].includes(k))) return;
      findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.${slot}[${i}] must be a non-empty string or {"path", "why"} with non-empty values and no other keys`));
    });
  }
  arr(docsCfg.packageRoots).forEach((e, i) => {
    const dir = isNonEmptyString(e) ? e.trim()
      : (isPlainObject(e) && isNonEmptyString(e.dir) && Object.keys(e).every((k) => k === 'dir') ? e.dir.trim() : null);
    if (dir === null) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.packageRoots[${i}] must be a non-empty string or {"dir": "..."}`));
      return;
    }
    const clean = dir.replace(/\/+$/, '');
    if (!isInsideRoot(ctx.repoRoot, clean)) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.packageRoots[${i}] \`${dir}\` escapes the repo root`));
    } else if (!ctx.allTracked.some((f) => f.startsWith(`${clean}/`))) {
      // A warning, not a finding: unlike `roots` (a coverage assertion), a
      // package root is a resolution hint, and a stale one only fails to help.
      warnings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.packageRoots[${i}] \`${dir}\` matches no tracked files; drop the entry or fix the path`));
    }
  });

  // The em-dash slot. Each defect is its own finding naming the fallback the
  // shape family will use, the way maxCoLoadLines does, because a slot that
  // quietly reverts to the default set is a scan the operator thinks they
  // configured and did not.
  if (docsCfg.emDash !== undefined) {
    const em = docsCfg.emDash;
    if (!isPlainObject(em)) {
      findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.emDash must be an object like {"mode": "public", "paths": [...], "exclude": [...]} (got ${JSON.stringify(em)}); the shape family uses the default ${JSON.stringify(EM_DASH_DEFAULT)} until it is`));
    } else {
      if (em.mode !== undefined && !EM_DASH_MODES.has(em.mode)) {
        findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.emDash.mode must be "public", "all", or "off" (got ${JSON.stringify(em.mode)}); the shape family uses "${EM_DASH_DEFAULT.mode}" until it is`));
      }
      for (const slot of ['paths', 'exclude']) {
        if (em[slot] === undefined) continue;
        const ok = Array.isArray(em[slot]) && em[slot].every((e) => isNonEmptyString(e)
          || (isPlainObject(e) && isNonEmptyString(e.path) && isNonEmptyString(e.why)
              && Object.keys(e).every((k) => ['path', 'why'].includes(k))));
        if (!ok) {
          findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.emDash.${slot} must be an array of non-empty glob strings or {"path", "why"} objects with non-empty values and no other keys; the shape family uses the default ${JSON.stringify(EM_DASH_DEFAULT[slot])} until it is`));
        }
      }
      for (const k of Object.keys(em)) {
        if (!['mode', 'paths', 'exclude'].includes(k)) findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.emDash has unknown key \`${k}\` (expected "mode", "paths", "exclude")`));
      }
    }
  }

  if (d.branchPolicy === 'direct' && !deviations.some((x) => isPlainObject(x) && x.kind === 'branch-policy')) {
    findings.push(mk('manifest', 'house.json', null, 'manifest', 'branchPolicy "direct" requires a deviations entry with kind "branch-policy"'));
  }
  for (const co of arr(d.carveOuts)) {
    const covered = deviations.some((x) => isPlainObject(x) && x.kind === 'carve-out' && typeof x.what === 'string' && x.what.includes(co));
    if (!covered) findings.push(mk('manifest', 'house.json', null, 'manifest', `carveOut \`${co}\` requires a deviations entry (kind "carve-out", \`what\` mentioning it)`));
  }
  // #19: raising the co-load ceiling loosens a gate the way a carve-out does,
  // and it is verifiable from house.json alone (the default is this checker's
  // own constant), so an unrecorded raise is a finding, not a warning. The
  // entry carries the CURRENT value as an integer `ceiling`, compared exactly
  // (never grepped out of prose), so a later silent bump invalidates the old
  // entry the way ratchetRaises.to pins a limit. A ceiling that is not a
  // positive integer is its own finding: the coload family would silently
  // fall back to the default and the operator would never learn why.
  const coloadMax = moduleConfig(ctx.house, 'docs').maxCoLoadLines;
  if (coloadMax !== undefined && !(Number.isInteger(coloadMax) && coloadMax > 0)) {
    findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.maxCoLoadLines must be a positive integer (got ${JSON.stringify(coloadMax)}); the coload family enforces the default ${DEFAULT_MAX_COLOAD_LINES} until it is`));
  } else if (Number.isInteger(coloadMax) && coloadMax > DEFAULT_MAX_COLOAD_LINES) {
    const covered = deviations.some((x) => isPlainObject(x) && x.kind === 'coload-ceiling' && x.ceiling === coloadMax);
    if (!covered) findings.push(mk('manifest', 'house.json', null, 'manifest', `modules.docs.config.maxCoLoadLines is ${coloadMax}, above the default ${DEFAULT_MAX_COLOAD_LINES}, with no deviations entry (kind "coload-ceiling", \`ceiling\` ${coloadMax}); narrow the colliding module's path slot, tighten this repo's own rule paths, or trim first, and record the raise if it must stay`));
  }
  const defaults = resolveModuleDefaults(ctx);
  if (defaults && isPlainObject(d.modules)) {
    for (const [name, entry] of Object.entries(d.modules)) {
      if (isPlainObject(entry) && entry.enabled === false && defaults[name] === true) {
        const covered = deviations.some((x) => isPlainObject(x) && x.kind === 'disabled-module' && x.module === name);
        if (!covered) findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\` is default-on but disabled with no deviations entry (kind "disabled-module", module "${name}")`));
      }
    }
  } else if (!defaults && isPlainObject(d.modules)) {
    // P8: the disabled-module deviation check reads module defaults from the
    // installed plugin OR the local package tree; when NEITHER is reachable it
    // used to pass silently, so a default-on module disabled without a
    // deviation slipped through. It cannot be verified from the repo alone, but
    // silence is the wrong answer -- warn whenever a module IS disabled and the
    // defaults could not be resolved, so the un-run check is visible.
    const disabled = Object.entries(d.modules).filter(([, e]) => isPlainObject(e) && e.enabled === false).map(([n]) => n);
    if (disabled.length) {
      warnings.push(mk('manifest', 'house.json', null, 'manifest', `disabled-module check could not resolve module defaults (no installed house plugin and no local plugins/house/modules tree is reachable this run), so ${disabled.length === 1 ? `disabled module \`${disabled[0]}\`` : `disabled modules ${disabled.map((n) => `\`${n}\``).join(', ')}`} cannot be verified against its default. Install the house plugin (or run from the package tree) to restore this check.`));
    }
  }

  // F4: an enabled module that declares a rule but vendored zero rules loads
  // nowhere, which is indistinguishable from a rule that does nothing. Once
  // the repo has a lock (render has run), require every enabled rule-bearing
  // module to have at least one lock entry. Before the first render (no lock)
  // this is silent, since there is nothing to have vendored yet.
  const lockEntries = readLockEntries(ctx.repoRoot);
  const ruleCounts = resolveModuleRuleCounts(ctx);
  if (lockEntries && ruleCounts && isPlainObject(d.modules)) {
    const lockModules = new Set();
    for (const e of lockEntries) if (isPlainObject(e) && typeof e.module === 'string') lockModules.add(e.module);
    for (const [name, entry] of Object.entries(d.modules)) {
      if (!isPlainObject(entry) || entry.enabled !== true) continue;
      if (!(ruleCounts[name] > 0)) continue; // module ships no rule: nothing to vendor
      if (!lockModules.has(name)) {
        findings.push(mk('manifest', 'house.json', null, 'manifest', `module \`${name}\` is enabled but vendored zero rules (its defaultPaths expanded to nothing in this repo); give the module a non-empty path set, disable it with a deviation, or fill its config globs, then re-render`));
      }
    }
  }

  // #18: what render wrote versus what git tracks. Every other family walks
  // `git ls-files`, so a managed file git cannot see is checked by nobody and
  // the run prints a zero it did not earn (repo-e's first run, with
  // `.claude/` blanket-ignored, reported 0 findings for rules it never read).
  // Ignored is a finding: a config choice that blinds the gate. Merely
  // unstaged is a warning: the operator has not run `git add` yet.
  if (lockEntries) {
    const trackedSet = new Set(ctx.allTracked);
    const candidates = lockEntries.filter((e) => isPlainObject(e) && isInsideRoot(ctx.repoRoot, e.path)
      && !trackedSet.has(e.path) && existsSync(join(ctx.repoRoot, e.path)));
    if (candidates.length) {
      const ignored = gitIgnoredMap(ctx.repoRoot, candidates.map((e) => e.path));
      if (!ignored) {
        // NOT EVALUABLE, said once: without a working git (a plain copy of
        // the tree, no .git) tracked, unstaged, and ignored cannot be told
        // apart, and one verdict per file would be a fabricated one.
        warnings.push(mk('manifest', '.house/lock.json', null, 'unverifiable', `git could not evaluate ${candidates.length} managed file(s) that are on disk but absent from git ls-files (is ${ctx.repoRoot} a git repository?); tracked, unstaged, and ignored cannot be told apart here`));
      } else {
        for (const e of candidates) {
          const why = ignored.get(e.path);
          if (why) {
            findings.push(mk('manifest', e.path, null, 'gitignored', `managed file from module \`${e.module}\` is git-ignored (${why}), so the drift, shape, lengths, and coload families never see it here and CI sees it as missing; narrow the ignore rule (ignore .claude/settings.local.json, not .claude/ or .house/) and git add it`));
          } else {
            warnings.push(mk('manifest', e.path, null, 'untracked', 'managed file is on disk but not staged; git add it by path so the checker and CI see it'));
          }
        }
      }
    }
  }

  return { findings, warnings };
}

// ── minutes ──────────────────────────────────────────────────────────────

function extractCronLines(raw) {
  const out = [];
  const re = /-\s*cron:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(raw))) out.push(m[1]);
  return out;
}

// Naive estimator: not a real cron parser, just enough to catch an
// obviously-too-hot schedule. "naive regex ok" per spec.
function estimateRunsPerMonth(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 0;
  const [min, hour, dom, , dow] = parts;
  const countField = (f, max) => {
    if (f === '*') return max;
    if (f.includes('/')) {
      const step = parseInt(f.split('/')[1], 10) || 1;
      return Math.max(1, Math.floor(max / step));
    }
    return f.split(',').length;
  };
  const minuteCount = countField(min, 60);
  const hourCount = countField(hour, 24);
  let daysPerMonth = 30;
  if (dow !== '*') daysPerMonth = 30 * (countField(dow, 7) / 7);
  else if (dom !== '*') daysPerMonth = countField(dom, 31);
  return Math.round(minuteCount * hourCount * daysPerMonth);
}

function checkMinutes(ctx) {
  const warnings = [];
  const cfg = moduleConfig(ctx.house, 'github');
  const budget = Number.isFinite(cfg.actionsBudgetMinutes) ? cfg.actionsBudgetMinutes : 2000;
  const workflowFiles = ctx.allTracked.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f));

  let total = 0;
  const contributions = [];
  for (const f of workflowFiles) {
    const raw = safeRead(join(ctx.repoRoot, f));
    let fileTotal = 0;
    for (const cron of extractCronLines(raw)) fileTotal += estimateRunsPerMonth(cron);
    if (fileTotal > 0) { total += fileTotal; contributions.push({ file: f, minutes: fileTotal }); }
  }

  if (total > budget) {
    warnings.push(mk('minutes', '.github/workflows', null, 'minutes', `scheduled workflows estimate ~${total} min/month > budget ${budget}: ${contributions.map((c) => `${c.file} (~${c.minutes})`).join(', ')}`));
  }
  return { findings: [], warnings };
}

// ── guard ────────────────────────────────────────────────────────────────

// branchPolicy "pr" is only a promise if something actually stops a commit on
// a protected branch. Three things can be that guard: a repo-local
// no-direct-master.sh, a repo-local settings.json PreToolUse hook, or the
// installed house plugin's own PreToolUse hook. When branchPolicy is "pr" and
// NONE of the first two is present, the repo is relying on the plugin being
// installed and enabled in every session, which the repo alone cannot verify;
// that is a warning, not a hard finding, because a correctly-installed plugin
// really does guard it. "Reachable guard" means exactly what the hook's own
// deferral means (plugins/house/hooks/no-direct-master.sh): a NON-EMPTY
// PreToolUse array in .claude/settings.json. A hooks key alone or a
// PostToolUse logging hook is not a branch guard, and settings.local.json is
// per-machine and gitignored, so the hook never reads it and neither does
// this; a guard that does not travel with the repo is not the repo's guard.
function settingsHasPreToolUseHook(repoRoot) {
  const p = join(repoRoot, '.claude', 'settings.json');
  if (!existsSync(p)) return false;
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { return false; }
  return isPlainObject(j) && isPlainObject(j.hooks) && Array.isArray(j.hooks.PreToolUse) && j.hooks.PreToolUse.length > 0;
}

// ADR 0009: the recorded plugin-guard choice, house.json's top-level `guard`
// key. Only a WELL-FORMED record counts anywhere (a malformed one is a
// manifest finding and must not clear the guard warning), so the guard and
// manifest families share this one predicate and cannot disagree. The record
// is accepted by this CHECKER only; the plugin hook deliberately never reads
// it as a stand-down signal (a record that could disarm the hook would be the
// empty-file deferral hole all over again, one level up).
function pluginGuardRecord(d) {
  const g = isPlainObject(d) ? d.guard : null;
  if (!isPlainObject(g)) return null;
  if (g.by !== 'plugin' || !isNonEmptyString(g.why) || typeof g.decided !== 'string' || !DATE_RE.test(g.decided)) return null;
  // An unknown key is malformed here too, or a record the manifest family
  // rejects would still buy guard-family silence and the two would disagree.
  if (!Object.keys(g).every((k) => ['by', 'decided', 'why'].includes(k))) return null;
  return g;
}

// #27: the hook defers to a repo-local guard file, and this certified one by
// bare existsSync -- so an empty or `exit 0` stub disarmed the plugin hook AND
// was reported here as protection. The two must agree, so this mirrors the
// hook's `local_hook_is_substantive`: a line that is not blank, not a comment
// or shebang, and not a bare `exit 0`. Unreadable counts as NOT substantive,
// which warns rather than certifies.
function localGuardHookIsSubstantive(repoRoot) {
  const p = join(repoRoot, '.claude', 'hooks', 'no-direct-master.sh');
  if (!existsSync(p)) return false;
  let body;
  try { body = readFileSync(p, 'utf8'); } catch { return false; }
  return body.split('\n').some((raw) => {
    const line = raw.trim();
    if (!line) return false;
    if (line.startsWith('#')) return false;
    if (line === 'exit') return false;
    return !/^exit\s+0$/.test(line);
  });
}

function checkGuard(ctx) {
  const warnings = [];
  const d = ctx.house.data;
  if (!isPlainObject(d) || d.branchPolicy !== 'pr') return { findings: [], warnings };
  const hookPath = join(ctx.repoRoot, '.claude', 'hooks', 'no-direct-master.sh');
  const repoHook = localGuardHookIsSubstantive(ctx.repoRoot);
  const stubHook = !repoHook && existsSync(hookPath);
  const settingsPreHook = settingsHasPreToolUseHook(ctx.repoRoot);
  if (stubHook && !settingsPreHook && !pluginGuardRecord(d)) {
    warnings.push(mk('guard', '.claude/hooks/no-direct-master.sh', null, 'guard',
      'branchPolicy is "pr" and this repo-local guard file exists but does nothing: every line is blank, a comment, or a bare `exit 0`. It is not a guard, and until this was fixed it also disarmed the plugin\'s hook by its mere presence, so the repo reported protection while enforcing none. Either give the file a real guard body, or delete it so the plugin\'s hook applies.'));
    return { findings: [], warnings };
  }
  if (!repoHook && !settingsPreHook && !pluginGuardRecord(d)) {
    warnings.push(mk('guard', 'house.json', null, 'guard',
      'branchPolicy is "pr" but no reachable branch guard was found in the repo: no `.claude/hooks/no-direct-master.sh`, no PreToolUse hook in `.claude/settings.json`, and no recorded plugin-guard choice. Wire a PreToolUse hook, vendor the hook file, or record the plugin as this repo\'s guard with a dated why: `"guard": {"by": "plugin", "decided": "YYYY-MM-DD", "why": "..."}` in house.json (`house doctor` shows whether the choice is recorded).'));
  }
  return { findings: [], warnings };
}

// ── CLI / orchestration ──────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { only: null, json: false, acceptLengths: false, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--accept-lengths') out.acceptLengths = true;
    else if (a === '--repo') out.repo = argv[++i];
    else if (a.startsWith('--repo=')) out.repo = a.slice('--repo='.length);
    else if (a === '--only') out.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

function formatLine(f) {
  const loc = f.line ? `${f.path}:${f.line}` : f.path;
  return `${loc} [${f.kind}] ${f.message}`;
}

function report({ families, results, findings, warnings, scannedDocs, coloadWorst, json }) {
  if (json) {
    console.log(JSON.stringify({ findings, warnings, scannedDocs, coloadWorst }, null, 2));
    return;
  }
  for (const fam of families) {
    const r = results[fam];
    if (!r) continue;
    if (r.skipped) { console.log(`== ${fam} == (skipped: house.json unusable)`); continue; }
    if (r.findings.length === 0 && r.warnings.length === 0) continue;
    console.log(`== ${fam} ==`);
    for (const f of r.findings) console.log(formatLine(f));
    for (const w of r.warnings) console.log(`${formatLine(w)}  (warning)`);
  }
  const famSummaries = families
    .map((f) => {
      const r = results[f] || { findings: [], warnings: [] };
      const bits = [];
      if (r.findings.length) bits.push(`${r.findings.length} finding(s)`);
      if (r.warnings.length) bits.push(`${r.warnings.length} warning(s)`);
      return bits.length ? `${f}: ${bits.join(', ')}` : null;
    })
    .filter(Boolean);
  console.log('');
  console.log(`Summary: ${findings.length} finding(s), ${warnings.length} warning(s)${famSummaries.length ? ` -- ${famSummaries.join('; ')}` : ''}`);
  if (findings.length) {
    // A refusal that does not name its remedies gets worked around instead of
    // fixed. Every family's finding resolves one of these three ways.
    console.log('');
    console.log('Fix a finding one of three ways:');
    console.log('  1. change the document, so it describes what the code actually does');
    console.log('  2. change the code, so the document was right all along');
    console.log('  3. record the exception with its reason: a `docs-drift-ignore` marker for a token,');
    console.log('     a house.json `deviations` entry for a policy, a `ratchetRaises` entry for a limit');
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let families = ALL_FAMILIES.slice();
  if (args.only) {
    const unknown = args.only.filter((f) => !ALL_FAMILIES.includes(f));
    if (unknown.length) process.stderr.write(`house check: ignoring unknown --only name(s): ${unknown.join(', ')}\n`);
    families = args.only.filter((f) => ALL_FAMILIES.includes(f));
  }

  let repoRoot;
  if (args.repo) {
    repoRoot = resolve(process.cwd(), args.repo);
  } else {
    try {
      repoRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
    } catch (e) {
      process.stderr.write(`house check: not a git repository and no --repo given (${e.message})\n`);
      process.exit(2);
    }
  }

  const house = loadHouseJson(repoRoot);
  const houseUnusable = !house.present || house.data === null;
  const needsHouse = families.some((f) => NEEDS_HOUSE_JSON.has(f));

  const allTracked = gitLsFilesZ(repoRoot);

  const ctx = {
    repoRoot, house, houseUnusable, allTracked, json: args.json,
    acceptLengths: args.acceptLengths, familiesRun: new Set(families),
    pendingRatchetTighten: [],
  };

  const results = {};
  const allFindings = [];
  const allWarnings = [];
  let scannedDocs = [];
  let coloadWorst = null;

  for (const fam of families) {
    if (NEEDS_HOUSE_JSON.has(fam) && houseUnusable) {
      results[fam] = { findings: [], warnings: [], skipped: true };
      continue;
    }
    let r;
    switch (fam) {
      case 'drift': r = checkDrift(ctx); scannedDocs = r.scanned || []; break;
      case 'todo': r = checkTodo(ctx); break;
      case 'tamper': r = checkTamper(ctx); break;
      case 'behind': r = checkBehind(ctx); break;
      case 'shape': r = checkShape(ctx); break;
      case 'lengths': r = checkLengths(ctx); break;
      case 'coload': r = checkCoload(ctx); coloadWorst = r.worst || null; break;
      case 'manifest': r = checkManifest(ctx); break;
      case 'minutes': r = checkMinutes(ctx); break;
      case 'guard': r = checkGuard(ctx); break;
      default: r = { findings: [], warnings: [] };
    }
    results[fam] = r;
    allFindings.push(...r.findings);
    allWarnings.push(...r.warnings);
  }

  maybeWriteRatchet(ctx, allFindings.length);

  report({ families, results, findings: allFindings, warnings: allWarnings, scannedDocs, coloadWorst, json: args.json });

  let exitCode = 0;
  if (houseUnusable && needsHouse) exitCode = 2;
  else if (allFindings.length > 0) exitCode = 1;
  process.exit(exitCode);
}

main();
