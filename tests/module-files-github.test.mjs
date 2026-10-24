// Tests for the vendored github module files under plugins/house/modules/
// (github/{scan-dist-secrets.mjs,cleanup-worktree.sh}, with the
// 25-secret-content and pr-checks templates that run the scanner).
//
// These are the literal files a consuming repo gets copied into
// scripts/house/** by `house render` (module.json's files[] entries) — they
// are tested here directly at their files/ source path, not through the
// render pipeline (that's tests/cli-house.test.mjs's job). One file per
// module; the helpers they share are in module-files-helpers.mjs.
//
// Every sandbox is a throwaway dir under the OS tmpdir. No network calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, symlinkSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { ROOT, mktemp, makeRepoWithOrigin } from './module-files-helpers.mjs';
import { spawnCpuSync } from './spawn-cpu.mjs';

const SCAN_SECRETS = join(ROOT, 'plugins/house/modules/github/files/scan-dist-secrets.mjs');
const CLEANUP_SH = join(ROOT, 'plugins/house/modules/github/files/cleanup-worktree.sh');

// ===========================================================================
// github/scan-dist-secrets.mjs
// ===========================================================================

test('scan-dist-secrets: catches a planted real-looking token in a fixture dist/ (positive control)', () => {
  const dir = mktemp('house-scan-dist-');
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(distDir, 'index.html'),
    '<html>sk-ant-api03-FAKE0000000000000000000000000000000000000000</html>',
  );
  const res = spawnSync(process.execPath, [
    SCAN_SECRETS,
    `--dist-dir=${distDir}`,
    `--vars-file=${join(dir, 'does-not-exist.vars')}`,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /LEAK/);
  assert.match(res.stderr, /sk-ant-/);
});

test('scan-dist-secrets: a clean dist/ passes (negative control)', () => {
  const dir = mktemp('house-scan-dist-');
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<html>hello, nothing secret here</html>');
  const res = spawnSync(process.execPath, [
    SCAN_SECRETS,
    `--dist-dir=${distDir}`,
    `--vars-file=${join(dir, 'does-not-exist.vars')}`,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /clean/);
});

test('scan-dist-secrets: --patterns extends detection with a project-specific marker', () => {
  const dir = mktemp('house-scan-dist-');
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<html>zz_project_specific_marker_value</html>');
  const patternsFile = join(dir, 'patterns.json');
  writeFileSync(patternsFile, JSON.stringify(['zz_project_specific_marker_value']));
  const res = spawnSync(process.execPath, [
    SCAN_SECRETS,
    `--dist-dir=${distDir}`,
    `--vars-file=${join(dir, 'does-not-exist.vars')}`,
    `--patterns=${patternsFile}`,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /LEAK/);
});

// ---------------------------------------------------------------------------
// scan-dist-secrets --staged / --history (#402)
//
// Token-shaped strings are built from parts so this file never holds a
// literal that push protection or the scanner itself would flag.
// ---------------------------------------------------------------------------

const SECRET_CANARIES = {
  'aws-access-key-id': ['AK' + 'IA' + 'ZZTESTKEY0000000'],
  'github-token': ['gh' + 'p_' + 'a'.repeat(36), 'gh' + 'o_' + 'a'.repeat(36), 'gh' + 'u_' + 'a'.repeat(36),
    'gh' + 's_' + 'a'.repeat(36), 'gh' + 'r_' + 'a'.repeat(36), 'github' + '_pat_' + 'b'.repeat(70)],
  'slack-token': ['xo' + 'xb-' + '123456789012-1234567890123-abcdefghijklmnopqrstuvwx',
    'xo' + 'xp-' + '1234567890-1234567890-1234567890-0123456789abcdef0123456789abcdef',
    'xo' + 'xs-' + '123456789012-123456789012-123456789012-0123456789abcdef0123456789abcdef', // legacy
    'xo' + 'xa-2-' + '123456789012-1234567890123-0123456789abcdef0123456789abcdef',
    'xo' + 'xe.xo' + 'xp-1-' + 'A1'.repeat(30)],
  'stripe-live-key': ['sk' + '_live_' + 'a1'.repeat(12)],
  'google-api-key': ['AI' + 'za' + 'A'.repeat(35)],
  'private-key-header': ['-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----', '-----BEGIN ' + 'OPENSSH PRIVATE' + ' KEY-----'],
  'anthropic-key': ['sk-' + 'ant-' + 'api03-' + 'x'.repeat(40)],
  'openai-key': ['sk-' + 'proj-' + 'y'.repeat(40)],
};

// One-character-short or wrong-prefix lookalikes: the rules anchor on prefix and length.
const SECRET_NEAR_MISSES = [
  'AK' + 'IA' + 'ZZTESTKEY000000', // 15 after the prefix
  'gh' + 'p_' + 'a'.repeat(35),
  'gh' + 'x_' + 'a'.repeat(36),
  'xo' + 'xb-' + '123-456',
  'xo' + 'xb-' + 'header-nav-item-primary-link-active-state', // CSS-like class, no digit groups
  'xo' + 'xb-' + '1234-placeholder',
  'xo' + 'xb-' + '0000-0000-XXXXXXXXXX',
  'sk' + '_live_' + 'short',
  'sk' + '_test_' + 'a1'.repeat(12),
  'AI' + 'za' + 'A'.repeat(34),
  '-----BEGIN ' + 'PUBLIC' + ' KEY-----',
  'sk-' + 'ant-' + 'api03-' + 'x'.repeat(10),
  'sk-' + 'proj-' + 'y'.repeat(10),
  'AK' + 'IA' + 'IOSFODNN7EXAMPLE', // AWS's documented example key
];

const GIT_TEST_ENV = (() => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(k)) delete env[k];
  return env;
})();

