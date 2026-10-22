// Tests for the vendored claude-code module file under plugins/house/modules/
// (claude-code/check-deep-research-upstream.mjs).
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
import { writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, mktemp } from './module-files-helpers.mjs';

// ── claude-code/check-deep-research-upstream.mjs ────────────────────────────
// No installed Claude Code binary is required: each test plants a fake binary
// holding a template-literal-escaped copy of a minimal deep-research body.

const DR_CHECK = join(ROOT, 'plugins/house/modules/claude-code/files/check-deep-research-upstream.mjs');

/** A minimal native body carrying every anchor the fork's pins rely on. */
function fakeNativeBody(overrides = {}) {
  const questionLine = overrides.questionLine ?? 'const QUESTION = (typeof args === "string" && args.trim()) || ""';
  const scope = overrides.scope ?? '{ label: "scope", schema: SCOPE_SCHEMA }';
  // The four fan-out constants and the fetch budget's bypass, the anchors the
  // depth-scaled budget replaces. `budget: false` drops them, for the refusal.
  const budgetLines = overrides.budget === false ? [] : [
    'const VOTES_PER_CLAIM = 3',
    'const REFUTATIONS_REQUIRED = 2',
    'const MAX_FETCH = 15',
    'const MAX_VERIFY_CLAIMS = 25',
  ];
  const bypassLines = overrides.budget === false ? [] : [
    '      if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {',
    '        return false',
    '      }',
  ];
  // The native global top-N verify selection the fork replaces with a
  // round-robin across search angles. `selection: false` drops it.
  const selectionLines = overrides.selection === false ? [] : [
    'const rankedClaims = [...allClaims]',
    '  .sort((a, b) => (impRank[a.importance] - impRank[b.importance]) || (qualRank[a.sourceQuality] - qualRank[b.sourceQuality]))',
    '  .slice(0, MAX_VERIFY_CLAIMS)',
  ];
  const lines = [
    '// deep-research: Scope \\u2192 pipeline(Search)',
    ...budgetLines,
    'const URL_HOST_PATTERN = /^[a-z][a-z0-9+.-]*:\\\\/\\\\/(?:www\\\\.)?([^/:?#@\\\\\\\\]+)/i',
    questionLine,
    ...bypassLines,
  ];
  // A prose mention of "model:" living outside any agent() option object
  // (e.g. inside a prompt string), for the negative control on trigger 1.
  if (overrides.prose) lines.push(overrides.prose);
  lines.push(
    // The scope and synthesize prompts end as the native ones do (the body is
    // stored template-escaped, so `\n` is written doubled here). `prompts:
    // false` drops that ending, for the refusal.
    `const scope = await agent("Avoid redundancy.${overrides.prompts === false ? '' : '\\\\n\\\\nStructured output only.'}",`,
    `  ${scope}`,
    ')',
    'agent(SEARCH_PROMPT(angle), {',
    '    label: "search:" + angle.label, phase: "Search", schema: SEARCH_SCHEMA',
    '  })',
    'agent(FETCH_PROMPT(source, a), {',
    '          schema: EXTRACT_SCHEMA,',
    '        })',
    'agent(VERIFY_PROMPT(claim, v), {',
    '          schema: VERDICT_SCHEMA,',
    '        })',
    // The verdict schema, verify checklist, tally, and synthesis anchors the
    // source-tier patches rely on (issue #295). `tiers: false` drops them.
    ...(overrides.tiers === false ? [] : [
      'const VERDICT_SCHEMA = {',
      '  type: "object", required: ["refuted", "evidence", "confidence"],',
      '  properties: {',
      '    refuted: { type: "boolean" },',
      '    evidence: { type: "string" },',
      '  },',
      '}',
      '  "3. Is the source quality sufficient for the claim\'s strength? (extraordinary claims need primary sources)\\\\n" +',
      '  "4. Is the claim outdated?\\\\n" +',
      '  "5. Is this a marketing claim / press release / cherry-picked benchmark / forum speculation?\\\\n\\\\n" +',
      '  "**refuted=true** if: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.\\\\n" +',
      '  "**refuted=false** ONLY if: claim is well-supported, current, and source quality matches claim strength.\\\\n" +',
      '  "Default to refuted=true if uncertain.\\\\n\\\\nStructured output only. Evidence MUST be specific."',
      '      const valid = verdicts.filter(Boolean)',
      '      const refuted = valid.filter(v => v.refuted).length',
      '      const errored = VOTES_PER_CLAIM - valid.length',
      '      const survives = valid.length >= REFUTATIONS_REQUIRED && refuted < REFUTATIONS_REQUIRED',
      '      const isRefuted = refuted >= REFUTATIONS_REQUIRED',
      '      return { ...claim, verdicts: valid, refutedVotes: refuted, erroredVotes: errored, survives, isRefuted }',
      'const unverified = voted.filter(c => !c.survives && !c.isRefuted)',
      '    "Vote: " + c.refutedVotes + " \\\\xB7 Source: " + webText(c.sourceUrl) + " (" + webText(c.sourceQuality) + ")\\\\n" +',
      '    "Quote: \\\\"" + webText(c.quote) + "\\\\"\\\\n"',
      '  "3. Assign confidence per finding: high (multiple primary sources), low (single source or blog-quality).\\\\n" +',
      '  "4. Write a 3-5 sentence executive summary.\\\\n" +',
    ]),
    ...selectionLines,
    `const report = await agent("6. List 2-4 open questions that emerged but weren't answered.${overrides.prompts === false ? '' : '\\\\n\\\\nStructured output only.'}",`,
    '  { label: "synthesize", schema: REPORT_SCHEMA }',
    ')',
    ...(overrides.selection === false || overrides.note === false ? [] : [
      'if (killed.length > 0) return {',
      '    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: 0 },',
      '  }',
      'if (!report) return {',
      '    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: 1 },',
      '  }',
    ]),
    'return {',
    '  question: QUESTION,',
    '  ...report,',
    '    agentCalls: 1 + scope.angles.length,',
    '  },',
    '}',
  );
  return lines.join('\n');
}

