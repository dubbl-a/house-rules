import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, run, houseJson, fakeClaudeConfigDir } from './helpers.mjs';

test('behind: installed version newer than the pin is a warning (exit 0)', () => {
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: '/x', version: '0.3.0' }] },
  });
  const dir = sandbox({ 'house.json': houseJson({ version: '0.1.0' }) });
  const { code, out } = run(dir, ['--only=behind'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 0, out);
  assert.match(out, /\[behind\]/);
  assert.match(out, /\(warning\)/);
});

test('behind: installed version equal to the pin — no warning', () => {
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: '/x', version: '0.1.0' }] },
  });
  const dir = sandbox({ 'house.json': houseJson({ version: '0.1.0' }) });
  const { code, out } = run(dir, ['--only=behind'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /\[behind\]/);
});

test('behind: installed version "unknown" stays silent', () => {
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: { 'house-rules@house-rules': [{ scope: 'user', installPath: '/x', version: 'unknown' }] },
  });
  const dir = sandbox({ 'house.json': houseJson({ version: '0.1.0' }) });
  const { code, out } = run(dir, ['--only=behind'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /\[behind\]/);
});

test('behind: installed_plugins.json missing stays silent', () => {
  const dir = sandbox({ 'house.json': houseJson({ version: '0.1.0' }) });
  const { code, out } = run(dir, ['--only=behind'], { CLAUDE_CONFIG_DIR: '/definitely/does/not/exist' });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /\[behind\]/);
});

test('behind: prefers the scope=="user" record over other scopes', () => {
  const cfgDir = fakeClaudeConfigDir({
    version: 2,
    plugins: {
      'house-rules@house-rules': [
        { scope: 'project', installPath: '/x', version: '9.9.9' },
        { scope: 'user', installPath: '/x', version: '0.1.0' },
      ],
    },
  });
  const dir = sandbox({ 'house.json': houseJson({ version: '0.1.0' }) });
  const { code, out } = run(dir, ['--only=behind'], { CLAUDE_CONFIG_DIR: cfgDir });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /\[behind\]/); // user-scope 0.1.0 == pin, not the project-scope 9.9.9
});