function gitIn(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env: GIT_TEST_ENV });
}

function newScanRepo() {
  const dir = mktemp('house-scan-git-');
  gitIn(dir, 'init', '-q');
  return dir;
}

function scanGitMode(dir, ...args) {
  return spawnSync(process.execPath, [SCAN_SECRETS, ...args, `--repo=${dir}`], { encoding: 'utf8', env: GIT_TEST_ENV });
}

test('scan-dist-secrets: --self-test covers every rule, --staged, --history, --rev and the allowlist', () => {
  const res = spawnSync(process.execPath, [SCAN_SECRETS, '--self-test'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /self-test OK/);
  assert.match(res.stdout, /8 rules, --staged, --history, --rev, allowlist/);
});

for (const [rule, values] of Object.entries(SECRET_CANARIES)) {
  test(`scan-dist-secrets --staged: rule ${rule} fires on a staged canary and names the file, never the value (positive control)`, () => {
    for (const value of values) {
      const dir = newScanRepo();
      writeFileSync(join(dir, 'notes.txt'), `token = ${value}\n`);
      gitIn(dir, 'add', 'notes.txt');
      const res = scanGitMode(dir, '--staged');
      assert.equal(res.status, 1, res.stderr);
      assert.match(res.stderr, new RegExp(`notes\\.txt.*matches "${rule}"`));
      assert.ok(!res.stderr.includes(value) && !res.stdout.includes(value), 'the value must never be printed');
    }
  });
}

test('scan-dist-secrets --staged: clean content and near-miss lookalikes pass (negative control)', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'a.txt'), 'plain prose\n' + SECRET_NEAR_MISSES.join('\n') + '\n');
  gitIn(dir, 'add', 'a.txt');
  const res = scanGitMode(dir, '--staged');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /clean/);
});

test('scan-dist-secrets --staged: reads the index, not the working tree', () => {
  const dir = newScanRepo();
  const secret = SECRET_CANARIES['github-token'][0];
  writeFileSync(join(dir, 'a.txt'), secret + '\n');
  gitIn(dir, 'add', 'a.txt');
  writeFileSync(join(dir, 'a.txt'), 'scrubbed after staging\n');
  assert.equal(scanGitMode(dir, '--staged').status, 1, 'staged secret still hits though the file on disk is clean');

  const dir2 = newScanRepo();
  writeFileSync(join(dir2, 'a.txt'), 'clean\n');
  gitIn(dir2, 'add', 'a.txt');
  writeFileSync(join(dir2, 'a.txt'), secret + '\n'); // unstaged edit: not part of this commit
  assert.equal(scanGitMode(dir2, '--staged').status, 0);
});

test('scan-dist-secrets --staged: skips a binary blob that holds a canary shape', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'b.bin'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(SECRET_CANARIES['openai-key'][0])]));
  gitIn(dir, 'add', 'b.bin');
  const res = scanGitMode(dir, '--staged');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /skipped 1 binary/);
});

test('scan-dist-secrets --staged: a vars-file value pasted into a staged file is caught by name', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, '.dev.vars'), 'MY_API_TOKEN=zz_vars_value_0123456789\n');
  writeFileSync(join(dir, 'config.js'), 'const t = "zz_vars_value_0123456789";\n');
  gitIn(dir, 'add', 'config.js');
  const res = scanGitMode(dir, '--staged');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /config\.js.*matches "MY_API_TOKEN"/);
});

test('scan-dist-secrets --staged: 200 small staged files scan in under 2 s of CPU', () => {
  const dir = newScanRepo();
  for (let i = 0; i < 200; i++) writeFileSync(join(dir, `f${i}.txt`), `file ${i}\nconst x = ${i};\n`);
  gitIn(dir, 'add', '-A');
  // CPU time, not wall (#422): `npm run verify` runs suites side by side, and on
  // a loaded machine a scan that needs a few hundred ms of CPU waits past a
  // wall bound with nothing wrong. What this guards, a git spawn per blob
  // instead of one `cat-file --batch` stream, is CPU the scan and its git
  // children burn, so it moves this bound as much as a wall one.
  const res = spawnCpuSync(process.execPath, [SCAN_SECRETS, '--staged', `--repo=${dir}`], { encoding: 'utf8', env: GIT_TEST_ENV });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /200 blob/);
  assert.ok(res.cpuMs < 2000, `--staged over 200 files used ${res.cpuMs} ms of CPU`);
});

test('scan-dist-secrets --history: finds a secret committed and then deleted, with its commit and path (positive control)', () => {
  const dir = newScanRepo();
  const secret = SECRET_CANARIES['stripe-live-key'][0];
  writeFileSync(join(dir, 'app.js'), `const k = "${secret}";\n`);
  gitIn(dir, 'add', 'app.js');
  gitIn(dir, 'commit', '-q', '-m', 'add key');
  const sha = gitIn(dir, 'rev-parse', 'HEAD').trim();
  rmSync(join(dir, 'app.js'));
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'remove key');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, new RegExp(`app\\.js \\(oldest commit ${sha.slice(0, 12)}\\) matches "stripe-live-key"`));
  assert.ok(!res.stderr.includes(secret));
});

