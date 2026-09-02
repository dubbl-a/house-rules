/**
 * scripts/house/retro.mjs
 *
 * The shared retro harness. Every pipeline ends with one; this module is the
 * part they all share, so a new domain supplies checks rather than plumbing.
 *
 * A retro answers three questions about a run, in descending order of how
 * loudly it should interrupt you:
 *
 *   1. INVARIANTS — is the state this pipeline owns still coherent? These
 *      exist because a violated invariant does not announce itself where it
 *      is created. One project's first invariant (two records sharing an
 *      identity that should have been unique) surfaced as an unrecognizable
 *      `ON CONFLICT DO UPDATE command cannot affect row a second time` inside
 *      a *different* system's sync, two hops downstream of where it was
 *      actually introduced. A `hard` violation exits non-zero so the bad
 *      state cannot flow on to whatever reads this domain's output next.
 *
 *   2. DELTAS — what changed since the previous run of this domain, from a
 *      snapshot. Persistence is pluggable (see "snapshot store" below) so a
 *      project can keep snapshots in a JSON file, a database, wherever it
 *      already keeps this kind of state.
 *
 *   3. PROPOSALS — deliberately not part of this shared module. A domain
 *      that has labeled data to learn from (e.g. an entity-resolution
 *      scorer with reviewed decisions) can compute its own proposed-update
 *      section and fold it into `counts` or print it separately; the harness
 *      only owns invariants + deltas because those two generalize across
 *      any pipeline, while "proposals" logic is inherently domain-specific.
 *
 * A domain module exports:
 *   {
 *     domain:      'match',                    // becomes the snapshot key `${domain}_retro`
 *     title:       'Entity resolution',
 *     invariants:  [{ key, severity, title, why, remedy, check(ctx) }],
 *     counts:      async (ctx) => ({ ... }),   // flat or one-level-nested
 *     skip?:       async (ctx) => string|null, // reason to skip, e.g. no creds
 *   }
 *
 * `check(ctx)` returns an array of violations, each `{ key, detail }`. An
 * empty array is a pass. `ctx` is entirely caller-supplied — this module
 * never constructs it, never wires a domain list, and never owns a database
 * client. A caller's `ctx` typically carries whatever each `check`/`counts`
 * function needs (a DB client, a filesystem root, an API client, ...) plus,
 * optionally, `ctx.store` (see below).
 *
 * REQUIRED: `why` and `remedy` on every invariant. `evaluateDomain` throws
 * synchronously (rejects, since it's async) if either is missing on any
 * invariant, before running a single `check()`. This is enforced, not just
 * documented, because the person reading a FAILED invariant at 11pm should
 * never have to go reconstruct why it matters or how to fix it — and a
 * domain author who forgets one should find out at the next run, not the
 * next incident.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function pct(n, d) { return d ? `${Math.round((n / d) * 100)}%` : 'n/a'; }

// --- snapshot store --------------------------------------------------------
//
// Pluggable persistence. `ctx.store` is a function `(runKind) => store`
// where `store` is `{ loadPrevious(), save(counts) }` — both scoped to that
// one run_kind, so `evaluateDomain`/`recordSnapshot` never have to know how
// or where snapshots live. When `ctx.store` is omitted, everything falls
// back to `jsonFileStore()`, which keeps every domain's latest snapshot in
// one JSON file (default `.house/retro-snapshots.json`), keyed by run_kind.

const DEFAULT_SNAPSHOT_PATH = '.house/retro-snapshots.json';

function readSnapshotFile(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    // Unreadable or corrupt file: treat as empty rather than crash a retro
    // run over a snapshot cache. The next successful save rewrites it.
    return {};
  }
}

function writeSnapshotFile(filePath, all) {
  const dir = dirname(filePath);
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(all, null, 2)}\n`);
}

/**
 * jsonFileStore(filePath) — the default snapshot store. Returns a function
 * `(runKind) => { loadPrevious(), save(counts) }` suitable for `ctx.store`.
 */
