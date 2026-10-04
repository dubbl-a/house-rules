// Registration gate (#136). A module under plugins/house/modules/ is the single
// source; every place a module has to be listed by hand is asserted here, so a
// new module that is missing from one fails by naming the module and the file.
// The registration points are listed in CONTRIBUTING.md.
//
// Not asserted per module: tests/check/consumer-render.test.mjs. It walks every
// key of the freshly initialised house.json (setEveryModuleConfig), so a module
// is covered there without being named, and its few hardcoded name lists are
// subsets by design.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MODULES_DIR = 'plugins/house/modules';
const modules = readdirSync(join(ROOT, MODULES_DIR), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();
const spec = (name) => JSON.parse(read(`${MODULES_DIR}/${name}/module.json`));

// Rule count, counted as scripts/check-traceability.mjs counts: every `## `
// heading in a module's rule files except the closing `## Don't` section.
function ruleCount(name) {
  let n = 0;
  for (const rel of spec(name).rules) {
    for (const line of read(`${MODULES_DIR}/${name}/${rel}`).split('\n')) {
      const h = line.match(/^##\s+(.*)/);
      if (h && h[1].trim() !== "Don't") n++;
    }
  }
  return n;
}

// Run `check(name)` for every module; a returned string is a miss.
function assertEveryModule(check) {
  const misses = modules.map((m) => check(m)).filter(Boolean);
  assert.deepEqual(misses, [], `\n${misses.join('\n')}`);
}

test('module directories are non-empty and each carries a module.json', () => {
  assert.ok(modules.length > 0);
  for (const m of modules) assert.ok(existsSync(join(ROOT, MODULES_DIR, m, 'module.json')), `${m}: no module.json`);
});

test('every module has a handbook chapter, a manifest rule entry, a manifest chapter entry, and inventory rows', () => {
  const manifest = JSON.parse(read('docs/handbook/manifest.json')).artifacts;
  const inventory = read('docs/handbook/inventory.md');
  assertEveryModule((m) => {
    if (!existsSync(join(ROOT, `docs/handbook/${m}.md`))) return `${m}: missing docs/handbook/${m}.md`;
    const has = (kind, path) => manifest.some((a) => a.kind === kind && a.module === m && a.path === path);
    if (!has('rule', `${MODULES_DIR}/${m}/rules/${m}.md`)) return `${m}: no rule artifact in docs/handbook/manifest.json`;
    if (!has('chapter', `docs/handbook/${m}.md`)) return `${m}: no chapter artifact in docs/handbook/manifest.json`;
    if (!inventory.includes(`rule:${m}.md#`)) return `${m}: no rule:${m}.md# destination row in docs/handbook/inventory.md`;
    return null;
  });
});

test('every module is in house.json, and its rendered outputs match whether it is enabled', () => {
  const houseJson = JSON.parse(read('house.json'));
  const index = read('.house/INDEX.md');
  const lock = JSON.parse(read('.house/lock.json')).files.map((f) => f.path);
  const agents = read('AGENTS.md');
  assertEveryModule((m) => {
    const entry = houseJson.modules[m];
    if (!entry) return `${m}: no entry under modules in house.json`;
    const rule = `.claude/rules/house/${m}.md`;
    const rendered = {
      [rule]: existsSync(join(ROOT, rule)),
      '.house/INDEX.md': index.includes(`## ${rule}`),
      '.house/lock.json': lock.includes(rule),
      'AGENTS.md': agents.includes(`Full text: \`${rule}\``),
    };
    // The AGENTS.md block is for other agents; house render skips claude-code's
    // own rule there (plugins/house/scripts/house, the `p.target.module === 'claude-code'` skip).
    if (m === 'claude-code') delete rendered['AGENTS.md'];
    for (const [file, present] of Object.entries(rendered)) {
      if (entry.enabled && !present) return `${m}: enabled in house.json but absent from ${file}`;
      if (!entry.enabled && present) return `${m}: disabled in house.json but present in ${file}`;
    }
    return null;
  });
});

test('every module is named in README.md, site/index.html, the issue template, the marketplace description, and the harness audit', () => {
  const readme = read('README.md');
  const site = read('site/index.html');
  const issue = read('.github/ISSUE_TEMPLATE/rule_proposal.yml');
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json')).description.toLowerCase();
  const audit = read('.claude/skills/adapting-to-harness-updates/scripts/house-vs-harness-audit.js');
  const auditList = audit.match(/const MODULES = \[([^\]]*)\]/);
  assert.ok(auditList, 'house-vs-harness-audit.js: no `const MODULES = [...]` line found');
  const audited = [...auditList[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assertEveryModule((m) => {
    if (!readme.includes(`**${m}**`)) return `${m}: no **${m}** bullet in README.md`;
    if (!site.includes(`<strong>${m}</strong>`)) return `${m}: no <strong>${m}</strong> in site/index.html`;
    if (!new RegExp(`^\\s+- ${m}$`, 'm').test(issue)) return `${m}: not an option in .github/ISSUE_TEMPLATE/rule_proposal.yml`;
    if (!marketplace.includes(m) && !marketplace.includes(m.replace(/-/g, ' '))) return `${m}: not in the description in .claude-plugin/marketplace.json`;
    if (!audited.includes(m)) return `${m}: not in MODULES in .claude/skills/adapting-to-harness-updates/scripts/house-vs-harness-audit.js`;
    return null;
  });
});

test('every stated module and rule count in README.md and site/index.html matches the module directories', () => {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
    'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const num = (s) => (/^\d+$/.test(s) ? Number(s) : words.indexOf(s.toLowerCase()));
  const number = `(${words.join('|')}|\\d+)`;
  const total = modules.reduce((n, m) => n + ruleCount(m), 0);
  const onByDefault = modules.filter((m) => spec(m).default === 'on').length;
  const problems = [];
  for (const file of ['README.md', 'site/index.html']) {
    const text = read(file);
    const find = (re) => [...text.matchAll(new RegExp(re, 'gi'))].map((x) => x[1]);
    const claims = [
      ['modules', find(`\\b${number}\\s+(?:sets of rules, called )?modules?\\b`), modules.length],
      ['rules', find(`\\b${number}\\s+rules\\b`), total],
      ['modules on by default', find(`\\b${number}\\s+(?:are on|of the \\w+ are on) unless`), onByDefault],
    ];
    for (const [what, stated, actual] of claims) {
      for (const s of stated) {
        if (num(s) !== actual) problems.push(`${file}: states ${s} ${what}, but the module directories give ${actual}`);
      }
    }
    if (file === 'site/index.html' && !find(`<strong>${number} modules, ${number} rules in all`).length) {
      problems.push(`${file}: the "<strong>N modules, N rules in all" line was not found`);
    }
    if (!find(`\\b${number}\\s+(?:sets of rules, called )?modules?\\b`).length) problems.push(`${file}: no module count found`);
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});