function fakeBinary(dir, body) {
  const p = join(dir, '2.1.999');
  writeFileSync(p, Buffer.concat([Buffer.from('\x00junk before `'), Buffer.from(body), Buffer.from('`\x00junk after')]));
  return p;
}

async function unescapedShaOf(body) {
  const mod = await import(pathToFileURL(DR_CHECK).href);
  return mod.sha256(mod.extractNativeBody(Buffer.from(body)));
}

function runDrCheck(args) {
  return spawnSync(process.execPath, [DR_CHECK, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_BINARY: '' } });
}

// Eight tests below only read the fork --rebuild writes from the default fake
// body (they check its text or run a block of it in memory), so it is built
// once, on first use; a test that rebuilds from a changed body, or writes
// where the fork lands, still builds its own.
let defaultRebuild;
function rebuiltDefaultFork() {
  defaultRebuild ??= (async () => {
    const dir = mktemp('house-dr-');
    const body = fakeNativeBody();
    const bin = fakeBinary(dir, body);
    const out = join(dir, 'deep-research-pinned.js');
    const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
    return { res, fork: existsSync(out) ? readFileSync(out, 'utf8') : '' };
  })();
  return defaultRebuild;
}

test('deep-research check: unchanged native body against its own baseline exits 0 (negative control)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.equal(j.version, '2.1.999');
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: a drifted native body exits 1 and names --rebuild (positive control)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody());
  const res = runDrCheck([`--binary=${bin}`, '--baseline=0000000000000000000000000000000000000000000000000000000000000000']);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /drifted/);
  assert.match(res.stdout, /--rebuild/);
});

test('deep-research check: native agent() calls carrying a model reach the sunset and exit 2', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({ scope: '{ label: "scope", schema: SCOPE_SCHEMA, model: "sonnet" }' });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stdout, /SUNSET/);
  assert.match(res.stdout, /carry a model/);
});

test('deep-research check: native args reading a per-stage model map reach the sunset and exit 2', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({
    questionLine: 'const QUESTION = (typeof args === "object" && args.question) || ""\nconst modelOverrides = args.models || {}',
  });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stdout, /model map/);
});

test('deep-research check: object args alone, with no model-map read, does NOT sunset (negative control)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({ questionLine: 'const QUESTION = (typeof args === "object" && args.question) || ""' });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: a prose "model:" mention in a prompt string does NOT sunset (negative control)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody({ prose: '"Explain the target model: pick the one that fits the audience.",' });
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: --rebuild writes a fork with five model pins, a MODELS map, and unescaped regex', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal((fork.match(/model: MODELS\./g) || []).length, 5);
  assert.match(fork, /name: 'deep-research-pinned'/);
  assert.match(fork, /ARGS_OBJ\.models/);
  assert.ok(fork.includes(':\\/\\/(?:www\\.)?'), 'template-literal escaping undone');
  assert.ok(!fork.includes('\\\\/'), 'no doubled backslashes remain');
});

test('deep-research check: --rebuild pins an effort on all five agent() calls with an EFFORTS map (issue #230)', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal((fork.match(/effort: EFFORTS\./g) || []).length, 5);
  assert.match(fork, /synthesize: "high"/);
  assert.match(fork, /ARGS_OBJ\.efforts/);
  assert.match(fork, /log\("Efforts: /);
  assert.match(fork, /efforts: \{scope, search, fetch, verify, synthesize\}/);
});

test('deep-research check: --rebuild forbids tools in the scope and synthesize prompts, once each, before the closing line (issue #230)', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const scopeSentence = 'Do not call any tool (no ToolSearch, WebSearch or WebFetch): write the angles from the question text alone. The Search phase runs every query you return.';
  const synthSentence = 'Work only from the claims above. Do not call any tool (no ToolSearch, WebSearch or WebFetch).';
  assert.equal(fork.split(scopeSentence).length - 1, 1);
  assert.equal(fork.split(synthSentence).length - 1, 1);
  assert.ok(fork.includes(`${scopeSentence}\\n\\nStructured output only.",\n  { label: "scope"`));
  assert.ok(fork.includes(`${synthSentence}\\n\\nStructured output only.",\n  { label: "synthesize"`));
});

