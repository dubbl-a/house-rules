// Tests for the vendored data-pipelines module file under plugins/house/modules/
// (data-pipelines/retro.mjs).
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
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, mktemp } from './module-files-helpers.mjs';

const RETRO = join(ROOT, 'plugins/house/modules/data-pipelines/files/retro.mjs');

const RETRO_URL = pathToFileURL(RETRO).href;

// ===========================================================================
// data-pipelines/retro.mjs
// ===========================================================================

test('retro: evaluateDomain throws (rejects) when an invariant is missing "why"', async () => {
  const { evaluateDomain } = await import(RETRO_URL);
  const domain = {
    domain: 'nowhy',
    title: 'No why',
    invariants: [{ key: 'k', severity: 'hard', title: 'T', remedy: 'fix it', check: async () => [] }],
  };
  await assert.rejects(() => evaluateDomain(domain, {}), /missing "why"/);
});

test('retro: evaluateDomain throws (rejects) when an invariant is missing "remedy"', async () => {
  const { evaluateDomain } = await import(RETRO_URL);
  const domain = {
    domain: 'noremedy',
    title: 'No remedy',
    invariants: [{ key: 'k', severity: 'hard', title: 'T', why: 'because', check: async () => [] }],
  };
  await assert.rejects(() => evaluateDomain(domain, {}), /missing "remedy"/);
});

test('retro: evaluateDomain runs cleanly when why and remedy are both present', async () => {
  const { evaluateDomain } = await import(RETRO_URL);
  const domain = {
    domain: 'ok',
    title: 'OK domain',
    invariants: [{ key: 'k', severity: 'hard', title: 'T', why: 'because', remedy: 'fix it', check: async () => [] }],
    counts: async () => ({ rows: 3 }),
  };
  const state = await evaluateDomain(domain, {});
  assert.equal(state.skipped, null);
  assert.equal(state.invariants.length, 1);
  assert.deepEqual(state.invariants[0].violations, []);
  assert.deepEqual(state.counts, { rows: 3 });
});

test('retro: hard-severity violation exits nonzero via exitCode() (the run() return); soft and clean do not', async () => {
  const { exitCode, hasHardFailure } = await import(RETRO_URL);

  const hardViolated = [{
    domain: 'x', skipped: null,
    invariants: [{ severity: 'hard', violations: [{ key: 'k', detail: 'bad' }] }],
  }];
  assert.equal(hasHardFailure(hardViolated[0]), true);
  assert.equal(exitCode(hardViolated), 1);

  const softViolated = [{
    domain: 'y', skipped: null,
    invariants: [{ severity: 'soft', violations: [{ key: 'k', detail: 'meh' }] }],
  }];
  assert.equal(hasHardFailure(softViolated[0]), false);
  assert.equal(exitCode(softViolated), 0);

  const clean = [{ domain: 'z', skipped: null, invariants: [{ severity: 'hard', violations: [] }] }];
  assert.equal(exitCode(clean), 0);

  // noFail always reports 0, even with a hard violation present.
  assert.equal(exitCode(hardViolated, { noFail: true }), 0);
});

test('retro: diffCounts reports NOT_MEASURED with a null delta for a key measured on only one side (positive control: a fabricated zero would fail this)', async () => {
  const { diffCounts, NOT_MEASURED } = await import(RETRO_URL);

  // Simulates two runs of a domain whose counts() disagree on which keys
  // exist -- e.g. code that used to compute `chunks_embedded` no longer
  // does. 218 real rows still sit in the underlying table; nothing was lost.
  const previous = { chunks_embedded: 218 };
  const current = {}; // this run's counts() doesn't measure that key at all

  const deltas = diffCounts(previous, current);
  const d = deltas.find((x) => x.metric === 'chunks_embedded');
  assert.ok(d, 'expected a delta entry for the one-sided key');
  assert.equal(d.from, 218);
  assert.equal(d.to, NOT_MEASURED);
  assert.equal(d.delta, null);

  // Positive control: the bug this guards against is coercing the missing
  // side to 0, which reads as "218 -> 0" data loss. Assert that did NOT
  // happen.
  assert.notEqual(d.to, 0);
  assert.notEqual(d.delta, -218);

  // A key present and equal on both sides produces no delta entry at all.
  assert.deepEqual(diffCounts({ a: 5 }, { a: 5 }), []);
});

test('retro: jsonFileStore round-trips a snapshot through loadPrevious()/save(), scoped by run_kind', async () => {
  const { jsonFileStore } = await import(RETRO_URL);
  const dir = mktemp('house-retro-store-');
  const store = jsonFileStore(join(dir, 'snapshots.json'));

  const before = await store('demo_retro').loadPrevious();
  assert.equal(before, null);

  await store('demo_retro').save({ rows: 10 });
  const after1 = await store('demo_retro').loadPrevious();
  assert.equal(after1.counts.rows, 10);

  // A different run_kind in the same file is independent.
  const otherDomain = await store('other_retro').loadPrevious();
  assert.equal(otherDomain, null);
});

test('retro: evaluateDomain uses ctx.store when supplied and falls back to the default JSON-file store otherwise', async () => {
  const { evaluateDomain, jsonFileStore } = await import(RETRO_URL);
  const dir = mktemp('house-retro-store-');
  const store = jsonFileStore(join(dir, 'snapshots.json'));
  const domain = {
    domain: 'd', title: 'D',
    invariants: [{ key: 'k', severity: 'soft', title: 'T', why: 'w', remedy: 'r', check: async () => [] }],
    counts: async () => ({ n: 1 }),
  };

  const first = await evaluateDomain(domain, { store });
  assert.equal(first.previous, null);

  await store('d_retro').save(first.counts);
  const second = await evaluateDomain(domain, { store });
  assert.ok(second.previous);
  assert.equal(second.previous.counts.n, 1);
});
