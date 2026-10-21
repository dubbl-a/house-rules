// Tests for scripts/release-latest.mjs: the CLI end to end, piping the
// releases API JSON on stdin with the candidate version as an argument, since
// the release workflow runs it that way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'release-latest.mjs');

function decide(version, input) {
  const r = spawnSync('node', [SCRIPT, version], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}

const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });
const list = (...tags) => JSON.stringify(tags.map((t) => (typeof t === 'string' ? rel(t) : t)));

test('no existing releases is latest', () => {
  assert.deepEqual(decide('0.1.0', '[]'), { code: 0, out: 'true' });
});

test('a version above every release is latest', () => {
  assert.equal(decide('0.22.5', list('v0.22.4', 'v0.22.3')).out, 'true');
});

test('an older version after a newer one is not latest', () => {
  assert.equal(decide('0.22.3', list('v0.22.4', 'v0.22.2')).out, 'false');
});

test('a version equal to the highest is latest', () => {
  assert.equal(decide('0.22.4', list('v0.22.4', 'v0.22.3')).out, 'true');
});

test('ordering is numeric, not lexical', () => {
  assert.equal(decide('0.22.9', list('v0.22.10')).out, 'false');
  assert.equal(decide('0.22.10', list('v0.22.9')).out, 'true');
  assert.equal(decide('1.0.0', list('v0.99.99')).out, 'true');
});

test('release order in the list does not matter', () => {
  assert.equal(decide('0.5.0', list('v0.4.0', 'v0.6.0', 'v0.5.5')).out, 'false');
});

test('drafts are ignored', () => {
  assert.equal(decide('0.22.4', list('v0.22.3', rel('v0.23.0', { draft: true }))).out, 'true');
});

test('prereleases are ignored', () => {
  assert.equal(decide('0.22.4', list('v0.22.3', rel('v0.23.0', { prerelease: true }))).out, 'true');
});

test('tags that are not plain vX.Y.Z are ignored', () => {
  const tags = ['v0.30.0-rc.1', '1.0.0', 'v1.0', 'nightly', 'v2.0.0+build', 'v0.22.3'];
  assert.equal(decide('0.22.4', list(...tags)).out, 'true');
  assert.equal(decide('0.22.2', list(...tags)).out, 'false');
});

test('a release with no tag_name is ignored', () => {
  assert.equal(decide('0.22.4', JSON.stringify([{ draft: false, prerelease: false }, rel('v0.22.3')])).out, 'true');
});

test('paginated input (an array of page arrays) is flattened', () => {
  const pages = JSON.stringify([[rel('v0.22.4')], [rel('v0.22.3')], []]);
  assert.equal(decide('0.22.3', pages).out, 'false');
  assert.equal(decide('0.22.5', pages).out, 'true');
});

test('a newer release on a later page still counts', () => {
  const pages = JSON.stringify([[rel('v0.1.0')], [rel('v0.9.0')]]);
  assert.equal(decide('0.5.0', pages).out, 'false');
});

test('malformed JSON exits non-zero with no verdict', () => {
  const r = decide('0.22.4', '{not json');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('empty stdin exits non-zero', () => {
  const r = decide('0.22.4', '');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('an API error object exits non-zero', () => {
  const r = decide('0.22.4', '{"message":"Not Found"}');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('a list holding a non-object exits non-zero', () => {
  const r = decide('0.22.4', '[null]');
  assert.notEqual(r.code, 0);
  assert.equal(r.out, '');
});

test('a candidate that is not plain X.Y.Z exits non-zero', () => {
  for (const v of ['', 'v0.22.4', '0.22', '0.22.4-rc.1', 'latest']) {
    const r = decide(v, '[]');
    assert.notEqual(r.code, 0, `version ${JSON.stringify(v)}`);
    assert.equal(r.out, '');
  }
});

test('a missing version argument exits non-zero', () => {
  const r = spawnSync('node', [SCRIPT], { input: '[]', encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});