test('deep-research check: --rebuild refuses when a prompt anchor no longer matches exactly once (issue #230)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ prompts: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /anchor not found exactly once: Avoid redundancy/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild refuses when a pin anchor no longer matches exactly once', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ scope: '{ label: "scope", schema: SCOPE_SCHEMA, effort: "high" }' }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /SCOPE_SCHEMA/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild replaces the fixed fan-out with depth presets and bounds the fetch bypass', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(fork, /const DEPTH_PRESETS = \{/);
  assert.match(fork, /const VOTES_PER_CLAIM = BUDGET\.votes/);
  assert.match(fork, /const MAX_VERIFY_CLAIMS = BUDGET\.maxVerifyClaims/);
  assert.ok(!/const VOTES_PER_CLAIM = 3/.test(fork), 'native constant still present');
  assert.ok(!/const MAX_VERIFY_CLAIMS = 25/.test(fork), 'native constant still present');
  assert.match(fork, /fetchSlots <= -BUDGET\.fetchOverflow/);
  assert.ok(!fork.includes('if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {'), 'unbounded bypass still present');
  assert.ok(fork.indexOf('const ARGS_OBJ') < fork.indexOf('const QUESTION ='), 'ARGS_OBJ must be defined before QUESTION reads it');
  assert.equal((fork.match(/const ARGS_OBJ/g) || []).length, 1, 'ARGS_OBJ defined exactly once');
  assert.match(fork, /args\.depth|depth: "light"/);
});

test('deep-research check: --rebuild refuses when the fan-out constants no longer match exactly once', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ budget: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /VOTES_PER_CLAIM/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: the rebuilt budget block resolves depth, overrides, and rejects a bad budget', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  // Run just the budget block the way the workflow runtime would: as a
  // function body with `args` and `log` in scope and a top-level return.
  const start = fork.indexOf('const ARGS_OBJ');
  const end = fork.indexOf('\n', fork.indexOf('log("Depth: '));
  const block = fork.slice(start, end);
  const run = (args) => {
    const logs = [];
    const r = new Function('args', 'log', `${block}\nreturn { DEPTH, BUDGET, VOTES_PER_CLAIM, REFUTATIONS_REQUIRED, MAX_FETCH, MAX_VERIFY_CLAIMS }`)(args, (m) => logs.push(m));
    return { ...r, logs };
  };
  const std = run('a plain question string');
  assert.equal(std.DEPTH, 'standard');
  assert.equal(std.VOTES_PER_CLAIM, 3);
  assert.equal(std.MAX_VERIFY_CLAIMS, 15);
  assert.match(std.logs[0], /^Depth: standard/);
  const light = run({ question: 'q', depth: 'light' });
  assert.equal(light.VOTES_PER_CLAIM, 2);
  assert.equal(light.MAX_FETCH, 8);
  const deep = run({ question: 'q', depth: 'deep' });
  assert.equal(deep.MAX_VERIFY_CLAIMS, 30);
  assert.ok(deep.MAX_VERIFY_CLAIMS * deep.VOTES_PER_CLAIM > std.MAX_VERIFY_CLAIMS * std.VOTES_PER_CLAIM, 'deep verifies more than standard');
  assert.equal(run({ question: 'q', depth: 'bogus' }).DEPTH, 'standard', 'unknown depth falls back to standard');
  assert.equal(run({ question: 'q', depth: 'constructor' }).DEPTH, 'standard', 'prototype key is not a preset');
  const over = run({ question: 'q', depth: 'light', budget: { maxVerifyClaims: 40 } });
  assert.equal(over.MAX_VERIFY_CLAIMS, 40, 'args.budget overrides a preset field');
  assert.equal(over.VOTES_PER_CLAIM, 2, 'unlisted fields keep the preset');
  assert.match(run({ question: 'q', budget: { votes: 1, refutationsRequired: 2 } }).error, /refutationsRequired <= votes/);
  assert.match(run({ question: 'q', budget: { maxFetch: -1 } }).error, /maxFetch/);
  assert.match(run({ question: 'q', budget: { votes: '3' } }).error, /votes/);
});

test('deep-research check: the rebuilt effort block applies args.efforts and rejects a level the runtime does not take', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const start = fork.indexOf('const EFFORTS');
  const end = fork.indexOf('\n', fork.indexOf('log("Efforts: '));
  const block = fork.slice(start, end);
  const run = (args) => new Function('ARGS_OBJ', 'log', `${block}\nreturn { EFFORTS }`)(args, () => {});
  assert.deepEqual(run({}).EFFORTS, { scope: 'medium', search: 'medium', fetch: 'medium', verify: 'medium', synthesize: 'high' });
  assert.equal(run({ efforts: { scope: 'low' } }).EFFORTS.scope, 'low');
  assert.equal(run({ efforts: { scope: 'low' } }).EFFORTS.synthesize, 'high', 'unlisted stages keep the default');
  assert.match(run({ efforts: { verify: 'bogus' } }).error, /args\.efforts\.verify/);
  assert.match(run({ efforts: { scope: null } }).error, /args\.efforts\.scope/);
});

