// The orchestration port: a pinned roster in plugins/house/agents/, the
// session-start text in plugins/house/orchestration/, the hook that injects
// it, and the checker that watches the upstream kit it was ported from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AGENTS = join(ROOT, 'plugins/house/agents');
const HOOK = join(ROOT, 'plugins/house/hooks/session-start.mjs');
const TEXT = join(ROOT, 'plugins/house/orchestration/ORCHESTRATION.md');
const KIT_CHECK = join(ROOT, 'scripts/check-orchestration-kit-upstream.mjs');

const ROSTER = { scout: 'haiku', researcher: 'sonnet', builder: 'sonnet', refuter: 'opus', debugger: 'opus' };

function frontmatter(path) {
  const s = readFileSync(path, 'utf8');
  assert.ok(s.startsWith('---\n'), `${path}: no frontmatter`);
  const end = s.indexOf('\n---', 4);
  const fm = {};
  for (const line of s.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: s.slice(end + 4) };
}

test('roster: exactly the five agents ship, each pinned to its tier', () => {
  const files = readdirSync(AGENTS).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, Object.keys(ROSTER).sort().map((n) => `${n}.md`));
  for (const [name, model] of Object.entries(ROSTER)) {
    const { fm } = frontmatter(join(AGENTS, `${name}.md`));
    assert.equal(fm.name, name);
    assert.equal(fm.model, model, `${name} must pin ${model}`);
    assert.ok(['low', 'medium', 'high'].includes(fm.effort), `${name}: effort pinned`);
    assert.ok(fm.description && fm.description.length > 40, `${name}: description is how the model picks it`);
  }
});

test('roster: no agent runs on the session top tier or inherits, and none can spawn an agent', () => {
  for (const name of Object.keys(ROSTER)) {
    const { fm } = frontmatter(join(AGENTS, `${name}.md`));
    assert.ok(!/fable|inherit/.test(fm.model), `${name}: model ${fm.model}`);
    const tools = fm.tools.split(',').map((t) => t.trim());
    assert.ok(tools.length > 0 && !tools.includes('Agent'), `${name}: Agent must not be in tools`);
    assert.ok(!tools.includes('Workflow'), `${name}: Workflow must not be in tools`);
  }
});

test('roster: only the builder can edit; refuter and debugger are read-and-run only', () => {
  const tools = (n) => frontmatter(join(AGENTS, `${n}.md`)).fm.tools.split(',').map((t) => t.trim());
  for (const n of ['scout', 'researcher', 'refuter', 'debugger']) {
    for (const t of ['Edit', 'Write', 'NotebookEdit']) assert.ok(!tools(n).includes(t), `${n} must not have ${t}`);
  }
  assert.ok(tools('builder').includes('Edit') && tools('builder').includes('Write'));
  assert.ok(!tools('scout').includes('Bash'), 'scout locates, it does not run');
});

test('roster and text carry no em dash (prose rule)', () => {
  for (const f of [...Object.keys(ROSTER).map((n) => join(AGENTS, `${n}.md`)), TEXT]) {
    assert.ok(!readFileSync(f, 'utf8').includes('—'), `${f}: em dash`);
  }
});

test('session-start hook emits the orchestration text under hookSpecificOutput.additionalContext and exits 0', () => {
  const res = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }) });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.startsWith('<house-orchestration>'));
  assert.ok(ctx.includes(readFileSync(TEXT, 'utf8').trim()), 'the whole text is carried');
  assert.ok(!('additionalContext' in out), 'no top-level field, which Claude Code ignores');
  for (const n of Object.keys(ROSTER)) assert.ok(ctx.includes(`\`${n}\``), `text names ${n}`);
  assert.ok(/Never the session's top tier on a subagent/.test(ctx));
  assert.ok(ctx.includes('Enter a worktree before the first edit'), 'worktree-first is unconditional');
});

test('session-start hook with the text missing emits nothing and still exits 0 (never costs a session)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hook-'));
  const hooks = join(dir, 'hooks');
  execFileSync('mkdir', ['-p', hooks]);
  writeFileSync(join(hooks, 'session-start.mjs'), readFileSync(HOOK, 'utf8'));
  const res = spawnSync(process.execPath, [join(hooks, 'session-start.mjs')], { encoding: 'utf8', input: '{}' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});

