#!/usr/bin/env node
// release-latest.mjs: decide whether the release being published should be
// marked Latest. Reads the JSON of GET /repos/{owner}/{repo}/releases on stdin
// (fetched with `gh api --paginate --slurp`, so an array of page arrays; a
// plain array is accepted too) and takes the candidate version (X.Y.Z, no
// leading v) as its argument. Prints one of: true | false.
//
//   true   no published release is higher than the candidate
//   false  a published release has a higher version, so this one is a re-run
//          of an older run and must not take Latest from it
//
// Only published releases tagged plain vX.Y.Z count: drafts, prereleases, and
// any other tag are ignored. Versions compare numerically (0.22.10 > 0.22.9).
//
// Exit 1, printing nothing, when stdin is not a releases response or the
// argument is not X.Y.Z.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(version) {
  const m = PLAIN.exec(version);
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function isLatest(version, body) {
  const candidate = parts(version);
  if (!candidate) throw new Error(`version "${version}" is not X.Y.Z`);
  if (!Array.isArray(body)) throw new Error('no releases array');
  const releases = body.flatMap((x) => (Array.isArray(x) ? x : [x]));
  for (const r of releases) {
    if (!r || typeof r !== 'object') throw new Error('release entry is not an object');
    if (r.draft || r.prerelease || typeof r.tag_name !== 'string') continue;
    if (!r.tag_name.startsWith('v')) continue;
    const other = parts(r.tag_name.slice(1));
    if (other && compare(other, candidate) > 0) return false;
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(String(isLatest(process.argv[2] ?? '', JSON.parse(readFileSync(0, 'utf8')))));
  } catch (e) {
    console.error(`release-latest: ${e.message}`);
    process.exit(1);
  }
}