test('deep-research check: pickRoundRobin takes one claim per angle in turn, each angle in its own order, up to the cap', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const claims = [
    { id: 'a1', angle: 'A' }, { id: 'a2', angle: 'A' }, { id: 'b1', angle: 'B' },
    { id: 'a3', angle: 'A' }, { id: 'c1', angle: 'C' }, { id: 'a4', angle: 'A' },
    { id: 'c2', angle: 'C' }, { id: 'c3', angle: 'C' },
  ];
  const pick = (cap) => pickRoundRobin(claims, (c) => c.angle, cap).map((c) => c.id);
  assert.deepEqual(pick(5), ['a1', 'b1', 'c1', 'a2', 'c2']);
  assert.deepEqual(pick(100), ['a1', 'b1', 'c1', 'a2', 'c2', 'a3', 'c3', 'a4'], 'no cap: every claim, none twice');
  assert.deepEqual(pick(0), []);
});

test('deep-research check: pickRoundRobin with cap K is a prefix of the selection with a larger cap, so an extended run keeps its verify calls', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const claims = Array.from({ length: 40 }, (_, i) => ({ id: i, angle: 'abcde'[(i * 7) % 5] + (i % 3 ? '' : 'x') }));
  const full = pickRoundRobin(claims, (c) => c.angle, 40).map((c) => c.id);
  for (let k = 0; k <= 40; k++) {
    for (const n of [1, 5, 15]) {
      const small = pickRoundRobin(claims, (c) => c.angle, k).map((c) => c.id);
      const big = pickRoundRobin(claims, (c) => c.angle, k + n).map((c) => c.id);
      assert.deepEqual(big.slice(0, small.length), small, `cap ${k} is a prefix of cap ${k + n}`);
    }
  }
  assert.equal(new Set(full).size, 40);
});

const TIER_RANK = { central: 0, supporting: 1, tangential: 2 };
const tierClaims = [
  { id: 'a1', angle: 'A', importance: 'tangential' }, { id: 'a2', angle: 'A', importance: 'central' },
  { id: 'a3', angle: 'A', importance: 'central' }, { id: 'a4', angle: 'A', importance: 'supporting' },
  { id: 'b1', angle: 'B', importance: 'central' }, { id: 'b2', angle: 'B', importance: 'tangential' },
  { id: 'c1', angle: 'C', importance: 'supporting' }, { id: 'c2', angle: 'C', importance: 'supporting' },
  { id: 'c3', angle: 'C', importance: 'central' }, { id: 'd1', angle: 'D', importance: 'supporting' },
].sort((x, y) => TIER_RANK[x.importance] - TIER_RANK[y.importance]);

test('deep-research check: pickRoundRobin with rankOf gives a central claim from one angle the slot ahead of a tangential claim from another', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const claims = [
    { id: 'b1', angle: 'B', importance: 'tangential' },
    { id: 'a1', angle: 'A', importance: 'central' }, { id: 'a2', angle: 'A', importance: 'central' },
  ];
  const pick = (cap) => pickRoundRobin(claims, (c) => c.angle, cap, (c) => TIER_RANK[c.importance]).map((c) => c.id);
  assert.deepEqual(pick(1), ['a1']);
  assert.deepEqual(pick(2), ['a1', 'a2'], 'both central claims beat the tangential one from the other angle');
  assert.deepEqual(pick(3), ['a1', 'a2', 'b1']);
});

test('deep-research check: pickRoundRobin with rankOf deals each tier round-robin across angles, in the order given', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const pick = (cap) => pickRoundRobin(tierClaims, (c) => c.angle, cap, (c) => TIER_RANK[c.importance]).map((c) => c.id);
  // central: A has a2 a3, B has b1, C has c3; supporting: A a4, C c1 c2, D d1; tangential: A a1, B b2.
  assert.deepEqual(pick(3), ['a2', 'b1', 'c3'], 'three central claims, one per angle');
  assert.deepEqual(pick(100), ['a2', 'b1', 'c3', 'a3', 'a4', 'c1', 'd1', 'c2', 'a1', 'b2'], 'each tier balanced across angles, none twice');
  assert.deepEqual(pick(0), []);
});

test('deep-research check: pickRoundRobin with rankOf keeps the prefix property across caps, so an extended run keeps its verify calls', async () => {
  const { pickRoundRobin } = await import(pathToFileURL(DR_CHECK).href);
  const pick = (cap) => pickRoundRobin(tierClaims, (c) => c.angle, cap, (c) => TIER_RANK[c.importance]).map((c) => c.id);
  for (let k = 0; k <= tierClaims.length; k++) {
    for (const n of [1, 2, 5]) {
      assert.deepEqual(pick(k + n).slice(0, pick(k).length), pick(k), `cap ${k} is a prefix of cap ${k + n}`);
    }
  }
  assert.equal(new Set(pick(100)).size, tierClaims.length);
  assert.ok(pick(4).every((id) => tierClaims.find((c) => c.id === id).importance === 'central'), 'the four central claims fill the first four slots at every cap up to 4');
});