export function jsonFileStore(filePath = DEFAULT_SNAPSHOT_PATH) {
  return function forRunKind(runKind) {
    return {
      async loadPrevious() {
        const all = readSnapshotFile(filePath);
        const entry = all[runKind];
        return entry ? { ranAt: entry.ranAt, counts: entry.counts } : null;
      },
      async save(counts) {
        const all = readSnapshotFile(filePath);
        all[runKind] = { ranAt: new Date().toISOString(), counts };
        writeSnapshotFile(filePath, all);
      },
    };
  };
}

const DEFAULT_STORE = jsonFileStore();

// --- invariant validation ---------------------------------------------------

function assertInvariantShape(domain, inv) {
  if (!inv || typeof inv !== 'object') {
    throw new Error(`retro: domain "${domain}" has a non-object invariant`);
  }
  if (!inv.key) {
    throw new Error(`retro: domain "${domain}" has an invariant with no "key"`);
  }
  if (!inv.why) {
    throw new Error(
      `retro: domain "${domain}" invariant "${inv.key}" is missing "why" -- ` +
      `required so a failure at run time doesn't force the reader to ` +
      `reconstruct why the invariant exists.`,
    );
  }
  if (!inv.remedy) {
    throw new Error(
      `retro: domain "${domain}" invariant "${inv.key}" is missing "remedy" -- ` +
      `required so a failure at run time doesn't force the reader to ` +
      `reconstruct how to fix it.`,
    );
  }
  if (typeof inv.check !== 'function') {
    throw new Error(`retro: domain "${domain}" invariant "${inv.key}" has no check() function`);
  }
}

// --- diff --------------------------------------------------------------

export const NOT_MEASURED = '(not measured)';

export function diffCounts(prev, cur) {
  const out = [];
  const walk = (a, b, path) => {
    for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const av = (a || {})[key];
      const bv = (b || {})[key];
      if (typeof bv === 'object' && bv !== null) { walk(av || {}, bv, `${path}${key}.`); continue; }
      // A key present on one side and ABSENT on the other is a change in
      // what the code measures, not a change in the world. Coercing the
      // missing side to 0 has produced a false "N -> 0" data-loss report
      // when two branches/versions of a domain's counts() disagreed on
      // which keys exist, while the snapshot store was shared: it reads
      // exactly like data loss. Say "not measured" and leave delta null
      // rather than invent a number that nothing can act on.
      if (av === undefined || bv === undefined) {
        if (av === bv) continue;
        out.push({
          metric: `${path}${key}`,
          from: av === undefined ? NOT_MEASURED : av,
          to: bv === undefined ? NOT_MEASURED : bv,
          delta: null,
        });
        continue;
      }
      const from = av ?? 0;
      const to = bv ?? 0;
      if (from !== to) out.push({ metric: `${path}${key}`, from, to, delta: to - from });
    }
  };
  walk(prev, cur, '');
  return out;
}

// --- execution -----------------------------------------------------------

export async function evaluateDomain(mod, ctx = {}) {
  for (const inv of mod.invariants ?? []) assertInvariantShape(mod.domain, inv);

  const skip = mod.skip ? await mod.skip(ctx) : null;
  if (skip) return { domain: mod.domain, title: mod.title, skipped: skip };

  const invariants = [];
  for (const inv of mod.invariants ?? []) {
    invariants.push({ ...inv, violations: await inv.check(ctx) });
  }

  const counts = mod.counts ? await mod.counts(ctx) : {};
  const store = (ctx.store ?? DEFAULT_STORE)(`${mod.domain}_retro`);
  const previous = await store.loadPrevious();
  const deltas = previous ? diffCounts(previous.counts, counts) : [];

  return { domain: mod.domain, title: mod.title, skipped: null, invariants, counts, previous, deltas };
}

export async function recordSnapshot(ctx, state) {
  if (state.skipped) return;
  const store = (ctx.store ?? DEFAULT_STORE)(`${state.domain}_retro`);
  await store.save(state.counts);
}

export function hasHardFailure(state) {
  if (state.skipped) return false;
  return state.invariants.some((i) => i.severity === 'hard' && i.violations.length);
}

/**
 * exitCode(states, opts) — the process exit code a CLI driving one or more
 * domains through this harness should return: 1 if any evaluated domain has
 * a hard-severity violation, 0 otherwise. `noFail: true` (a "report only,
 * don't gate" flag) always returns 0.
 */
