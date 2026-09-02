#!/usr/bin/env node
// Traceability gate: every harvested practice landed somewhere real, exactly once.
// Reads docs/handbook/inventory.md + docs/handbook/manifest.json + the module rule
// files (+ handbook chapters unless --no-chapters). Exit 1 on findings.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const noChapters = process.argv.includes('--no-chapters');
const f = [];
const fail = (m) => f.push(m);

const inv = readFileSync(join(ROOT, 'docs/handbook/inventory.md'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/handbook/manifest.json'), 'utf8'));

// ── parse rows ──────────────────────────────────────────────────────
const DISP = new Set(['port', 'generalize', 'cross-ref', 'fold', 'handbook-only', 'drop']);
const rows = [];
for (const line of inv.split('\n')) {
  const m = line.match(/^\|\s*((?:TW|AG|AS|SB|RT|MEM|EXT|PA)-\d{3})\s*\|(.*)\|\s*(port|generalize|cross-ref|fold|handbook-only|drop)\s*\|\s*(.*?)\s*\|\s*$/);
  if (!m) continue;
  const cells = m[2].split('|');
  rows.push({ id: m[1], source: cells[0].trim(), practice: cells.slice(1).join('|').trim(), disp: m[3], dest: m[4] });
}
if (rows.length < 400) fail(`only ${rows.length} inventory rows parsed; expected the full table`);
const byId = new Map(rows.map(r => [r.id, r]));
const dupIds = rows.map(r => r.id).filter((id, i, a) => a.indexOf(id) !== i);
for (const d of new Set(dupIds)) fail(`duplicate inventory id ${d}`);

// ── slug helpers ────────────────────────────────────────────────────
const slug = (h) => h.toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
const ruleHeadings = new Map(); // 'docs.md' -> Set(slugs)
const modulesDir = join(ROOT, 'plugins/house/modules');
for (const mod of readdirSync(modulesDir)) {
  const rulesDir = join(modulesDir, mod, 'rules');
  if (!existsSync(rulesDir)) continue;
  for (const rf of readdirSync(rulesDir).filter(x => x.endsWith('.md'))) {
    const set = new Set();
    for (const line of readFileSync(join(rulesDir, rf), 'utf8').split('\n')) {
      const h = line.match(/^##\s+(.*)/);
      if (h && h[1].trim() !== "Don't") set.add(slug(h[1]));
    }
    ruleHeadings.set(rf, set);
  }
}

// ── destination checks ──────────────────────────────────────────────
const portsPerHeading = new Map(); // 'docs.md#slug' -> [ids]
for (const r of rows) {
  if (r.disp === 'drop') {
    if (!r.practice.includes(';')) fail(`${r.id}: drop without a semicolon reason`);
    continue;
  }
  if (['port', 'generalize', 'fold'].includes(r.disp)) {
    const rm = r.dest.match(/^rule:([a-z-]+\.md)#([a-z0-9-]+)$/);
    const om = r.dest.match(/^(script|template|skill|adr|eval|chapter):(\S+)$/) || (r.dest.trim() === 'schema' ? ['', 'schema', 'house.schema.json'] : null);
    if (rm) {
      const [, file, sl] = rm;
      if (!ruleHeadings.has(file)) { fail(`${r.id}: unknown rule file ${file}`); continue; }
      if (!ruleHeadings.get(file).has(sl)) fail(`${r.id}: no heading slug "${sl}" in ${file}`);
      if (r.disp === 'port') {
        const k = `${file}#${sl}`;
        portsPerHeading.set(k, (portsPerHeading.get(k) || []).concat(r.id));
      }
    } else if (om) {
      const [, kind, name] = om;
      const base = name.replace(/^.*\//, '');
      const dirs = { script: ['plugins/house/hooks', 'plugins/house/payload', 'plugins/house/scripts', 'scripts', 'tests', 'tests/hooks', 'plugins/house/modules'], template: ['plugins/house/templates'], skill: ['plugins/house/skills'], schema: ['plugins/house/schema'], adr: ['docs/decisions'], eval: ['plugins/house/evals'], chapter: ['docs/handbook'] };
      const found = (dirs[kind] || []).some(d => {
        const abs = join(ROOT, d);
        if (!existsSync(abs)) return false;
        const walk = (dd) => readdirSync(dd, { withFileTypes: true }).some(e => e.isDirectory() ? (kind === 'skill' && e.name === base) || walk(join(dd, e.name)) : (e.name === base || e.name.startsWith(base + '.') || (kind === 'adr' && e.name.startsWith(base))));
        return walk(abs);
      });
      if (!found && kind === 'script' && ['hook-tests', 'check.mjs', 'render', 'house-cli', 'house'].includes(base)) { /* known aggregate names */ }
      else if (!found && !(noChapters && kind === 'chapter')) fail(`${r.id}: ${kind} destination "${name}" not found on disk`);
    } else {
      fail(`${r.id}: ${r.disp} destination unparseable: "${r.dest}"`);
    }
  } else if (r.disp === 'cross-ref') {
    const m = r.dest.match(/->\s*((?:TW|AG|AS|SB|RT|MEM|EXT|PA)-\d{3})/);
    if (!m) { fail(`${r.id}: cross-ref without a target id: "${r.dest}"`); continue; }
    const t = byId.get(m[1]);
    if (!t) fail(`${r.id}: cross-ref target ${m[1]} does not exist`);
    else if (!['port', 'generalize', 'fold'].includes(t.disp)) fail(`${r.id}: cross-ref target ${m[1]} is ${t.disp}, not canonical`);
  } else if (r.disp === 'handbook-only') {
    if (!noChapters) {
      const cm = r.dest.match(/^chapter:([a-z-]+)$/);
      const fm = r.dest.match(/([a-z-]+\.md)/);
      const file = cm ? `${cm[1]}.md` : fm ? fm[1] : null;
      if (!file || !existsSync(join(ROOT, 'docs/handbook', file))) fail(`${r.id}: handbook-only destination missing: "${r.dest}"`);
    }
  }
}
for (const [k, ids] of portsPerHeading) if (ids.length > 1) fail(`heading ${k} has ${ids.length} port rows: ${ids.join(', ')}`);
for (const [file, set] of ruleHeadings) for (const sl of set) {
  if (![...portsPerHeading.keys()].includes(`${file}#${sl}`)) fail(`orphan heading with zero inbound port rows: ${file}#${sl}`);
}

// ── manifest owns() union ───────────────────────────────────────────
const owned = new Map();
for (const a of manifest.artifacts) for (const id of (a.owns || [])) {
  owned.set(id, (owned.get(id) || []).concat(a.path));
}
for (const r of rows) {
  if (['port', 'generalize', 'fold', 'handbook-only'].includes(r.disp)) {
    const o = owned.get(r.id) || [];
    if (o.length === 0) fail(`${r.id} (${r.disp}) owned by no manifest artifact`);
    if (o.length > 1) fail(`${r.id} owned by ${o.length} artifacts: ${o.join(', ')}`);
  }
}

if (f.length) {
  console.error(`traceability: ${f.length} finding(s)`);
  for (const m of f) console.error('  ' + m);
  process.exit(1);
}
console.log(`traceability: OK (${rows.length} rows, ${ruleHeadings.size} rule files, ${portsPerHeading.size} ported headings${noChapters ? ', chapters skipped' : ''})`);