test('scan-dist-secrets --history: finds a secret that exists only on a side branch', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'base');
  gitIn(dir, 'checkout', '-q', '-b', 'side');
  writeFileSync(join(dir, 'side.txt'), SECRET_CANARIES['aws-access-key-id'][0] + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'side');
  gitIn(dir, 'checkout', '-q', '-');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /side\.txt.*matches "aws-access-key-id"/);
});

// #431: CI judges the history the checked-out commit carries, not every branch
// the clone fetched. A fixture one open PR moves to a new path (waived only on
// that PR's branch) must not fail the scan on every other PR.
function repoWithMovedFixtureOnOtherBranch() {
  const dir = newScanRepo();
  const secret = SECRET_CANARIES['github-token'][0];
  mkdirSync(join(dir, '.house'));
  mkdirSync(join(dir, 'fixtures'));
  writeFileSync(join(dir, 'fixtures', 'old.txt'), secret + '\n');
  writeFileSync(join(dir, '.house', 'secret-allow'), 'fixtures/old.txt github-token  # planted fixture\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'base');
  gitIn(dir, 'checkout', '-q', '-b', 'other-pr');
  gitIn(dir, 'mv', 'fixtures/old.txt', 'fixtures/new.txt');
  writeFileSync(join(dir, '.house', 'secret-allow'), 'fixtures/new.txt github-token  # planted fixture, moved\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'move the fixture');
  gitIn(dir, 'checkout', '-q', '-');
  return dir;
}

test('scan-dist-secrets --history --rev=HEAD: a blob only another branch holds, at a path only that branch waives, is not judged (negative control)', () => {
  const dir = repoWithMovedFixtureOnOtherBranch();
  const all = scanGitMode(dir, '--history');
  assert.equal(all.status, 1, 'without --rev every ref is read, so the other branch fails this checkout');
  assert.match(all.stderr, /fixtures\/new\.txt.*matches "github-token"/);
  const res = scanGitMode(dir, '--history', '--rev=HEAD');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /clean — history/);
  assert.match(res.stdout, /waived fixtures\/old\.txt github-token/);
});

test('scan-dist-secrets --history --rev=HEAD: a secret reachable from HEAD still fails, even when later deleted, and a side branch merged into HEAD counts (positive control)', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'base');
  gitIn(dir, 'checkout', '-q', '-b', 'side');
  writeFileSync(join(dir, 'side.txt'), SECRET_CANARIES['aws-access-key-id'][0] + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'side');
  gitIn(dir, 'checkout', '-q', '-');
  assert.equal(scanGitMode(dir, '--history', '--rev=HEAD').status, 0, 'not merged yet, so not carried');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  writeFileSync(join(dir, 'gone.txt'), SECRET_CANARIES['stripe-live-key'][0] + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'add');
  rmSync(join(dir, 'gone.txt'));
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'remove');
  const res = scanGitMode(dir, '--history', '--rev=HEAD');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /side\.txt.*matches "aws-access-key-id"/);
  assert.match(res.stderr, /gone\.txt.*matches "stripe-live-key"/);
});

test('scan-dist-secrets --history --rev: an unknown rev or an option-shaped one is an error, and --rev needs --history', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'base');
  const unknown = scanGitMode(dir, '--history', '--rev=no-such-ref');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /ERROR/);
  const option = scanGitMode(dir, '--history', '--rev=--all');
  assert.equal(option.status, 2);
  assert.match(option.stderr, /--rev/);
  const staged = scanGitMode(dir, '--staged', '--rev=HEAD');
  assert.equal(staged.status, 2);
  assert.match(staged.stderr, /--rev/);
});

test('scan-dist-secrets --history --rev: a root file named HEAD does not make the rev ambiguous', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'HEAD'), 'not a ref\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'a file named HEAD');
  const res = scanGitMode(dir, '--history', '--rev=HEAD');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /clean — history/);
});

test('scan-dist-secrets --history --rev: an exclusion (^HEAD) or a repeated --rev is refused, never read as a clean scan of nothing', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'a.txt'), SECRET_CANARIES['github-token'][0] + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'a secret');
  const negated = scanGitMode(dir, '--history', '--rev=^HEAD');
  assert.equal(negated.status, 2, negated.stdout);
  assert.match(negated.stderr, /--rev/);
  const twice = scanGitMode(dir, '--history', '--rev=HEAD', '--rev=HEAD');
  assert.equal(twice.status, 2, twice.stdout);
  assert.match(twice.stderr, /--rev.*once/);
});

test('scan-dist-secrets --history: a clean history passes (negative control)', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'a.txt'), SECRET_NEAR_MISSES.join('\n') + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'one');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /clean — history/);
});

test('scan-dist-secrets --history: an empty repo passes, and a shallow clone is refused (fail closed)', () => {
  assert.equal(scanGitMode(newScanRepo(), '--history').status, 0);

  const src = newScanRepo();
  for (const n of ['one', 'two']) {
    writeFileSync(join(src, `${n}.txt`), n + '\n');
    gitIn(src, 'add', '-A');
    gitIn(src, 'commit', '-q', '-m', n);
  }
  const shallow = join(mktemp('house-scan-shallow-'), 'clone');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, shallow], { env: GIT_TEST_ENV });
  const res = scanGitMode(shallow, '--history');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /shallow clone/);
});