test('deep-research check: verifyCap lets the preset win for few angles, the per-angle floor win for many, and the ceiling clamp both', async () => {
  const { verifyCap } = await import(pathToFileURL(DR_CHECK).href);
  const standard = { maxVerifyClaims: 15, minPerAngle: 3, maxVerifyCeiling: 25 };
  assert.equal(verifyCap(standard, 2), 15, 'few angles: 3 x 2 = 6 is under the preset 15');
  assert.equal(verifyCap(standard, 6), 18, 'many angles: 3 x 6 = 18 beats the preset');
  assert.equal(verifyCap({ ...standard, minPerAngle: 5 }, 6), 25, 'the ceiling clamps the floor');
  assert.equal(verifyCap({ ...standard, maxVerifyClaims: 40 }, 2), 25, 'the ceiling clamps the preset');
  assert.equal(verifyCap({ ...standard, maxVerifyClaims: 40, maxVerifyCeiling: 40 }, 2), 40, 'a budget override raises the ceiling');
  assert.equal(verifyCap(standard, 0), 15);
});

test('deep-research check: verifyNote names the dropped claims and how to extend the same run', async () => {
  const { verifyNote } = await import(pathToFileURL(DR_CHECK).href);
  const note = verifyNote({ verified: 25, total: 77, angles: 5, votes: 3, deepCeiling: 40 });
  assert.match(note, /^Verified 25 of 77 claims \(5 angles\)\./);
  assert.match(note, /resumeFromRunId set to this run's id/);
  assert.match(note, /the same args as this call/);
  assert.match(note, /every budget field it passed/);
  assert.match(note, /budget\.maxVerifyClaims: 40\b/);
  assert.ok(!/maxVerifyCeiling/.test(note), 'an explicit maxVerifyClaims is enough on its own');
  assert.match(note, /about 46 more agents/, '(40 - 25) x 3 votes + 1 synthesis');
  assert.match(verifyNote({ verified: 40, total: 77, angles: 5, votes: 3, deepCeiling: 40 }), /maxVerifyClaims: 77\b.*about 112 more agents/, 'past the deep ceiling, offer every claim');
  assert.match(verifyNote({ verified: 25, total: 30, angles: 5, votes: 2, deepCeiling: 40 }), /maxVerifyClaims: 30\b.*about 11 more agents/, 'never more than the claims found');
  assert.equal(verifyNote({ verified: 30, total: 30, angles: 5, votes: 3, deepCeiling: 40 }), '', 'nothing dropped, no note');
});

test('deep-research check: the rebuilt depth presets carry the per-angle floor and ceiling, and the estimate uses the ceiling', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const start = fork.indexOf('const ARGS_OBJ');
  const block = fork.slice(start, fork.indexOf('\n', fork.indexOf('log("Depth: ')));
  const run = (args) => {
    const logs = [];
    const r = new Function('args', 'log', `${block}\nreturn { BUDGET }`)(args, (m) => logs.push(m));
    return { ...r, logs };
  };
  const expect = { light: [2, 12], standard: [3, 25], deep: [4, 40] };
  for (const [depth, [floor, ceiling]] of Object.entries(expect)) {
    const r = run({ question: 'q', depth });
    assert.equal(r.BUDGET.minPerAngle, floor, depth);
    assert.equal(r.BUDGET.maxVerifyCeiling, ceiling, depth);
    assert.match(r.logs[0], new RegExp(`ceiling ${ceiling}\\b`), depth);
  }
  // standard: 7 + (15 + 5) fetched + 25 x 3 votes = 102 at the ceiling.
  assert.match(run('q').logs[0], /at most ~102 agents/);
  assert.equal(run({ question: 'q', budget: { maxVerifyCeiling: 50 } }).BUDGET.maxVerifyCeiling, 50);
  // An explicit maxVerifyClaims above the preset ceiling is honored, not clamped.
  assert.equal(run({ question: 'q', budget: { maxVerifyClaims: 40 } }).BUDGET.maxVerifyCeiling, 40);
  assert.equal(run({ question: 'q', budget: { maxVerifyClaims: 10 } }).BUDGET.maxVerifyCeiling, 25, 'a lower request leaves the ceiling');
  assert.equal(run({ question: 'q', depth: 'deep' }).BUDGET.maxVerifyCeiling, 40, 'no request, no change');
  assert.match(run({ question: 'q', budget: { minPerAngle: -1 } }).error, /minPerAngle/);
  assert.match(fork, /verifyNote: VERIFY_NOTE/);
  assert.equal((fork.match(/VERIFY_NOTE \? \{ verifyNote: VERIFY_NOTE \}/g) || []).length, 3, 'every result after verify carries the note');
});

