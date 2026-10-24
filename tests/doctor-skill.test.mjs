// #462: the doctor skill explains every line `house doctor` prints. This reads
// the label literals out of cmdDoctor (and the one helper that adds indented
// follow-on lines) in plugins/house/scripts/house rather than running doctor
// over fixtures, since several lines depend on the network and the machine.
// A line is held to the skill by its label: the first two words of what it
// prints before the first interpolation. A new console.log in cmdDoctor with no
// matching bullet in plugins/house/skills/doctor/SKILL.md fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = readFileSync(join(ROOT, 'plugins/house/scripts/house'), 'utf8');
const SKILL = readFileSync(join(ROOT, 'plugins/house/skills/doctor/SKILL.md'), 'utf8');

// console.log(variable) lines: the producer is another function, so each is
// named here with the label its bullet carries. An unlisted one fails below.
const PASSTHROUGH = {
  pinStatus: 'pin v',
  'latestRelease.line': 'latest release',
  'deepResearchFork.line': 'deep-research fork',
  line: 'git-hook floor',
};

function functionBody(name) {
  const start = SCRIPT.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} not found in plugins/house/scripts/house`);
  const end = SCRIPT.indexOf('\n}\n', start);
  return SCRIPT.slice(start, end);
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

// A word ending in a colon is the whole label (`caveat:`, `reference-transaction:`).
function labelOf(lead) {
  const words = lead.trim().split(/\s+/);
  return words[0].endsWith(':') ? words[0] : words.slice(0, 2).join(' ').replace(/[:,;]+$/, '');
}

// Every label cmdDoctor can print, and every unrecognised console.log shape.
function doctorLabels(body, helperBody) {
  const labels = new Set();
  const unknown = [];
  for (const m of body.matchAll(/console\.log\(/g)) {
    const rest = body.slice(m.index + m[0].length);
    const arg = rest.match(/^\s*([`'"])/);
    const ternary = rest.match(/^\s*[\w.]+\s*\?\s*([`'"])/);
    const ident = rest.match(/^\s*([\w.]+)\s*\)/);
    if (arg) labels.add(labelOf(literalLead(rest, rest.indexOf(arg[1]))));
    else if (ternary) labels.add(labelOf(literalLead(rest, rest.indexOf(ternary[1], ternary[0].length - 1))));
    else if (/^\s*JSON\.stringify\(/.test(rest)) continue;
    else if (ident && PASSTHROUGH[ident[1]]) labels.add(PASSTHROUGH[ident[1]]);
    else unknown.push(rest.slice(0, 60).split('\n')[0]);
  }
  // Indented follow-on lines the floor helper pushes after its main line.
  for (const m of helperBody.matchAll(/\.push\(\s*([`'])(  [^`'$]*)/g)) labels.add(labelOf(m[2]));
  for (const m of helperBody.matchAll(/\?\s*([`'])(  [^`'$]*)/g)) labels.add(labelOf(m[2]));
  for (const m of helperBody.matchAll(/:\s*([`'])(  [^`'$]*)/g)) labels.add(labelOf(m[2]));
  return { labels, unknown };
}

test('#462: every line cmdDoctor prints has an entry in the doctor skill', () => {
  const { labels, unknown } = doctorLabels(functionBody('cmdDoctor'), functionBody('gitHookFloorLines'));
  assert.deepEqual(unknown, [], 'a console.log shape this test cannot read; add it to PASSTHROUGH or teach the test');
  assert.ok(labels.size >= 15, `read only ${labels.size} labels: ${[...labels].join(' | ')}`);
  const missing = [...labels].filter((l) => !SKILL.includes(l));
  assert.deepEqual(missing, [], `doctor prints these lines, but plugins/house/skills/doctor/SKILL.md has no bullet naming them: ${missing.join(' | ')}`);
});

test('#462: the label reader sees a doctor line the skill does not name (positive control)', () => {
  const body = functionBody('cmdDoctor').replace("console.log(`jq on PATH:", "console.log('fake doctor line: x');\n    console.log(`jq on PATH:");
  const { labels } = doctorLabels(body, functionBody('gitHookFloorLines'));
  assert.ok(labels.has('fake doctor'), [...labels].join(' | '));
  assert.ok(!SKILL.includes('fake doctor'));
});

test('#462: the label reader reports a console.log shape it cannot read (negative control)', () => {
  const body = functionBody('cmdDoctor').replace("console.log(`jq on PATH:", "console.log(someNewLine);\n    console.log(`jq on PATH:");
  assert.deepEqual(doctorLabels(body, functionBody('gitHookFloorLines')).unknown.length, 1);
});