export function exitCode(states, { noFail = false } = {}) {
  if (noFail) return 0;
  return states.some(hasHardFailure) ? 1 : 0;
}

// --- report --------------------------------------------------------------

const DEFAULT_REPORTS_DIR = '.house/retro-reports';

export function writeReport(states, runStartedAt, opts = {}) {
  const label = opts.label ?? 'retro';
  const reportsDir = resolve(opts.reportsDir ?? DEFAULT_REPORTS_DIR);
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const ts = runStartedAt.toISOString().replace(/[:.]/g, '-');
  const out = resolve(reportsDir, `${label}-${ts}.md`);
  const L = [];
  L.push(`# Pipeline retro — ${runStartedAt.toISOString()}`);
  L.push('');
  L.push('One section per domain.');
  L.push('');

  for (const state of states) {
    L.push(`## ${state.title} (\`${state.domain}\`)`);
    L.push('');
    if (state.skipped) { L.push(`Skipped: ${state.skipped}`); L.push(''); continue; }

    L.push('| check | severity | status | violations |');
    L.push('|---|---|---|---|');
    for (const inv of state.invariants) {
      L.push(`| ${inv.title} | ${inv.severity} | ${inv.violations.length ? '**FAIL**' : 'ok'} | ${inv.violations.length} |`);
    }
    L.push('');
    for (const inv of state.invariants.filter((i) => i.violations.length)) {
      L.push(`### ${inv.severity === 'hard' ? 'FAIL' : 'WARN'} — ${inv.title}`);
      L.push('');
      L.push(inv.why);
      L.push('');
      L.push('```');
      for (const v of inv.violations.slice(0, 25)) L.push(`${v.key}  ${v.detail}`);
      if (inv.violations.length > 25) L.push(`... ${inv.violations.length - 25} more`);
      L.push('```');
      L.push('');
      L.push(`Remedy: \`${inv.remedy}\``);
      L.push('');
    }

    if (!state.previous) {
      L.push('Deltas: no previous snapshot; this run establishes the baseline.');
    } else if (!state.deltas.length) {
      L.push(`Deltas: no change since ${new Date(state.previous.ranAt).toISOString()}.`);
    } else {
      L.push('| metric | before | after | delta |');
      L.push('|---|---|---|---|');
      for (const d of state.deltas) {
        const delta = d.delta === null ? 'n/a' : `${d.delta > 0 ? '+' : ''}${d.delta}`;
        L.push(`| \`${d.metric}\` | ${d.from} | ${d.to} | ${delta} |`);
      }
    }
    L.push('');
  }

  writeFileSync(out, `${L.join('\n')}\n`);
  return out;
}

// --- digest --------------------------------------------------------------

export function printDigest(states, reportPath) {
  const line = (s) => console.log(s);
  const W = 66;
  line('');
  line('─'.repeat(W));
  line('  PIPELINE RETRO');
  line('─'.repeat(W));

  for (const state of states) {
    const name = state.domain.toUpperCase().padEnd(11);
    if (state.skipped) { line(`  ${name}  skipped — ${state.skipped}`); continue; }

    const failed = state.invariants.filter((i) => i.violations.length);
    if (!failed.length) {
      line(`  ${name}  ok (${state.invariants.length} invariant${state.invariants.length === 1 ? '' : 's'})`);
    } else {
      for (const inv of failed) {
        line(`  ${name}  ${inv.severity === 'hard' ? 'VIOLATED' : 'warning '} ${inv.title}`);
        for (const v of inv.violations.slice(0, 3)) line(`               ${v.key}  ${v.detail}`);
        if (inv.violations.length > 3) line(`               ... ${inv.violations.length - 3} more`);
        line(`               fix: ${inv.remedy}`);
      }
    }

    if (state.deltas.length) {
      const shown = state.deltas.slice(0, 4).map((d) => `${d.metric} ${d.from}→${d.to}`).join(', ');
      line(`               Δ ${shown}${state.deltas.length > 4 ? `, +${state.deltas.length - 4} more` : ''}`);
    }
  }

  line('─'.repeat(W));
  line(`  report: ${reportPath}`);
  line('');
}