test('deep-research check: --rebuild selects verify claims tier by tier, round-robin across angles inside a tier, not the global top-N', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.ok(!fork.includes('.slice(0, MAX_VERIFY_CLAIMS)'), 'global top-N slice still present');
  assert.match(fork, /function pickRoundRobin\(/);
  // Run the rebuilt selection block on synthetic sources: angle A holds most
  // central claims, so a global top-N would give it every slot; the old
  // angle-only deal gave angle B's tangential claim a slot ahead of central ones.
  const start = fork.indexOf('function pickRoundRobin(');
  const end = fork.indexOf('\n', fork.indexOf('log(VERIFY_NOTE)'));
  const block = fork.slice(start, end);
  const allSources = [
    { angle: 'A', claims: [{ id: 'a1', importance: 'central', sourceQuality: 'primary' }, { id: 'a2', importance: 'central', sourceQuality: 'primary' }] },
    { angle: 'A', claims: [{ id: 'a3', importance: 'central', sourceQuality: 'secondary' }] },
    { angle: 'B', claims: [{ id: 'b1', importance: 'tangential', sourceQuality: 'blog' }, { id: 'b2', importance: 'supporting', sourceQuality: 'blog' }] },
    { angle: 'C', claims: [{ id: 'c1', importance: 'supporting', sourceQuality: 'forum' }, { id: 'c2', importance: 'central', sourceQuality: 'forum' }] },
  ];
  const select = (budget) => {
    const logs = [];
    const r = new Function('allSources', 'BUDGET', 'MAX_VERIFY_CLAIMS', 'VOTES_PER_CLAIM', 'DEPTH_PRESETS', 'log', `
      const allClaims = allSources.flatMap(s => s.claims)
      const impRank = { central: 0, supporting: 1, tangential: 2 }
      const qualRank = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 }
      ${block}
      return { rankedClaims, VERIFY_NOTE }`)(allSources, budget, budget.maxVerifyClaims, 3, { deep: { maxVerifyCeiling: 40 } }, (m) => logs.push(m));
    return { ids: r.rankedClaims.map((c) => c.id), note: r.VERIFY_NOTE, logs };
  };
  // minPerAngle 1 x 3 angles is below maxVerifyClaims 4, so the cap is 4: the
  // central tier (a1 a2 a3 c2) is dealt across angles A and C, and B's
  // supporting and tangential claims wait.
  const four = select({ maxVerifyClaims: 4, minPerAngle: 1, maxVerifyCeiling: 10 });
  assert.deepEqual(four.ids, ['a1', 'c2', 'a2', 'a3']);
  assert.match(four.note, /^Verified 4 of 7 claims \(3 angles\)\./);
  assert.ok(four.logs.includes(four.note), 'the dropped-claims note is logged');
  // The supporting tier follows, round-robin across B and C, then the tangential.
  assert.deepEqual(select({ maxVerifyClaims: 6, minPerAngle: 0, maxVerifyCeiling: 10 }).ids, ['a1', 'c2', 'a2', 'a3', 'b2', 'c1']);
  // The selection at a smaller cap is a prefix of the selection at a larger one.
  const full = select({ maxVerifyClaims: 7, minPerAngle: 0, maxVerifyCeiling: 10 }).ids;
  assert.deepEqual(full, ['a1', 'c2', 'a2', 'a3', 'b2', 'c1', 'b1']);
  for (let n = 0; n <= 7; n++) {
    assert.deepEqual(select({ maxVerifyClaims: n, minPerAngle: 0, maxVerifyCeiling: 10 }).ids, full.slice(0, n), `cap ${n}`);
  }
  // minPerAngle 3 x 3 angles lifts the cap to 9: every claim, no note.
  const all = select({ maxVerifyClaims: 4, minPerAngle: 3, maxVerifyCeiling: 10 });
  assert.equal(all.ids.length, 7);
  assert.equal(all.note, '');
});