test('scan-dist-secrets: outside a repository the git modes error out rather than pass', () => {
  const dir = mktemp('house-scan-norepo-');
  for (const mode of ['--staged', '--history']) {
    const res = spawnSync(process.execPath, [SCAN_SECRETS, mode], { encoding: 'utf8', cwd: dir, env: { ...GIT_TEST_ENV, GIT_CEILING_DIRECTORIES: dirname(dir) } });
    assert.equal(res.status, 2, mode);
    assert.match(res.stderr, /ERROR/);
  }
});

test('scan-dist-secrets: .house/secret-allow waives one path and rule, not another', () => {
  const dir = newScanRepo();
  const key = SECRET_CANARIES['github-token'][0];
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'example.md'), key + '\n');
  writeFileSync(join(dir, 'src.js'), key + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'two files');

  mkdirSync(join(dir, '.house'));
  writeFileSync(join(dir, '.house', 'secret-allow'), '# docs show a fake token on purpose\ndocs/** github-token  # example in the docs\n');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /src\.js/);
  assert.ok(!res.stderr.includes('example.md'), 'the waived path is not reported');

  writeFileSync(join(dir, '.house', 'secret-allow'), 'docs/** openai-key  # wrong rule\nsrc.js github-token  # reason\n');
  const wrong = scanGitMode(dir, '--history');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /example\.md/, 'a waiver for another rule does not hide this one');
  assert.ok(!wrong.stderr.includes('src.js'));

  writeFileSync(join(dir, '.house', 'secret-allow'), 'docs/** github-token  # reason\nsrc.js github-token  # reason\n');
  assert.equal(scanGitMode(dir, '--history').status, 0);
});

test('scan-dist-secrets: a malformed allowlist line is an error, not a silent waiver', () => {
  const dir = newScanRepo();
  mkdirSync(join(dir, '.house'));
  writeFileSync(join(dir, '.house', 'secret-allow'), 'docs/**\n');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /secret-allow:1/);
  writeFileSync(join(dir, '.house', 'secret-allow'), '# ok\n*.md github-token extra\n');
  const three = scanGitMode(dir, '--history');
  assert.equal(three.status, 2);
  assert.match(three.stderr, /secret-allow:2/);
});

// ---- rework after the independent refuter (#402) ----

function commitAt(dir, msg, date) {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', msg], { env: { ...GIT_TEST_ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
}

test('scan-dist-secrets --staged: a symlink replaced by a file holding a key is scanned (type change)', () => {
  const dir = newScanRepo();
  symlinkSync('target.txt', join(dir, 'link'));
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'link');
  rmSync(join(dir, 'link'));
  writeFileSync(join(dir, 'link'), SECRET_CANARIES['github-token'][0] + '\n');
  gitIn(dir, 'add', '-A');
  const res = scanGitMode(dir, '--staged');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /link.*matches "github-token"/);
});

test('scan-dist-secrets --history: a key only in the root commit is found even with log.showRoot=false', () => {
  const dir = newScanRepo();
  gitIn(dir, 'config', 'log.showRoot', 'false');
  writeFileSync(join(dir, 'root.txt'), SECRET_CANARIES['openai-key'][0] + '\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'root');
  writeFileSync(join(dir, 'other.txt'), 'x\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'second');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /root\.txt.*matches "openai-key"/);
});

test('scan-dist-secrets --history: a blob a tag points at directly is scanned, lightweight and annotated', () => {
  for (const annotated of [false, true]) {
    const dir = newScanRepo();
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'loose.txt'), SECRET_CANARIES['google-api-key'][0] + '\n');
    const oid = gitIn(dir, 'hash-object', '-w', 'loose.txt').trim();
    rmSync(join(dir, 'loose.txt'));
    gitIn(dir, 'tag', ...(annotated ? ['-a', '-m', 'm'] : []), 'blobtag', oid);
    const res = scanGitMode(dir, '--history');
    assert.equal(res.status, 1, `annotated=${annotated}: ${res.stderr}`);
    assert.match(res.stderr, /refs\/tags\/blobtag.*matches "google-api-key"/);
  }
});

test('scan-dist-secrets --history: "oldest commit" is the earliest by commit date, not the last one listed', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'k.txt'), SECRET_CANARIES['stripe-live-key'][0] + ' one\n');
  gitIn(dir, 'add', '-A');
  commitAt(dir, 'first made, dated later', '2030-01-01T00:00:00Z');
  const later = gitIn(dir, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(dir, 'k.txt'), SECRET_CANARIES['stripe-live-key'][0] + ' two\n');
  gitIn(dir, 'add', '-A');
  commitAt(dir, 'second made, dated earlier', '2020-01-01T00:00:00Z');
  const earlier = gitIn(dir, 'rev-parse', 'HEAD').trim();
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 1);
  assert.match(res.stderr, new RegExp(`oldest commit ${earlier.slice(0, 12)}, and 1 later`));
  assert.ok(!res.stderr.includes(later.slice(0, 12)));
});

