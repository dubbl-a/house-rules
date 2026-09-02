import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson } from './helpers.mjs';

function workflow(cron) {
  return `name: scheduled\non:\n  schedule:\n    - cron: '${cron}'\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: []\n`;
}

test('minutes: a daily schedule stays under the default budget (warning-free)', () => {
  const dir = sandbox({ '.github/workflows/daily.yml': workflow('0 3 * * *') });
  const { code, out } = run(dir, ['--only=minutes']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /\[minutes\]/);
});

test('minutes: an every-5-minutes schedule blows the default budget (advisory warning, exit 0)', () => {
  const dir = sandbox({ '.github/workflows/hot.yml': workflow('*/5 * * * *') });
  const { code, out } = run(dir, ['--only=minutes']);
  assert.equal(code, 0, out); // advisory only
  assert.match(out, /\[minutes\]/);
  assert.match(out, /\(warning\)/);
});

test('minutes: actionsBudgetMinutes is configurable', () => {
  const dir = sandbox({
    '.github/workflows/daily.yml': workflow('0 3 * * *'),
    'house.json': houseJson({ modules: { github: { enabled: true, config: { actionsBudgetMinutes: 10 } } } }),
  });
  const { code, out } = run(dir, ['--only=minutes']);
  assert.equal(code, 0, out); // still advisory, exit 0
  assert.match(out, /\[minutes\]/); // but now over the tighter 10-minute budget
});

test('minutes: no scheduled workflows at all is silent', () => {
  const dir = sandbox({ '.github/workflows/pr.yml': "name: pr\non: pull_request\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: []\n" });
  const { code, out } = run(dir, ['--only=minutes']);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /\[minutes\]/);
});