test('deep-research check: --rebuild refuses when the verify selection no longer matches exactly once', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ selection: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /rankedClaims/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild refuses when the result anchors for the verify note no longer match', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ note: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /stats: \{ angles/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: --rebuild separates "does the source say it" from "how much does it weigh" (issue #295)', async () => {
  const { res, fork } = await rebuiltDefaultFork();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(!fork.includes('low-quality source for strong claim'), 'native refute-on-quality wording still present');
  assert.ok(!fork.includes('Is the source quality sufficient'), 'native quality checklist item still present');
  assert.ok(!fork.includes('Default to refuted=true if uncertain.'), 'native default-refute line still present');
  assert.match(fork, /required: \["refuted", "basis", "evidence", "confidence"\]/);
  assert.match(fork, /basis: \{ enum: \["supported", "weak-source", "unsupported", "contradicted", "outdated"\] \}/);
  assert.match(fork, /basis=weak-source/);
  assert.match(fork, /Never refute a claim only because its source is opinion/);
  assert.match(fork, /issue #295/);
  assert.match(fork, /function tierNote\(/);
  assert.match(fork, /const TIER_NOTE = tierNote\(voted\)/);
  assert.equal((fork.match(/TIER_NOTE \? \{ tierNote: TIER_NOTE \}/g) || []).length, 3, 'every result after verify carries the tier note');
  assert.match(fork, /Weak source: " \+ c\.weakVotes/);
  assert.match(fork, /report it as what it is/);
});

test('deep-research check: --rebuild refuses when the source-tier anchors no longer match (issue #295)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ tiers: false }));
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /rebuild refused/);
  assert.match(res.stdout, /anchor not found/);
  assert.ok(!existsSync(out), 'no partial fork written');
});

test('deep-research check: the rebuilt tally rescues a claim refuted only on source weakness, and nothing else (issue #295)', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  const start = fork.indexOf('const valid = verdicts.filter(Boolean)');
  const retLine = fork.indexOf('return { ...claim', start);
  const block = fork.slice(start, fork.indexOf('\n', retLine));
  const tally = (basisList) => new Function('verdicts', 'claim', 'VOTES_PER_CLAIM', 'REFUTATIONS_REQUIRED', block)(
    basisList.map((basis) => ({ refuted: basis !== 'supported', basis, evidence: 'e', confidence: 'high' })),
    { claim: 'c' }, 3, 2);
  const weak = tally(['weak-source', 'weak-source', 'weak-source']);
  assert.equal(weak.survives, true, 'a 0-3 vote of weak-source refutes survives');
  assert.equal(weak.isRefuted, false);
  assert.equal(weak.refutedVotes, 0);
  assert.equal(weak.weakVotes, 3);
  assert.equal(weak.tierOnlyVotes, 3);
  assert.equal(weak.rescued, true);
  const content = tally(['unsupported', 'unsupported', 'weak-source']);
  assert.equal(content.isRefuted, true, 'a content refute still kills');
  assert.equal(content.survives, false);
  assert.equal(content.rescued, false);
  const contradicted = tally(['contradicted', 'contradicted', 'contradicted']);
  assert.equal(contradicted.isRefuted, true, 'a contradicted refute is not overridden');
  assert.equal(contradicted.refutedVotes, 3);
  assert.equal(contradicted.tierOnlyVotes, 0);
  const mixed = tally(['unsupported', 'weak-source', 'supported']);
  assert.equal(mixed.survives, true);
  assert.equal(mixed.refutedVotes, 1, 'only the content refute counts');
  assert.equal(mixed.rescued, true, 'the weak-source vote alone would have made quorum');
});

test('deep-research check: tierNote reports the split, and is empty when no tier label was used (issue #295)', async () => {
  const { tierNote } = await import(pathToFileURL(DR_CHECK).href);
  const claim = (o) => ({ survives: false, isRefuted: false, weakVotes: 0, rescued: false, ...o });
  assert.equal(tierNote([claim({ survives: true }), claim({ isRefuted: true })]), '', 'no weak-source label, no note');
  const note = tierNote([
    claim({ isRefuted: true }),
    claim({ survives: true, weakVotes: 2, rescued: true }),
    claim({ survives: true, weakVotes: 1 }),
    claim({ survives: true }),
  ]);
  assert.match(note, /1 claims? refuted on content/);
  assert.match(note, /2 claims? kept with a weak-source label/);
  assert.match(note, /1 of those would have been refuted on source weakness alone/);
});

test('deep-research check: the fork and the --install message say to copy the fork into the scratchpad first', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /scratchpad/);
  const whenToUse = readFileSync(out, 'utf8').match(/whenToUse: '([^']*)'/)[1];
  assert.match(whenToUse, /scratchpad/);
  assert.ok(!/Run by scriptPath\./.test(whenToUse), 'whenToUse still says to run the stable path directly');
});

test('deep-research check: a binary without the bundled script exits 1, not 0', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, '// nothing here');
  const res = runDrCheck([`--binary=${bin}`]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /not found in binary/);
});

