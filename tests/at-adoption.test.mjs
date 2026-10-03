// #135: a rule that defers a step to adoption ("confirmed at adoption",
// "turned on at adoption") names repository or account state no checker can
// read, so the only thing that surfaces it to an adopter is the step its
// module declares in module.json's atAdoption array, which `house enable`
// prints and `house doctor` lists until confirmed. These tests read the real
// modules: a rule that grows such a phrase without a declared step fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = join(HERE, '..', 'plugins', 'house', 'modules');
const AT_ADOPTION = /\bat adoption\b/i;
const STEP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const modules = readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(MODULES_DIR, e.name, 'module.json')))
  .map((e) => {
    const dir = join(MODULES_DIR, e.name);
    const json = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
    const ruleText = (json.rules || []).map((r) => readFileSync(join(dir, r), 'utf8')).join('\n');
    return { name: e.name, json, ruleText };
  });

// The check itself, kept separate from the real-module loop so the negative
// controls below exercise the same code.
function atAdoptionProblems({ name, json, ruleText }) {
  const problems = [];
  const steps = json.atAdoption;
  if (steps !== undefined && !Array.isArray(steps)) return [`${name}: atAdoption must be an array`];
  const list = steps || [];
  if (AT_ADOPTION.test(ruleText) && list.length === 0) {
    problems.push(`${name}: a rule defers a step to adoption, but module.json declares no atAdoption step`);
  }
  const seen = new Set();
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || !STEP_ID.test(s.id)) problems.push(`${name}: step id ${JSON.stringify(s && s.id)} is not kebab-case`);
    if (!s || typeof s.step !== 'string' || !s.step.trim()) problems.push(`${name}: step ${JSON.stringify(s && s.id)} has no sentence`);
    if (s && seen.has(s.id)) problems.push(`${name}: step id \`${s.id}\` is declared twice`);
    if (s) seen.add(s.id);
  }
  return problems;
}

test('every module whose rule defers a step to adoption declares atAdoption steps, each id unique', () => {
  const deferring = modules.filter((m) => AT_ADOPTION.test(m.ruleText)).map((m) => m.name);
  assert.ok(deferring.includes('github') && deferring.includes('security'), `positive control: expected github and security among ${deferring}`);
  assert.deepEqual(modules.flatMap(atAdoptionProblems), []);
});

test('negative controls: a deferring rule with no step fails, and a duplicated step id fails', () => {
  const rule = 'Anchor: a repository setting, confirmed at adoption.';
  assert.match(atAdoptionProblems({ name: 'x', json: {}, ruleText: rule })[0], /declares no atAdoption step/);
  const dup = { atAdoption: [{ id: 'a', step: 'One.' }, { id: 'a', step: 'Two.' }] };
  assert.match(atAdoptionProblems({ name: 'x', json: dup, ruleText: rule }).join('\n'), /declared twice/);
  assert.deepEqual(atAdoptionProblems({ name: 'x', json: { atAdoption: [{ id: 'a', step: 'One.' }] }, ruleText: rule }), []);
});