test('hooks.json declares the SessionStart entry on startup, clear and compact', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'plugins/house/hooks/hooks.json'), 'utf8'));
  // #58 adds a second SessionStart entry (the git-hook arming script), so find
  // this one by its command rather than by position.
  const entry = (h.hooks.SessionStart || []).find((e) => e.hooks?.some((x) => /session-start\.mjs/.test(x.command)));
  assert.ok(entry, 'SessionStart entry for session-start.mjs present');
  assert.equal(entry.matcher, 'startup|clear|compact');
  assert.match(entry.hooks[0].command, /session-start\.mjs/);
});

test('orchestration text budget: under 120 lines and 9KB, since every session pays for it', () => {
  const s = readFileSync(TEXT, 'utf8');
  assert.ok(s.split('\n').length < 120, `lines: ${s.split('\n').length}`);
  assert.ok(Buffer.byteLength(s) < 9000, `bytes: ${Buffer.byteLength(s)}`);
});

// The upstream checker, against a local bare repo so no network is needed.
function bareRepo(commits) {
  const dir = mkdtempSync(join(tmpdir(), 'house-kit-'));
  const work = join(dir, 'work');
  const bare = join(dir, 'bare.git');
  execFileSync('git', ['init', '-q', work]);
  execFileSync('git', ['-C', work, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const shas = [];
  for (const [i, files] of commits.entries()) {
    for (const [p, c] of Object.entries(files)) {
      execFileSync('mkdir', ['-p', join(work, p, '..')]);
      writeFileSync(join(work, p), c);
    }
    execFileSync('git', ['-C', work, 'add', '-A'], { env });
    execFileSync('git', ['-C', work, 'commit', '-q', '-m', `c${i}`], { env });
    shas.push(execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  }
  execFileSync('git', ['clone', '-q', '--bare', work, bare]);
  return { bare, shas };
}

function runKit(args) {
  return spawnSync(process.execPath, [KIT_CHECK, ...args], { encoding: 'utf8' });
}

test('kit check: the pinned sha is a full sha and the ported paths are named', async () => {
  const mod = await import(pathToFileURL(KIT_CHECK).href);
  assert.match(mod.PINNED.sha, /^[0-9a-f]{40}$/);
  assert.ok(mod.PINNED.ported.length > 0);
  assert.match(mod.PINNED.remote, /^https:\/\/github\.com\//);
});

test('kit check: a remote whose head equals the pin exits 0 (negative control, via a sha-patched copy)', () => {
  const { bare, shas } = bareRepo([{ 'core/CLAUDE.md': 'a\n' }]);
  const dir = mkdtempSync(join(tmpdir(), 'house-kit-'));
  const copy = join(dir, 'check.mjs');
  writeFileSync(copy, readFileSync(KIT_CHECK, 'utf8').replace(/sha: '[0-9a-f]{40}'/, `sha: '${shas[0]}'`));
  const res = spawnSync(process.execPath, [copy, `--remote=${bare}`, '--json'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(JSON.parse(res.stdout).verdict, /unchanged/);
});

test('kit check: a moved remote exits 1, names both shas, and --diff prints the stat of the ported paths', () => {
  const { bare, shas } = bareRepo([{ 'core/CLAUDE.md': 'a\n' }, { 'core/CLAUDE.md': 'a\nb\n', 'README.md': 'x\n' }]);
  const dir = mkdtempSync(join(tmpdir(), 'house-kit-'));
  const copy = join(dir, 'check.mjs');
  writeFileSync(copy, readFileSync(KIT_CHECK, 'utf8').replace(/sha: '[0-9a-f]{40}'/, `sha: '${shas[0]}'`));
  const res = spawnSync(process.execPath, [copy, `--remote=${bare}`, '--diff', '--json'], { encoding: 'utf8' });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /moved/);
  assert.equal(j.head, shas[1]);
  assert.equal(j.pinned, shas[0]);
  assert.match(j.diffStat, /core\/CLAUDE\.md/);
  assert.ok(!/README\.md/.test(j.diffStat), 'stat is scoped to the ported paths');
});

test('kit check: an unreadable remote exits 3, never 0 (positive control)', () => {
  const res = runKit(['--remote=/definitely/not/a/repo', '--json']);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(JSON.parse(res.stdout).verdict, /unreadable/);
});

test('kit check: an unknown argument exits 3', () => {
  const res = runKit(['--bogus']);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /bad argument/);
});