test('scan-dist-secrets: a key glued after a word character or underscore is still caught', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'env.txt'), 'GITHUB_TOKEN_' + SECRET_CANARIES['github-token'][0] + '\nfoo_' + SECRET_CANARIES['aws-access-key-id'][0] + '\n');
  gitIn(dir, 'add', '-A');
  const res = scanGitMode(dir, '--staged');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /"github-token"/);
  assert.match(res.stderr, /"aws-access-key-id"/);
});

test('scan-dist-secrets: the git modes skip plain-word and bare-number vars values and hostnames, keep the rest', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, '.dev.vars'), [
    'ENVIRONMENT=development', 'PORT_NUMBER=1234567890', 'DB_URL=postgres://user:Zz9pass_word1@localhost-db-host:5432/app', 'SECRET_THING=zz_vars_value_0123456789', '',
  ].join('\n'));
  writeFileSync(join(dir, 'ok.txt'), 'development 1234567890 localhost-db-host\n');
  gitIn(dir, 'add', 'ok.txt');
  const ok = scanGitMode(dir, '--staged');
  assert.equal(ok.status, 0, ok.stderr);

  writeFileSync(join(dir, 'pw.txt'), 'Zz9pass_word1\n');
  gitIn(dir, 'add', 'pw.txt');
  const pw = scanGitMode(dir, '--staged');
  assert.equal(pw.status, 1);
  assert.match(pw.stderr, /pw\.txt.*matches "DB_URL:password"/);
});

test('scan-dist-secrets: a key after URL-encoding or a literal \\n, \\r or \\t escape is still caught', () => {
  const key = SECRET_CANARIES['github-token'][0];
  for (const lead of ['token%3D', 'a%0A', 'line\\n', 'line\\r', 'line\\t']) {
    const dir = newScanRepo();
    writeFileSync(join(dir, 'blob.txt'), lead + key + '\n');
    gitIn(dir, 'add', '-A');
    const res = scanGitMode(dir, '--staged');
    assert.equal(res.status, 1, `lead ${lead}: ${res.stderr}`);
    assert.match(res.stderr, /"github-token"/);
  }
  const dir = newScanRepo(); // negative control: a plain letter before the prefix is still a longer word
  writeFileSync(join(dir, 'blob.txt'), 'xyz' + key + ' and 3D' + key + '\n');
  gitIn(dir, 'add', '-A');
  assert.equal(scanGitMode(dir, '--staged').status, 0);
});

test('scan-dist-secrets: the git modes skip a URL with no password and a lowercase-words value, keep a URL password', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, '.dev.vars'), [
    'API=http://localhost:8787', 'REGION=production-us', 'MODE=very_long_mode_name', 'DB=postgres://u:Qq7password_x9@dbhost.internal/app', '',
  ].join('\n'));
  writeFileSync(join(dir, 'README.md'), 'Run at http://localhost:8787 in production-us with very_long_mode_name\n');
  gitIn(dir, 'add', 'README.md');
  const ok = scanGitMode(dir, '--staged');
  assert.equal(ok.status, 0, ok.stderr);

  writeFileSync(join(dir, 'conn.txt'), 'Qq7password_x9\n');
  gitIn(dir, 'add', 'conn.txt');
  const pw = scanGitMode(dir, '--staged');
  assert.equal(pw.status, 1);
  assert.match(pw.stderr, /conn\.txt.*matches "DB:password"/);
});

test('scan-dist-secrets: an allowlist line with no reason is an error naming the line', () => {
  const dir = newScanRepo();
  mkdirSync(join(dir, '.house'));
  writeFileSync(join(dir, '.house', 'secret-allow'), '# header\ndocs/** github-token\n');
  const res = scanGitMode(dir, '--history');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /secret-allow:2.*reason/);
});

test('scan-dist-secrets: each applied waiver prints its path, rule and reason', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'fixture.md'), SECRET_CANARIES['github-token'][0] + '\n');
  mkdirSync(join(dir, '.house'));
  writeFileSync(join(dir, '.house', 'secret-allow'), 'fixture.md github-token  # documented fake\n');
  gitIn(dir, 'add', '-A');
  const res = scanGitMode(dir, '--staged');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /waived fixture\.md github-token: documented fake/);
});

test('scan-dist-secrets --staged: reads the allowlist from the index, so an unstaged waiver waives nothing', () => {
  const dir = newScanRepo();
  writeFileSync(join(dir, 'fixture.md'), SECRET_CANARIES['github-token'][0] + '\n');
  gitIn(dir, 'add', 'fixture.md');
  mkdirSync(join(dir, '.house'));
  writeFileSync(join(dir, '.house', 'secret-allow'), 'fixture.md github-token  # local only\n');
  assert.equal(scanGitMode(dir, '--staged').status, 1, 'working-tree-only waiver is ignored');
  gitIn(dir, 'add', '.house/secret-allow');
  assert.equal(scanGitMode(dir, '--staged').status, 0, 'once staged it applies');
});

