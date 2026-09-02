/**
 * scripts/lib/is-main.mjs
 *
 * isMain(importMetaUrl): true when the module that called it is the
 * process's entry point (was invoked directly, e.g. `node script.mjs`),
 * false when it was only `import`-ed by something else.
 *
 * WHY THIS EXISTS. The common one-liner guard
 *
 *   if (import.meta.url === `file://${process.argv[1]}`)
 *
 * silently no-ops -- exit 0, zero output, gate never ran -- under two
 * conditions reproduced empirically against this repo's own scripts:
 *
 *   1. Paths containing spaces or non-ASCII characters. `import.meta.url`
 *      percent-encodes them (a space becomes `%20`); the raw
 *      `` `file://${process.argv[1]}` `` template does not. The comparison
 *      then never matches, `main()` never runs, and the process exits 0
 *      having done nothing -- indistinguishable from a clean pass. A CI
 *      checkout under a directory with a space (or a scratch/worktree path
 *      that happens to contain one) hits this for free.
 *   2. Symlinked invocation. When the executed file is reached through a
 *      symlink (an npm bin shim, a wrapper script, a deliberately
 *      symlinked entry point), Node resolves `import.meta.url` to the
 *      REAL, de-symlinked path, but `process.argv[1]` is still the
 *      symlink path the shell was actually given. They diverge and the
 *      guard again silently no-ops.
 *
 * Both failures are worse than a crash: a CI gate that no-ops reports
 * success (exit 0, no output) rather than failure, which reads as "the
 * gate passed" instead of "the gate never ran".
 *
 * Fix: compare `import.meta.url` against BOTH the realpath'd `argv[1]`
 * and the literal `argv[1]`, each converted through `pathToFileURL` (which
 * applies the same percent-encoding `import.meta.url` already carries)
 * instead of a raw `file://` string template.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} importMetaUrl  the caller's `import.meta.url`
 * @returns {boolean}
 */
export function isMain(importMetaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;

  const literalUrl = pathToFileURL(argv1).href;

  let realUrl;
  try {
    realUrl = pathToFileURL(realpathSync(argv1)).href;
  } catch {
    // argv[1] doesn't resolve (e.g. doesn't exist on disk under this exact
    // spelling) -- fall back to the literal so the comparison below still
    // has something meaningful to check.
    realUrl = literalUrl;
  }

  return importMetaUrl === realUrl || importMetaUrl === literalUrl;
}
