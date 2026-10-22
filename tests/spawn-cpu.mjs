// spawnCpuSync(cmd, args, opts): spawnSync, plus `cpuMs`, the CPU milliseconds
// (user + system) the command and everything it ran used. Not a test file: the
// npm test glob matches *.test.mjs only.
//
// Timing cases bound CPU, not wall time (#422): `npm run verify` runs suites
// side by side, and on a loaded machine a command that needs 300 ms of CPU
// waits long enough to fail a wall bound with nothing wrong (the same lesson
// as #381, which moved tests/hooks/run.sh to CPU). spawnSync reports no child
// usage and process.cpuUsage() covers this process only, so the command runs
// under bash, whose `times` builtin reports the CPU of its finished children
// and exists on macOS and Linux alike. The two `times` lines are cut from
// stderr, so callers see the command's own.

import { spawnSync } from 'node:child_process';

export function spawnCpuSync(cmd, args, opts = {}) {
  // LC_ALL=C: `times` prints a comma decimal in some locales.
  const env = { ...(opts.env ?? process.env), LC_ALL: 'C' };
  const res = spawnSync('bash', ['-c', '"$@"; rc=$?; times >&2; exit $rc', 'bash', cmd, ...args], { ...opts, env });
  const lines = String(res.stderr ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const children = lines.pop() ?? ''; // "<m>m<s>.<mmm>s <m>m<s>.<mmm>s": user, system
  lines.pop(); // the bash shell's own usage
  const parts = [...children.matchAll(/(\d+)m(\d+)\.(\d+)s/g)];
  if (parts.length !== 2) throw new Error(`could not read the CPU time from bash \`times\`: ${JSON.stringify(children)}`);
  const cpuMs = parts.reduce((sum, [, m, s, frac]) => sum + (Number(m) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, '0').slice(0, 3)), 0);
  const stderr = lines.length ? lines.join('\n') + '\n' : '';
  return { ...res, stderr, cpuMs };
}
