// #462, #465: the doctor skill explains every line `house doctor` prints.
//
// Two checks hold the output to plugins/house/skills/doctor/SKILL.md.
//
// 1. Fixtures (#465). The real CLI runs `doctor` over throwaway repos that drive
//    each branch of the output, and every line it prints, stdout and stderr
//    both, must match an entry in CATALOGUE below. An entry names the SKILL.md
//    bullet it is documented under, and the bullet must carry that text inside a
//    code span of its heading or its nested bullets: a word that only appears in
//    a bullet's prose, or in a paragraph, never documents a line. Each entry
//    matches the whole line, so a new line that shares its first words with an
//    existing one, or a new state of an existing line, matches nothing.
// 2. A static read of the output sites in cmdDoctor and gitHookFloorLines. It
//    covers both branches of a ternary and every writer (console.log, .error,
//    process.stdout.write...). Each site's literal lead must be the start of a
//    line a fixture printed, which is how a branch no fixture drives is found.
//    The only sites that are static alone are listed in CATALOGUE as `lead`
//    entries with no `re`: they cannot be driven here (git older than 2.28).
//
// Lines built in producer functions (pinStatus, latestRelease.line,
// deepResearchFork.line, unseenVendoredSuffix, targetLines) have no site to scan
// in cmdDoctor; the fixtures are what reach them. The one fork reason no fixture
// drives is "built from an older Claude Code native body" (it needs a Claude Code
// binary to compare against); it shares the STALE entry with the others.
//
// An entry marked `gap` is a line doctor prints that SKILL.md has no bullet for
// today. It is listed so this test passes and the gap stays visible; the test
// fails once the bullet exists, so the mark comes off with it.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, symlinkSync, chmodSync, existsSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins/house');
const CLI = join(PLUGIN, 'scripts/house');
const SCRIPT = readFileSync(CLI, 'utf8');
const SKILL = readFileSync(join(PLUGIN, 'skills/doctor/SKILL.md'), 'utf8');
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8')).version;

// ── the SKILL.md bullets ─────────────────────────────────────────────────