test('scan-dist-secrets: a pattern hit is named pattern#N or by its object name, never by its value (all modes)', () => {
  const dir = mktemp('house-scan-pat-');
  mkdirSync(join(dir, 'dist'));
  const plain = 'zz_plain_pattern_value_111';
  const named = 'zz_named_pattern_value_222';
  const fromEnv = 'zz_env_pattern_value_333';
  writeFileSync(join(dir, 'dist', 'a.html'), `${plain} ${named} ${fromEnv}`);
  writeFileSync(join(dir, 'patterns.json'), JSON.stringify([plain, { name: 'MY_NAMED', value: named }]));
  const res = spawnSync(process.execPath, [SCAN_SECRETS, `--dist-dir=${join(dir, 'dist')}`, `--vars-file=${join(dir, 'none')}`,
    `--patterns=${join(dir, 'patterns.json')}`], { encoding: 'utf8', env: { ...process.env, SCAN_DIST_SECRETS_PATTERNS: fromEnv } });
  assert.equal(res.status, 1);
  for (const v of [plain, named, fromEnv]) assert.ok(!res.stderr.includes(v) && !res.stdout.includes(v), 'value leaked');
  assert.match(res.stderr, /marker "pattern#0"/);

  const repo = newScanRepo();
  writeFileSync(join(repo, 'f.txt'), `${named} ${fromEnv}\n`);
  gitIn(repo, 'add', '-A');
  const staged = spawnSync(process.execPath, [SCAN_SECRETS, '--staged', `--repo=${repo}`, `--patterns=${join(dir, 'patterns.json')}`],
    { encoding: 'utf8', env: { ...GIT_TEST_ENV, SCAN_DIST_SECRETS_PATTERNS: fromEnv } });
  assert.equal(staged.status, 1);
  assert.match(staged.stderr, /"MY_NAMED"/);
  assert.match(staged.stderr, /"pattern#2"/);
  for (const v of [plain, named, fromEnv]) assert.ok(!staged.stderr.includes(v), 'value leaked');
});

test('scan-dist-secrets: dist mode is unchanged by the git modes (sk-ant- literal still trips)', () => {
  const dir = mktemp('house-scan-dist-');
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'a.html'), 'sk-' + 'ant-' + 'short');
  const res = spawnSync(process.execPath, [SCAN_SECRETS, `--dist-dir=${join(dir, 'dist')}`, `--vars-file=${join(dir, 'none')}`], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /marker "sk-ant-"/);
});

// ---------------------------------------------------------------------------
// templates/pre-commit.d/25-secret-content and the pr-checks step (#402)
// ---------------------------------------------------------------------------

const SECRET_CONTENT_HOOK = join(ROOT, 'plugins/house/templates/pre-commit.d/25-secret-content');
const PR_CHECKS_TEMPLATE = join(ROOT, 'plugins/house/templates/pr-checks.yml');

function hookRepo({ withScanner }) {
  const dir = newScanRepo();
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  copyFileSync(SECRET_CONTENT_HOOK, join(dir, '.git', 'hooks', 'pre-commit'));
  execFileSync('chmod', ['755', join(dir, '.git', 'hooks', 'pre-commit')]);
  if (withScanner) {
    mkdirSync(join(dir, 'scripts', 'house'), { recursive: true });
    copyFileSync(SCAN_SECRETS, join(dir, 'scripts', 'house', 'scan-dist-secrets.mjs'));
  }
  return dir;
}

// core.hooksPath=/dev/null in gitIn would disable the hook under test.
function commitWithHook(dir, env = GIT_TEST_ENV) {
  return spawnSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', 'm'], { encoding: 'utf8', env });
}

test('25-secret-content: refuses a commit whose staged content holds a key (positive control)', () => {
  const dir = hookRepo({ withScanner: true });
  writeFileSync(join(dir, 'notes.txt'), SECRET_CANARIES['anthropic-key'][0] + '\n');
  gitIn(dir, 'add', 'notes.txt');
  const res = commitWithHook(dir);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /notes\.txt.*anthropic-key/);
});

test('25-secret-content: an ordinary commit passes (negative control)', () => {
  const dir = hookRepo({ withScanner: true });
  writeFileSync(join(dir, 'notes.txt'), 'nothing here\n');
  gitIn(dir, 'add', 'notes.txt');
  assert.equal(commitWithHook(dir).status, 0);
});

test('25-secret-content: a missing scanner warns and lets the commit through, since CI is the gate', () => {
  const dir = hookRepo({ withScanner: false });
  writeFileSync(join(dir, 'notes.txt'), SECRET_CANARIES['anthropic-key'][0] + '\n');
  gitIn(dir, 'add', 'notes.txt');
  const res = commitWithHook(dir);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /was not scanned/);
});

test('25-secret-content: a missing node warns and lets the commit through', () => {
  const dir = hookRepo({ withScanner: true });
  writeFileSync(join(dir, 'notes.txt'), SECRET_CANARIES['anthropic-key'][0] + '\n');
  gitIn(dir, 'add', 'notes.txt');
  // A PATH holding only git and the shell tools the hook needs, no node.
  const bin = mktemp('house-scan-bin-');
  for (const tool of ['git', 'bash', 'env', 'dirname', 'cat']) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (found) execFileSync('ln', ['-s', found, join(bin, tool)]);
  }
  const res = commitWithHook(dir, { ...GIT_TEST_ENV, PATH: bin });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /node not found/);
});

test('pr-checks template: a secret-scan job checks out full history and runs the scanner over HEAD\'s history only', () => {
  const yml = readFileSync(PR_CHECKS_TEMPLATE, 'utf8');
  const job = yml.slice(yml.indexOf('  secret-scan:'));
  assert.match(job, /fetch-depth: 0/);
  assert.match(job, /run: node scripts\/house\/scan-dist-secrets\.mjs --history --rev=HEAD\n/);
  assert.match(job, /actions\/checkout@[0-9a-f]{40}/);
});