test('deep-research check: running from a directory whose path contains a space does not crash (ENOENT regression)', async () => {
  const dir = mktemp('house dr with space-');
  assert.match(dir, / /, 'fixture sanity: the temp dir must actually contain a space');
  const copy = join(dir, 'check-deep-research-upstream.mjs');
  copyFileSync(DR_CHECK, copy);
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = spawnSync(process.execPath, [copy, `--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_BINARY: '' },
  });
  assert.ok(!/ENOENT/.test(res.stderr), `unexpected ENOENT crash:\n${res.stderr}`);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = JSON.parse(res.stdout);
  assert.match(j.verdict, /unchanged/);
});

test('deep-research check: --binary pointing at a missing path exits 3 and names the path, never silently falling back', () => {
  const missing = '/definitely/not/a/real/deep-research-fixture-path';
  const res = runDrCheck([`--binary=${missing}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /invalid --binary/);
  assert.ok(res.stdout.includes(missing), res.stdout);
});

test('deep-research check: --binary pointing at a directory exits 3 and names the path', () => {
  const dir = mktemp('house-dr-dir-');
  const res = runDrCheck([`--binary=${dir}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.ok(res.stdout.includes(dir), res.stdout);
});

test('deep-research check: --rebuild refuses to overwrite an existing file without --force', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'existing-fork.js');
  writeFileSync(out, 'PRIOR CONTENT');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /--force/);
  assert.equal(readFileSync(out, 'utf8'), 'PRIOR CONTENT', 'existing file must be left untouched');
});

test('deep-research check: --rebuild overwrites an existing file when --force is passed', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'existing-fork.js');
  writeFileSync(out, 'PRIOR CONTENT');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`, '--force']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const fork = readFileSync(out, 'utf8');
  assert.notEqual(fork, 'PRIOR CONTENT');
  assert.match(fork, /name: 'deep-research-pinned'/);
});

test('deep-research check: --rebuild creates missing parent directories', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'nested', 'deeper', 'deep-research-pinned.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--rebuild=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(existsSync(out), 'rebuild must create the missing parent directory');
});

function runDrCheckHome(args, home) {
  return spawnSync(process.execPath, [DR_CHECK, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_BINARY: '', HOME: home, USERPROFILE: home } });
}

test('deep-research check: --install writes the fork to ~/.claude/workflows/deep-research-tiered.js', async () => {
  const dir = mktemp('house-dr-');
  const home = mktemp('house-dr-home-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = runDrCheckHome([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--install'], home);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const target = join(home, '.claude', 'workflows', 'deep-research-tiered.js');
  assert.match(readFileSync(target, 'utf8'), /name: 'deep-research-pinned'/);
});

test('deep-research check: --install writes under CLAUDE_CONFIG_DIR when it is set (#375)', async () => {
  const dir = mktemp('house-dr-');
  const home = mktemp('house-dr-home-');
  const cfg = mktemp('house-dr-cfg-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = spawnSync(process.execPath, [DR_CHECK, `--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, '--install'], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_BINARY: '', HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: cfg },
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(readFileSync(join(cfg, 'workflows', 'deep-research-tiered.js'), 'utf8'), /name: 'deep-research-pinned'/);
  assert.ok(!existsSync(join(home, '.claude', 'workflows', 'deep-research-tiered.js')), 'nothing lands under ~/.claude');
});

test('deep-research check: --install writes the build marker house doctor reads (#367)', async () => {
  const dir = mktemp('house-dr-');
  const out = join(dir, 'fork.js');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const text = readFileSync(out, 'utf8');
  const m = /^\/\/ house-fork-build: ([0-9a-f]{12}) ([0-9a-f]{12})\n/m.exec(text);
  assert.ok(m, 'the fork carries a build marker line');
  const sha12 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);
  assert.equal(m[1], sha12(readFileSync(DR_CHECK)), 'the id is the hash of this script');
  assert.equal(m[2], sha12(text.replace(m[0], '')), 'the hash covers the whole fork with the marker line removed');
});

test('deep-research check: --install overwrites an existing file without --force', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const out = join(dir, 'fork.js');
  writeFileSync(out, 'PRIOR CONTENT');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${out}`]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(readFileSync(out, 'utf8'), /name: 'deep-research-pinned'/);
});

test('deep-research check: --install together with --rebuild exits 3 and writes nothing', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const a = join(dir, 'a.js');
  const b = join(dir, 'b.js');
  const res = runDrCheck([`--binary=${bin}`, `--baseline=${await unescapedShaOf(body)}`, `--install=${a}`, `--rebuild=${b}`]);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.ok(!existsSync(a) && !existsSync(b), 'neither file may be written');
});

test('deep-research check: an empty --install= or --rebuild= path exits 3 instead of silently skipping the write', async () => {
  const dir = mktemp('house-dr-');
  const body = fakeNativeBody();
  const bin = fakeBinary(dir, body);
  const sha = await unescapedShaOf(body);
  for (const flag of ['--install=', '--rebuild=']) {
    const res = runDrCheck([`--binary=${bin}`, `--baseline=${sha}`, flag]);
    assert.equal(res.status, 3, `${flag}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /need a path/);
  }
});

test('deep-research check: --install on a drifted body installs, then exits 1 naming the installed path', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody());
  const out = join(dir, 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, '--baseline=0000000000000000000000000000000000000000000000000000000000000000', `--install=${out}`]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.ok(existsSync(out));
  assert.ok(res.stdout.includes(out), res.stdout);
});

test('deep-research check: --install does not install on SUNSET (exit 2)', () => {
  const dir = mktemp('house-dr-');
  const bin = fakeBinary(dir, fakeNativeBody({ scope: '{ label: "scope", schema: SCOPE_SCHEMA, model: "opus" }' }));
  const out = join(dir, 'fork.js');
  const res = runDrCheck([`--binary=${bin}`, `--install=${out}`]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.ok(!existsSync(out), 'a sunset must not install the fork');
});