// Sections by top-level bullet: the code spans of its bold heading, and the code
// spans anywhere on its nested bullets. Prose outside a bullet is not read.
function skillSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (/^#{1,6} /.test(line)) { current = null; continue; }
    const top = line.match(/^- \*\*(.+?)\*\*/);
    if (top) {
      current = { heading: top[1], spans: [...top[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
      sections.push(current);
    } else if (current && /^\s+- /.test(line)) {
      current.spans.push(...[...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    }
  }
  return sections;
}
const SECTIONS = skillSections(SKILL);
const documented = (under, doc) => SECTIONS.some((s) => s.heading.includes(under) && s.spans.some((sp) => sp.includes(doc)));

// ── what doctor may print, and where SKILL.md documents each line ────────

const GUARD = 'effective branch guard: plugin | repo | NONE';
const FLOOR = 'git-hook floor';
const RELEASE = 'latest release';
const FORK = 'deep-research fork';
const RULE_LOAD = 'rule-load positive control';
const ADOPT = 'at-adoption steps';
const ADOPT_DOC = 'at-adoption steps not confirmed | declined | deferred for <module>: ...';
const TARGET_LINE = /^target (claude-code|codex|gemini|antigravity): (verified: InstructionsLoaded log shows a load at \S+ \(see|unverified here: no InstructionsLoaded load logged for this checkout yet \(see|unverified: (Codex|Gemini CLI|Antigravity CLI) fires no instructions-loaded event; git floor (unknown|not applicable|not rendered|armed|NOT armed)$)/;

const CATALOGUE = [
  { re: /^effective branch guard: repo$/, under: 'effective branch guard', doc: GUARD },
  { re: /^effective branch guard: plugin \(recorded \d{4}-\d\d-\d\d\)$/, under: 'effective branch guard', doc: 'plugin (recorded <date>)' },
  { re: /^effective branch guard: plugin \(unrecorded; /, under: 'effective branch guard', doc: 'plugin (unrecorded; ...)' },
  { re: /^effective branch guard: floor \(recorded \d{4}-\d\d-\d\d; (armed|NOT armed) on this machine, /, under: 'effective branch guard', doc: 'floor (...)' },
  { re: /^effective branch guard: remote \(recorded \d{4}-\d\d-\d\d; /, under: 'effective branch guard', doc: 'remote (...)' },
  { re: /^effective branch guard: NONE \((branchPolicy direct|fail-open: no house\.json)\)$/, under: 'effective branch guard', doc: GUARD },
  { re: /^ {2}caveat: assumes the house plugin is installed and enabled in this session /, under: 'effective branch guard', doc: 'caveat: assumes the house plugin is installed and enabled ...' },

  { re: /^git-hook floor: armed \(core\.hooksPath=/, under: FLOOR, doc: 'armed (...)' },
  { re: /^git-hook floor: NOT armed -- core\.hooksPath is unset in this clone; /, under: FLOOR, doc: 'NOT armed -- core.hooksPath is unset in this clone' },
  // The linked-worktree wording of an unset path is read under the same bullet.
  { re: /^git-hook floor: NOT armed -- core\.hooksPath is unset, and it is shared with the main checkout/, under: FLOOR, doc: 'NOT armed -- core.hooksPath is unset in this clone' },
  { re: /^git-hook floor: NOT armed -- core\.hooksPath is \S+( \(.+?\))?, which is not this repo's \.githooks; /, under: FLOOR, doc: 'NOT armed -- core.hooksPath is <other>' },
  { re: /^git-hook floor: not rendered here \(missing: /, under: FLOOR, doc: 'not rendered here (missing: <paths>)' },
  { re: /^git-hook floor: not applicable \(/, under: FLOOR, doc: 'not applicable' },
  { re: /^ {2}foreign hooks in this clone's \.git\/hooks \(/, under: FLOOR, doc: "foreign hooks in this clone's .git/hooks" },
  { re: /^ {2}not executable \(git silently ignores a hook without the bit\): /, under: FLOOR, doc: 'not executable' },
  { re: /^ {2}reference-transaction: supported by git \S+ \(>= 2\.28\)$/, under: FLOOR, doc: 'reference-transaction: supported by git <version> (>= 2.28)' },
  { lead: 'reference-transaction: inert on git', under: FLOOR, doc: 'inert on git <version> (needs 2.28)' },
  // Printed today with no bullet in SKILL.md.
  { re: /^git-hook floor: off \(the github module is off in house\.json/, under: FLOOR, doc: 'git-hook floor: off', gap: true },
  { re: /^ {2}core\.hooksPath is \S+( \(.+?\))?, a directory that does not exist, /, under: FLOOR, doc: 'a directory that does not exist', gap: true },
  { re: /^git-hook floor: unknown \(/, under: FLOOR, doc: 'git-hook floor: unknown', gap: true },
  { re: /^git-hook floor: NOT armed -- core\.hooksPath is \S+ \(.+?\), a \.githooks that is not a directory \(a moved repo\?\); /, under: FLOOR, doc: 'a moved repo', gap: true },

  { re: /^jq on PATH: (yes|no)$/, under: 'jq on PATH', doc: 'jq on PATH: yes | no' },
  { re: /^plugin version: \S+$/, under: 'plugin version', doc: 'plugin version: <v>' },
  { re: /^pin v\S+ matches plugin v\S+$/, under: 'pin vX matches', doc: 'pin vX matches plugin vY' },
  { re: /^pin v\S+ is behind installed plugin v\S+ \(run `house render --apply` to sync\)$/, under: 'pin vX matches', doc: 'pin vX is behind installed plugin vY' },
  { re: /^pin v\S+ is ahead of installed plugin v\S+ \(update the plugin: /, under: 'pin vX matches', doc: 'pin vX is ahead of installed plugin vY' },
  { re: /^pin v\S+ differs from installed plugin v\S+$/, under: 'pin vX matches', doc: 'pin vX differs from installed plugin vY' },
  { re: /^no version pin \(/, under: 'pin vX matches', doc: 'no version pin', gap: true },
  { re: /^latest release v\S+; installed v\S+ \(\d+ behind\)$/, under: RELEASE, doc: 'latest release vX; installed vY (N behind)' },
  { re: /^installed v\S+ is the latest release$/, under: RELEASE, doc: 'installed vY is the latest release' },
  { re: /^latest release v\S+; installed v\S+ is ahead of it \(unreleased\)$/, under: RELEASE, doc: 'latest release vX; installed vY is ahead of it (unreleased)' },
  { re: /^latest release v\S+; installed \S+ is not a release version$/, under: RELEASE, doc: 'latest release vX; installed Y is not a release version' },
  { re: /^latest release: not checked \(.+\)$/, under: RELEASE, doc: 'latest release: not checked (<reason>)' },
  { re: /^deep-research fork: current \(/, under: FORK, doc: 'deep-research fork: current' },
  { re: /^deep-research fork: STALE \(.+\); rebuild with: node .+ --install$/, under: FORK, doc: 'STALE (<why>); rebuild with: <command>' },
  { re: /^deep-research fork: not installed \(.+\); install with: node .+ --install$/, under: FORK, doc: 'not installed ...' },
  { re: /^deep-research fork: not checked \(.+\)$/, under: FORK, doc: 'not checked (...)' },
  { re: /^npm wiring \(\.house\/check\.mjs referenced by\): (none found|\S.*)$/, under: 'npm wiring', doc: 'npm wiring (.house/check.mjs referenced by): <scripts> | none found' },
  { re: /^\.claude\/settings\.local\.json: (present|absent)$/, under: '.claude/settings.local.json', doc: '.claude/settings.local.json: present | absent' },
  { re: /^rule-load positive control: repo \(\.claude\/settings\.json\)$/, under: RULE_LOAD, doc: 'repo (.claude/settings.json)' },
  { re: /^rule-load positive control: plugin hook; log \S+: last load \S+, \d+ of \d+ vendored rules seen$/, under: RULE_LOAD, doc: 'plugin hook; log <path>: last load <ts>, <n> of <m> vendored rules seen' },
  { re: /^rule-load positive control: plugin hook; log \S+: last load \S+, \d+ of \d+ vendored rules seen; not seen in this log: .+$/, under: RULE_LOAD, doc: '; not seen in this log: <names>' },
  { re: /^rule-load positive control: plugin hook declared; no log yet for this checkout /, under: RULE_LOAD, doc: 'plugin hook declared; no log yet for this checkout' },
  { re: /^rule-load positive control: none wired \(/, under: RULE_LOAD, doc: 'none wired' },
  { re: /^ {2}pooled \d+ log files? \(/, under: RULE_LOAD, doc: 'pooled <n> log files' },
  { re: TARGET_LINE, under: 'target <name>', doc: 'target <name>: ...' },
  { re: /^git-ignored house destinations: none$/, under: 'git-ignored house destinations', doc: 'git-ignored house destinations: none | <paths>' },
  { re: /^git-ignored house destinations: \S.* \(invisible to the checker; narrow the ignore rule to \.claude\/settings\.local\.json\)$/, under: 'git-ignored house destinations', doc: 'git-ignored house destinations: none | <paths>' },
  { re: /^at-adoption steps not confirmed for \S+: .+ \(.+\)$/, under: ADOPT, doc: ADOPT_DOC },
  { re: /^at-adoption steps declined for \S+: .+ \(\d{4}-\d\d-\d\d: .+\)$/, under: ADOPT, doc: ADOPT_DOC },
  { re: /^at-adoption steps deferred for \S+: .+ \(until \d{4}-\d\d-\d\d, .+\)$/, under: ADOPT, doc: ADOPT_DOC },
  { re: /^at-adoption declined steps \S+ no longer declares: .+ \(remove their declined-step deviations\)$/, under: ADOPT, doc: 'at-adoption declined steps <module> no longer declares: ...' },
  { re: /^at-adoption deferrals \S+ no longer declares: .+ \(remove their deferred-step deviations\)$/, under: ADOPT, doc: 'at-adoption deferrals <module> no longer declares: ...' },
  { re: /^at-adoption confirmations \S+ no longer declares: .+ \(remove them from modules\.\S+\.confirmed\)$/, under: ADOPT, doc: 'at-adoption confirmations <module> no longer declares: ...' },
  { re: /^house\.json is present but unparseable: /, under: 'house.json is present but unparseable', doc: 'house.json is present but unparseable: <error>' },
];

// Lines in cmdDoctor that are written from a variable, whose text is built
// elsewhere. The fixtures reach what each one holds.
const PRODUCERS = new Set(['pinStatus', 'latestRelease.line', 'deepResearchFork.line', 'line']);

// ── fixtures: the real CLI over throwaway repos ──────────────────────────

const CLEANUP = [];
after(() => { for (const d of CLEANUP) rmSync(d, { recursive: true, force: true }); });
function scratch(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  CLEANUP.push(d);
  return d;
}

const GIT_ID = ['-c', 'user.email=t@t.com', '-c', 'user.name=t'];
const git = (cwd, ...args) => execFileSync('git', [...GIT_ID, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

function repo(files = { 'README.md': '# hi\n', 'src/a.js': '//a\n' }) {
  const dir = scratch('doctor-skill-repo-');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  // Not on a branch house.json protects, or the floor that render arms would refuse the commit below.
  git(dir, '-c', 'init.defaultBranch=work', 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const houseJson = (over = {}) => ({ version: PLUGIN_VERSION, defaultBranch: 'main', branchPolicy: 'pr', protectedBranches: ['main'], ...over });
const writeHouse = (dir, data) => writeFileSync(join(dir, 'house.json'), `${JSON.stringify(data, null, 2)}\n`);
const readHouse = (dir) => JSON.parse(readFileSync(join(dir, 'house.json'), 'utf8'));
const editHouse = (dir, fn) => { const h = readHouse(dir); fn(h); writeHouse(dir, h); };

// A copy of the whole plugin, for the cases that need a different plugin: its
// version, its fork builder, its hooks.
function pluginCopy(edit) {
  const dir = join(scratch('doctor-skill-plugin-'), 'house');
  cpSync(PLUGIN, dir, { recursive: true });
  edit(dir);
  return join(dir, 'scripts/house');
}

// Every doctor run gets its own HOME and CLAUDE_CONFIG_DIR, and a releases URL
// that refuses the connection, so no run reads the machine or the network.
const BASE_ENV = (() => {
  const env = { ...process.env, HOUSE_RELEASES_URL: 'http://127.0.0.1:1/' };
  for (const k of ['GITHUB_TOKEN', 'HOUSE_RELEASES_FIXTURE', 'HOUSE_RELEASES_SEND_TOKEN', 'CLAUDE_CODE_PROJECT_DIR_NAME']) delete env[k];
  return env;
})();

// A PATH with git on it and nothing else: no jq, and no bash for the floor probe.
function gitOnlyPath() {
  const dir = scratch('doctor-skill-gitonly-');
  const found = (process.env.PATH || '').split(delimiter).map((d) => join(d, 'git')).find((p) => existsSync(p));
  assert.ok(found, 'git is on PATH');
  symlinkSync(found, join(dir, 'git'));
  return dir;
}

const CAPTURED = [];
let driven = false;
const captured = () => { if (!driven) { driven = true; driveDoctor(); } return CAPTURED; };

/** Run `doctor` and keep every line it printed, with where it came from. */
function doctor(scenario, repoDir, { env = {}, cli = CLI } = {}) {
  const run = {
    ...BASE_ENV,
    HOME: scratch('doctor-skill-home-'),
    CLAUDE_CONFIG_DIR: scratch('doctor-skill-config-'),
    ...env,
  };
  const r = spawnSync(process.execPath, [cli, 'doctor', '--repo', repoDir], { encoding: 'utf8', env: run, timeout: 60000 });
  assert.equal(r.status, 0, `${scenario}: doctor exits 0\n${r.stdout}${r.stderr}`);
  const lines = [];
  for (const [stream, text] of [['stdout', r.stdout], ['stderr', r.stderr]]) {
    for (const t of text.split('\n')) if (t.trim()) lines.push({ scenario, stream, text: t });
  }
  CAPTURED.push(...lines);
  return lines.map((l) => l.text);
}

function rendered(over = {}) {
  const dir = repo();
  execFileSync(process.execPath, [CLI, 'init', '--repo', dir, '--apply'], { env: { ...BASE_ENV, HOME: scratch('doctor-skill-home-') }, stdio: 'pipe' });
  editHouse(dir, (h) => Object.assign(h, over));
  const r = spawnSync(process.execPath, [CLI, 'render', '--repo', dir, '--apply'], { encoding: 'utf8', env: { ...BASE_ENV, HOME: scratch('doctor-skill-home-'), CLAUDE_CONFIG_DIR: scratch('doctor-skill-config-') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'render');
  return dir;
}

function writeLog(configDir, key, lines) {
  const dir = join(configDir, 'house', 'instructions-loaded');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

const sha12 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const FORK_SCRIPT = join(PLUGIN, 'modules/claude-code/files/check-deep-research-upstream.mjs');

/** Drive each branch of doctor's output. Fills CAPTURED. */
function driveDoctor() {
  const releases = (name, body) => {
    const f = join(scratch('doctor-skill-releases-'), name);
    writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
    return f;
  };

  // Not adopted, and adopted with the direct policy.
  doctor('plain repo', repo());
  const direct = repo();
  writeHouse(direct, houseJson({ branchPolicy: 'direct' }));
  doctor('direct policy', direct);

  // The repo's own guard, wiring facts, and the rule-load line that reads the repo.
  const own = repo({ 'README.md': '# hi\n', '.claude/hooks/no-direct-master.sh': '#!/bin/sh\n', 'package.json': JSON.stringify({ scripts: { 'check:house': 'node .house/check.mjs' } }) });
  writeHouse(own, houseJson());
  mkdirSync(join(own, '.claude'), { recursive: true });
  writeFileSync(join(own, '.claude/settings.local.json'), '{}\n');
  writeFileSync(join(own, '.claude/settings.json'), JSON.stringify({ hooks: { InstructionsLoaded: [{ hooks: [{ type: 'command', command: 'node y' }] }] } }));
  doctor('repo guard, repo rule-load', own);

  // The guard decision records, and the caveat that goes with the plugin one.
  const decided = repo();
  for (const [by, extra] of [['plugin', {}], ['floor', {}], ['remote', {}]]) {
    writeHouse(decided, houseJson({ guard: { by, decided: '2026-01-02', why: 'a reason', ...extra } }));
    doctor(`guard recorded ${by}`, decided);
  }
  writeHouse(decided, houseJson());
  doctor('guard unrecorded', decided);

  // The pin against the plugin, in each direction.
  const [maj] = PLUGIN_VERSION.split('.');
  for (const [name, version] of [['ahead', `${Number(maj) + 1}.0.0`], ['behind', '0.0.1'], ['differs', 'banana']]) {
    writeHouse(decided, houseJson({ version }));
    doctor(`pin ${name}`, decided);
  }
  const noPin = houseJson();
  delete noPin.version;
  writeHouse(decided, noPin);
  doctor('no pin', decided);
  writeFileSync(join(decided, 'house.json'), '{ not json');
  doctor('unparseable house.json', decided);

  // The latest release, in each state the releases list can leave it in.
  const base = repo();
  writeHouse(base, houseJson());
  const list = (...tags) => tags.map((tag_name) => ({ tag_name, draft: false, prerelease: false }));
  doctor('release behind', base, { env: { HOUSE_RELEASES_FIXTURE: releases('r.json', list('v999.0.0', 'v998.0.0', `v${PLUGIN_VERSION}`)) } });
  doctor('release latest', base, { env: { HOUSE_RELEASES_FIXTURE: releases('r.json', list(`v${PLUGIN_VERSION}`)) } });
  doctor('release ahead', base, { env: { HOUSE_RELEASES_FIXTURE: releases('r.json', list('v0.0.1')) } });
  doctor('release not json', base, { env: { HOUSE_RELEASES_FIXTURE: releases('r.json', 'not json') } });
  const devCli = pluginCopy((dir) => {
    const p = join(dir, '.claude-plugin/plugin.json');
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), version: 'dev-build' }));
  });
  doctor('release not a release version', base, { cli: devCli, env: { HOUSE_RELEASES_FIXTURE: releases('r.json', list('v1.0.0')) } });

  // No jq and no bash.
  doctor('no jq, no bash', base, { env: { PATH: gitOnlyPath() } });

  // The deep-research fork, in each state a file at its path can be in.
  const forkRepo = repo();
  writeHouse(forkRepo, houseJson());
  const forkAt = (setup) => {
    const config = scratch('doctor-skill-config-');
    const fork = join(config, 'workflows', 'deep-research-tiered.js');
    mkdirSync(dirname(fork), { recursive: true });
    setup(fork);
    return { CLAUDE_CONFIG_DIR: config };
  };
  const body = '// fork body\n';
  const marker = (build, bodyHash) => `// house-fork-build: ${build} ${bodyHash}\n`;
  doctor('fork current', forkRepo, { env: forkAt((f) => writeFileSync(f, marker(sha12(readFileSync(FORK_SCRIPT)), sha12(body)) + body)) });
  doctor('fork no marker', forkRepo, { env: forkAt((f) => writeFileSync(f, body)) });
  doctor('fork other build', forkRepo, { env: forkAt((f) => writeFileSync(f, marker('0'.repeat(12), sha12(body)) + body)) });
  doctor('fork body differs', forkRepo, { env: forkAt((f) => writeFileSync(f, marker(sha12(readFileSync(FORK_SCRIPT)), '0'.repeat(12)) + body)) });
  doctor('fork unreadable', forkRepo, { env: forkAt((f) => mkdirSync(f)) });
  doctor('fork builder absent', forkRepo, { cli: pluginCopy((dir) => rmSync(join(dir, 'modules/claude-code/files/check-deep-research-upstream.mjs'))) });

  // The rule-load line from the plugin's hook, a log that saw some rules, and the
  // legacy worktree logs pooled in; and the target lines of every agent.
  const seen = rendered({ targets: ['claude-code', 'codex', 'gemini', 'antigravity'] });
  const config = scratch('doctor-skill-config-');
  const rule = (name) => join(seen, '.claude/rules/house', name);
  const key = seen.replace(/\//g, '-');
  writeLog(config, key, [{ ts: '2026-09-08T10:05:00.000Z', file_path: rule('github.md'), load_reason: 'session_start', session_id: 's' }]);
  writeLog(config, `${key}-.claude-worktrees-old`, [{ ts: '2026-09-08T10:00:00.000Z', file_path: rule('docs.md'), load_reason: 'session_start', session_id: 's' }]);
  doctor('rule-load log, pooled, every target', seen, { env: { CLAUDE_CONFIG_DIR: config } });
  const allSeen = scratch('doctor-skill-config-');
  writeLog(allSeen, 'k', ['claude-code.md', 'docs.md', 'engineering.md', 'github.md'].map((n) => ({ ts: '2026-09-08T10:05:00.000Z', file_path: rule(n), load_reason: 'session_start', session_id: 's' })));
  doctor('rule-load log, every rule seen', seen, { env: { CLAUDE_CONFIG_DIR: allSeen, CLAUDE_CODE_PROJECT_DIR_NAME: 'k' } });
  doctor('rule-load none wired', base, { cli: pluginCopy((dir) => rmSync(join(dir, 'hooks/hooks.json'))) });

  // The git-hook floor in each state.
  const floor = rendered();
  doctor('floor armed', floor);
  writeFileSync(join(floor, '.gitignore'), '.claude/\n');
  doctor('git-ignored destinations', floor);
  rmSync(join(floor, '.gitignore'));
  chmodSync(join(floor, '.githooks/pre-push'), 0o644);
  doctor('floor not executable', floor);
  chmodSync(join(floor, '.githooks/pre-push'), 0o755);
  git(floor, 'config', 'core.hooksPath', 'elsewhere');
  doctor('floor owned by another tool', floor);
  git(floor, 'config', '--unset', 'core.hooksPath');
  mkdirSync(join(floor, '.git/hooks'), { recursive: true });
  writeFileSync(join(floor, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(floor, '.git/hooks/pre-commit'), 0o755);
  doctor('floor unset, foreign hooks', floor);
  rmSync(join(floor, '.git/hooks/pre-commit'));
  doctor('floor unset', floor);
  const wt = join(scratch('doctor-skill-wt-'), 'wt');
  git(floor, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
  doctor('floor unset, linked worktree', wt);
  const gone = join(scratch('doctor-skill-gone-'), 'repo', '.githooks');
  git(floor, 'config', 'core.hooksPath', gone);
  doctor('floor moved repo', floor);
  doctor('floor moved repo, linked worktree', wt);
  writeFileSync(join(floor, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(floor, '.git/hooks/pre-commit'), 0o755);
  doctor('floor moved repo, foreign hooks', floor);
  rmSync(join(floor, '.git/hooks/pre-commit'));
  editHouse(floor, (h) => { h.modules.github.enabled = false; });
  doctor('floor off, dead hooksPath', floor);
  git(floor, 'config', '--unset', 'core.hooksPath');
  doctor('floor off', floor);
  const unrendered = repo();
  writeHouse(unrendered, houseJson());
  doctor('floor not rendered', unrendered);

  // The at-adoption steps: open, deferral lapsed, declined, deferred, and a
  // record that names a step the module no longer declares.
  const adopt = rendered();
  doctor('at-adoption open', adopt);
  editHouse(adopt, (h) => {
    h.modules.github.confirmed = { 'push-protection': '2026-01-01', 'gone-confirmed': '2026-01-01' };
    h.deviations = [
      { kind: 'declined-step', module: 'github', step: 'head-branch-deletion', what: 'w', why: 'solo repo', decided: '2026-01-01' },
      { kind: 'declined-step', module: 'github', step: 'gone-declined', what: 'w', why: 'x', decided: '2026-01-01' },
      { kind: 'deferred-step', module: 'github', step: 'branch-protection', what: 'w', why: 'waiting on the org admin', decided: '2026-01-01', until: '2099-01-01', ref: 'https://example.test/issues/9' },
      { kind: 'deferred-step', module: 'github', step: 'multi-factor', what: 'w', why: 'x', decided: '2026-01-01', until: '2026-01-02' },
      { kind: 'deferred-step', module: 'github', step: 'gone-deferred', what: 'w', why: 'x', decided: '2026-01-01', until: '2099-01-01' },
    ];
  });
  doctor('at-adoption decided', adopt);
  rmSync(join(adopt, '.house/check.mjs'));
  doctor('at-adoption, checker not vendored', adopt);
}

// ── the label reader: a static read of the output sites ──────────────────

function functionBody(name) {
  const start = SCRIPT.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} not found in plugins/house/scripts/house`);
  const end = SCRIPT.indexOf('\n}\n', start);
  return SCRIPT.slice(start, end);
}

// The index just past the string literal opening at `at`, `${ ... }` included.
function skipLiteral(src, at) {
  const quote = src[at];
  let i = at + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === quote) return i + 1;
    else if (quote === '`' && src[i] === '$' && src[i + 1] === '{') i = skipBraces(src, i + 2);
    else i++;
  }
  return i;
}
function skipBraces(src, from) {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    if ('\'"`'.includes(src[i])) i = skipLiteral(src, i);
    else if (src[i] === '{') { depth++; i++; } else if (src[i] === '}') { depth--; i++; if (!depth) return i; } else i++;
  }
  return i;
}

// Text before the first `${` or the closing quote of the literal opening at `at`.
function literalLead(src, at) {
  const quote = src[at];
  let out = '';
  for (let i = at + 1; i < src.length; i++) {
    if (src[i] === '\\') { out += src[i + 1]; i++; continue; }
    if (src[i] === quote || (quote === '`' && src[i] === '$' && src[i + 1] === '{')) break;
    out += src[i];
  }
  return out;
}

// Every literal lead one writer argument can print: a literal, either branch of
// a ternary (nested ones too), or a named producer. Anything else is unknown.
function argumentLeads(src, at, out) {
  const rest = src.slice(at);
  const head = rest.match(/^\s*/)[0].length;
  const open = at + head;
  if ('\'"`'.includes(src[open])) { out.leads.push(literalLead(src, open)); return; }
  const cond = rest.match(/^\s*[\w.]+\s*\?\s*/);
  if (cond) {
    const first = at + cond[0].length;
    if (!'\'"`'.includes(src[first])) { out.unknown.push(rest.slice(0, 60).split('\n')[0]); return; }
    out.leads.push(literalLead(src, first));
    const after = skipLiteral(src, first);
    const colon = src.slice(after).match(/^\s*:/);
    if (colon) argumentLeads(src, after + colon[0].length, out);
    return;
  }
  if (/^\s*JSON\.stringify\(/.test(rest)) return;
  const ident = rest.match(/^\s*([\w.]+)\s*\)/);
  if (ident && PRODUCERS.has(ident[1])) return;
  out.unknown.push(rest.slice(0, 60).split('\n')[0]);
}

// Every literal lead cmdDoctor (and the floor helper) can print, and every
// writer shape this reader cannot read.
function outputLeads(body, helperBody) {
  const out = { leads: [], unknown: [] };
  for (const m of body.matchAll(/(?:console\.\w+|process\.(?:stdout|stderr)\.write)\(/g)) argumentLeads(body, m.index + m[0].length, out);
  // The floor helper builds its lines in arrays, so every literal that opens as
  // a floor line or an indented follow-on is read, wherever it sits.
  for (const m of helperBody.matchAll(/([`'"])(git-hook floor: |  [a-z])/g)) out.leads.push(literalLead(helperBody, m.index));
  // A lead that starts with an interpolation has no label to look up, and an
  // empty one would be a prefix of every line, so it is reported, never read.
  const blank = out.leads.filter((l) => !l.trim());
  out.leads = out.leads.filter((l) => l.trim());
  out.unknown.push(...blank.map(() => 'a line with no text before its first interpolation'));
  return out;
}

/** Captured lines that no catalogue entry matches. */
function unmatchedLines(lines) {
  return lines.filter((l) => !CATALOGUE.some((e) => e.re && e.re.test(l.text)));
}

/** Leads that are neither the start of a captured line nor a static-only entry. */
function undrivenLeads(leads, lines) {
  return leads.filter((lead) => {
    const t = lead.trim();
    return !lines.some((l) => l.text.trim().startsWith(t)) && !CATALOGUE.some((e) => e.lead && e.lead.startsWith(t));
  });
}

const doctorBody = functionBody('cmdDoctor');
const floorBody = functionBody('gitHookFloorLines');

test('#465: every line doctor prints over the fixtures matches a catalogue entry', () => {
  assert.ok(captured().length > 100, `read only ${captured().length} lines`);
  const bad = unmatchedLines(captured()).map((l) => `[${l.scenario}, ${l.stream}] ${l.text}`);
  assert.deepEqual(bad, [], 'doctor printed these lines, which CATALOGUE does not know; add a bullet for each to plugins/house/skills/doctor/SKILL.md and an entry here');
});

test('#465: every catalogue entry that a fixture can reach is reached', () => {
  const idle = CATALOGUE.filter((e) => e.re && !captured().some((l) => e.re.test(l.text))).map((e) => String(e.re));
  assert.deepEqual(idle, [], 'no fixture prints these; drive them or drop the entry');
});

test('#465: every catalogue entry is documented under a SKILL.md bullet, in a code span, and a gap is still a gap', () => {
  const missing = CATALOGUE.filter((e) => !e.gap && !documented(e.under, e.doc)).map((e) => `${e.under} / ${e.doc}`);
  assert.deepEqual(missing, [], 'plugins/house/skills/doctor/SKILL.md has no bullet naming these in a code span');
  const closed = CATALOGUE.filter((e) => e.gap && documented(e.under, e.doc)).map((e) => e.doc);
  assert.deepEqual(closed, [], 'SKILL.md now documents these; take `gap: true` off their entries');
});

test('#462, #465: every output site in cmdDoctor and the floor helper prints a line a fixture drives', () => {
  const { leads, unknown } = outputLeads(doctorBody, floorBody);
  assert.deepEqual(unknown, [], 'an output shape this reader cannot read; teach it, or name the producer in PRODUCERS');
  assert.ok(leads.length >= 25, `read only ${leads.length} output sites`);
  assert.deepEqual(undrivenLeads(leads, captured()), [], 'no fixture prints a line starting like these output sites; drive them, or list them as `lead` entries in CATALOGUE');
});

// ── controls: each of the four shapes in #465 is caught ──────────────────

const plantedLeads = (planted) => outputLeads(doctorBody.replace('console.log(`jq on PATH:', `${planted}\n    console.log(\`jq on PATH:`), floorBody);

test('#465: a prose-only match does not document a line (negative control)', () => {
  // Words that appear in SKILL.md prose, in no bullet heading.
  assert.ok(SKILL.includes('the repo'), 'the phrase is in the skill text');
  assert.equal(unmatchedLines([{ scenario: 'planted', stream: 'stdout', text: 'the repo is fine' }]).length, 1);
  assert.equal(unmatchedLines([{ scenario: 'planted', stream: 'stdout', text: 'house.json is fine' }]).length, 1);
  assert.equal(documented('effective branch guard', 'the plugin hook defers'), false, 'bullet prose is not a code span');
  assert.deepEqual(undrivenLeads(plantedLeads("console.log('the repo is fine');").leads, captured()), ['the repo is fine']);
});

test('#465: the second branch of a ternary is read (positive control)', () => {
  const { leads } = plantedLeads("console.log(jqOnPath ? 'jq on PATH: yes' : 'brand new line');");
  assert.ok(leads.includes('brand new line'), leads.join(' | '));
  assert.deepEqual(undrivenLeads(leads, captured()), ['brand new line']);
});

test('#465: other writers are read (positive control)', () => {
  for (const planted of ["console.error('stderr only line');", "process.stdout.write('stdout only line\\n');", "console.warn('warn only line');"]) {
    assert.deepEqual(undrivenLeads(plantedLeads(planted).leads, captured()).length, 1, planted);
  }
  const lines = [{ scenario: 'planted', stream: 'stderr', text: 'stderr only line' }];
  assert.equal(unmatchedLines(lines).length, 1, 'a line on stderr is held to the catalogue too');
});

test('#465: a new state of an existing line sharing its first words is not matched (negative control)', () => {
  for (const text of ['jq on PATH: maybe', 'plugin version: ', 'git-hook floor: armed', 'effective branch guard: unknown', 'pin v1.0.0 is mystery plugin v2.0.0']) {
    assert.equal(unmatchedLines([{ scenario: 'planted', stream: 'stdout', text }]).length, 1, text);
  }
  assert.equal(unmatchedLines([{ scenario: 'planted', stream: 'stdout', text: 'jq on PATH: yes' }]).length, 0, 'a real line still matches');
});

test('#462: the output reader reports a writer shape it cannot read (negative control)', () => {
  assert.equal(plantedLeads('console.log(someNewLine);').unknown.length, 1);
});

test('#462: the output reader reports a line with no text before its first interpolation (negative control)', () => {
  for (const planted of ['console.log(`${x}: brand new`);', 'console.log(`  ${x}: brand new`);']) {
    const { leads, unknown } = plantedLeads(planted);
    assert.equal(unknown.length, 1, planted);
    assert.ok(!leads.includes(''), 'an empty lead would be the start of every line');
  }
});
