import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dependabot scans .github/workflows only, so the scaffold templates adopters
// copy would otherwise drift behind the pins this repo's own workflows keep.
function pins(dir) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.yml'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/uses:\s*([\w.-]+\/[\w./-]+)@([0-9a-f]{40})\s*#\s*(\S+)/g)) {
      const [, action, sha, ver] = m;
      if (!out.has(action)) out.set(action, []);
      out.get(action).push({ file: f, sha, ver });
    }
  }
  return out;
}

test('template action pins match the SHA this repo workflows use', () => {
  const workflows = pins(join(ROOT, '.github/workflows'));
  const templates = pins(join(ROOT, 'plugins/house/templates'));
  assert.ok(templates.size > 0, 'no pinned actions found in templates');
  for (const [action, uses] of templates) {
    const theirs = workflows.get(action);
    if (!theirs) { console.log(`template pins ${action} but no workflow does; not checked`); continue; }
    const want = new Set(theirs.map((p) => p.sha));
    for (const u of uses) {
      assert.ok(want.has(u.sha), `${u.file}: ${action}@${u.sha} (${u.ver}) differs from workflows (${theirs[0].sha} ${theirs[0].ver})`);
    }
  }
});