// ===========================================================================
// github/arm-git-hooks.sh (ADR 0019)
// ===========================================================================

const ARM_VENDORED = join(ROOT, 'plugins/house/modules/github/files/arm-git-hooks.sh');
const ARM_PLUGIN = join(ROOT, 'plugins/house/hooks/arm-git-hooks.sh');

test('arm-git-hooks.sh: the github module copy is byte-identical to the plugin hook and executable, so one script arms the floor everywhere', () => {
  assert.equal(readFileSync(ARM_VENDORED, 'utf8'), readFileSync(ARM_PLUGIN, 'utf8'), 'the two copies differ: copy plugins/house/hooks/arm-git-hooks.sh over the module copy');
  assert.ok(statSync(ARM_VENDORED).mode & 0o100, 'the module copy lost its execute bit');
});

test('arm-git-hooks.sh: run from scripts/house/, the not-rendered hint names `house render --apply`, not a CLI path that does not exist there', () => {
  const repo = mktemp('house-arm-vendored-');
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'house.json'), `${JSON.stringify({ branchPolicy: 'pr', modules: { github: { enabled: true } } })}\n`);
  mkdirSync(join(repo, 'scripts', 'house'), { recursive: true });
  copyFileSync(ARM_VENDORED, join(repo, 'scripts', 'house', 'arm-git-hooks.sh'));
  const res = spawnSync('bash', [join(repo, 'scripts', 'house', 'arm-git-hooks.sh'), '--repo', repo], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /git-hook floor not rendered here \(missing: .*; run: house render --apply\)/);
  // From the plugin, the hint still names the plugin's own CLI.
  const fromPlugin = spawnSync('bash', [ARM_PLUGIN, '--repo', repo], { encoding: 'utf8' });
  assert.match(fromPlugin.stdout, /run: node \S+\/plugins\/house\/scripts\/house render --apply\)/);
});

// ===========================================================================
// github/cleanup-worktree.sh
// ===========================================================================

test('cleanup-worktree.sh: bash -n syntax check', () => {
  const res = spawnSync('bash', ['-n', CLEANUP_SH], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('cleanup-worktree.sh: shellcheck, if available (informational when not installed)', (t) => {
  if (spawnSync('sh', ['-c', 'command -v shellcheck']).status !== 0) {
    t.skip('shellcheck not installed here, so cleanup-worktree.sh is not linted; it runs on CI, whose ubuntu runners ship shellcheck');
    return;
  }
  const res = spawnSync('shellcheck', [CLEANUP_SH], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

// #115: the remote delete can be refused by the harness's classifier, and the
// setting that makes the step unnecessary is the owner's. Both are reported in
// words the user can act on; the network calls themselves are not exercised
// here (no gh, no remote), so this pins the text the script prints.
test('cleanup-worktree.sh: reports head-branch deletion off and hands a refused remote delete to the user', () => {
  const src = readFileSync(CLEANUP_SH, 'utf8');
  assert.match(src, /deleteBranchOnMerge/);
  assert.match(src, /automatic head-branch deletion OFF/);
  assert.match(src, /gh repo edit \$REPO --delete-branch-on-merge/);
  assert.match(src, /run this yourself/);
  assert.match(src, /gh api -X DELETE repos\/\$REPO\/git\/refs\/heads\/\$BRANCH"$/m);
});

// #252: `gh pr merge --delete-branch` already removed the remote branch, so the
// script must say "already deleted" and not hand over a manual command. A fake
// `gh` on PATH stands in for the API; a local bare repo is the real origin.
function runCleanupWithFakeGh({ pushBranch, ghDeletes }) {
  const { base, work, origin } = makeRepoWithOrigin('main');
  const wt = join(base, 'wt');
  execFileSync('git', ['-C', work, 'worktree', 'add', '-q', '-b', 'feat/x', wt]);
  if (pushBranch) execFileSync('git', ['-C', work, 'push', '-q', 'origin', 'feat/x']);
  const bin = join(base, 'bin');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  writeFileSync(gh, [
    '#!/usr/bin/env bash',
    'case "$*" in',
    '  "repo view --json nameWithOwner"*) echo o/r ;;',
    '  "repo view --json deleteBranchOnMerge"*) echo true ;;',
    `  "api -X DELETE"*) ${ghDeletes ? `git -C "${origin}" branch -D feat/x >/dev/null` : 'echo "gh: Forbidden (HTTP 403)" >&2; exit 1'} ;;`,
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
  return spawnSync('bash', [CLEANUP_SH, wt], {
    encoding: 'utf8',
    cwd: work,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

test('cleanup-worktree.sh: a remote branch the merge already deleted is reported gone, with no manual command', () => {
  const res = runCleanupWithFakeGh({ pushBranch: false, ghDeletes: false });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /remote branch already deleted/);
  assert.doesNotMatch(res.stdout, /run this yourself|not deleted/);
});

test('cleanup-worktree.sh: a present remote branch is deleted through gh', () => {
  const res = runCleanupWithFakeGh({ pushBranch: true, ghDeletes: true });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /remote branch deleted/);
  assert.doesNotMatch(res.stdout, /run this yourself/);
});

test('cleanup-worktree.sh: a present remote branch that gh refuses to delete prints the manual command', () => {
  const res = runCleanupWithFakeGh({ pushBranch: true, ghDeletes: false });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /not deleted: the call was refused/);
  assert.match(res.stdout, /run this yourself/);
});

test('cleanup-worktree.sh: refuses to operate on the current (main) checkout', () => {
  const { work } = makeRepoWithOrigin('main');
  const res = spawnSync('bash', [CLEANUP_SH, work], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /refusing to clean up the main worktree/);
});

test('cleanup-worktree.sh: refuses when the checkout is not on the (configured) default branch', () => {
  const { work } = makeRepoWithOrigin('main');
  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const other = mktemp('house-not-a-worktree-');
  const res = spawnSync('bash', [CLEANUP_SH, other], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /must run from the main checkout on main/);
});

test('cleanup-worktree.sh: refuses a path that is not a registered worktree of the repo', () => {
  const { work } = makeRepoWithOrigin('main');
  const other = mktemp('house-not-a-worktree-');
  const res = spawnSync('bash', [CLEANUP_SH, other], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /is not a registered worktree/);
});

test('cleanup-worktree.sh: honors house.json defaultBranch for the preflight, not a hardcoded "master"', (t) => {
  const { work } = makeRepoWithOrigin('release');
  writeFileSync(join(work, 'house.json'), JSON.stringify({ defaultBranch: 'release' }));
  execFileSync('git', ['-C', work, 'add', 'house.json']);
  execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'add house.json']);

  if (spawnSync('sh', ['-c', 'command -v jq']).status !== 0) {
    t.skip('jq not installed here, so the house.json-driven branch resolution check does not run; it runs on CI, whose ubuntu runners ship jq');
    return;
  }

  execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);
  const other = mktemp('house-not-a-worktree-');
  const res = spawnSync('bash', [CLEANUP_SH, other], { encoding: 'utf8', cwd: work });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /must run from the release checkout on release/);
});

// resolve_kill_list is defined before the script's teardown body and the
// script returns early when sourced (BASH_SOURCE[0] != $0), so a test can
// source it and call the function directly without triggering the teardown.
function sourceAndResolveKillList(cwd, env, bashBin) {
  // spawnSync resolves the executable itself against `env.PATH` when `env`
  // is overridden, so a test that strips PATH down to a single directory
  // must give the bash binary's absolute path rather than the bare name.
  return spawnSync(bashBin || 'bash', ['-c', `source "${CLEANUP_SH}"; resolve_kill_list`], {
    encoding: 'utf8',
    cwd,
    env: env || process.env,
  });
}

test('cleanup-worktree.sh: resolve_kill_list defaults to node and npm without a worktreeKillProcesses slot', () => {
  const { work } = makeRepoWithOrigin('main');
  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
});

test('cleanup-worktree.sh: resolve_kill_list honors house.json worktreeKillProcesses slot', (t) => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: ['deno', 'vite'] } } },
  }));

  if (spawnSync('sh', ['-c', 'command -v jq']).status !== 0) {
    t.skip('jq not installed here, so the house.json-driven kill-list resolution check does not run; it runs on CI, whose ubuntu runners ship jq');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'deno\nvite\n');
});

test('cleanup-worktree.sh: resolve_kill_list falls back to the default without jq on PATH', () => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: ['deno', 'vite'] } } },
  }));

  // A PATH containing only git (via a symlink), so `command -v jq` fails
  // inside the script the same way it would on a machine without jq
  // installed, while `git rev-parse --show-toplevel` still resolves.
  const gitPath = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const binDir = mktemp('house-nobin-');
  execFileSync('ln', ['-s', gitPath, join(binDir, 'git')]);

  const res = sourceAndResolveKillList(work, { ...process.env, PATH: binDir }, '/bin/bash');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
});

test('cleanup-worktree.sh: resolve_kill_list falls back to the default and warns when the slot is not an array', (t) => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: { not: 'an array' } } } },
  }));

  if (spawnSync('sh', ['-c', 'command -v jq']).status !== 0) {
    t.skip('jq not installed here, so the non-array kill-list resolution check does not run; it runs on CI, whose ubuntu runners ship jq');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
  assert.match(res.stderr, /worktreeKillProcesses/);
});

test('cleanup-worktree.sh: resolve_kill_list honors an explicit empty array as "kill nothing"', (t) => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: [] } } },
  }));

  if (spawnSync('sh', ['-c', 'command -v jq']).status !== 0) {
    t.skip('jq not installed here, so the empty-array kill-list resolution check does not run; it runs on CI, whose ubuntu runners ship jq');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  // Empty output, not the default: an explicit [] is not overridden, and
  // the scan loop's read-loop then has nothing to match, so the kill step
  // is a no-op.
  assert.equal(res.stdout, '');
});

test('cleanup-worktree.sh: resolve_kill_list keeps only the string entries of a mixed-type array', (t) => {
  const { work } = makeRepoWithOrigin('main');
  writeFileSync(join(work, 'house.json'), JSON.stringify({
    modules: { github: { config: { worktreeKillProcesses: ['node', 123, 'npm', false] } } },
  }));

  if (spawnSync('sh', ['-c', 'command -v jq']).status !== 0) {
    t.skip('jq not installed here, so the mixed-type kill-list resolution check does not run; it runs on CI, whose ubuntu runners ship jq');
    return;
  }

  const res = sourceAndResolveKillList(work);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'node\nnpm\n');
});
