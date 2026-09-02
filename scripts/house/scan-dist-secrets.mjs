#!/usr/bin/env node
// scripts/house/scan-dist-secrets.mjs
//
// Second, independent layer against a secret reaching a published static
// build output. Scans the built output directory for secret material and
// fails if it finds any, regardless of whether env-stripping earlier in the
// build missed something.
//
// Markers:
//   - every value in a vars file (--vars-file=<path>, default .dev.vars) that
//     is at least MIN_MARKER_LENGTH characters. Values that parse as a URL
//     (a connection string) also contribute their password and hostname as
//     separate markers, so a reformatted or partially interpolated
//     connection string still trips the scan.
//   - unconditional patterns that need no vars file at all, so the scan
//     still means something with no secrets configured (a fresh worktree,
//     most of CI): postgres://, postgresql://, sk-ant-.
//   - extra patterns supplied by the caller, so this file never needs
//     editing to add a project-specific marker (see --patterns / env below).
//
// Usage:
//   node scan-dist-secrets.mjs [--dist-dir=dist] [--vars-file=.dev.vars]
//                               [--patterns=path/to/patterns.json]
//   node scan-dist-secrets.mjs --self-test
//
// Extra patterns, two ways (composable, both optional):
//   --patterns=<path>            JSON file: an array of either plain strings
//                                 or {"name": "...", "value": "..."} objects.
//   SCAN_DIST_SECRETS_PATTERNS   comma-separated literal substrings in an
//                                 env var, for a one-off addition with no file.
//
// A hit prints the offending file path and the marker's NAME (the vars-file
// key, e.g. "DATABASE_URL:password", or the literal pattern, e.g.
// "postgres://") — never the value that matched.

import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// This file is vendored to <repo>/scripts/house/scan-dist-secrets.mjs, two
// directories below the repo root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIN_MARKER_LENGTH = 8;

const UNCONDITIONAL_PATTERNS = [
  { name: 'postgres://', value: 'postgres://' },
  { name: 'postgresql://', value: 'postgresql://' },
  { name: 'sk-ant-', value: 'sk-ant-' },
];

// Build {name, value} markers from a .dev.vars-style file. Values under the
// length floor are skipped — they're too short to be a real credential and
// too likely to false-positive against ordinary page text.
function markersFromVarsFile(varsPath) {
  if (!existsSync(varsPath)) return [];
  const parsed = parseEnv(readFileSync(varsPath, 'utf8'));
  const markers = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (!value || value.length < MIN_MARKER_LENGTH) continue;
    markers.push({ name, value });
    try {
      const url = new URL(value);
      // Same length floor as the raw value — a one- or two-character
      // password/hostname isn't a usable marker, it's a false-positive
      // generator (it'll match arbitrary built output by coincidence).
      if (url.password && url.password.length >= MIN_MARKER_LENGTH) {
        markers.push({ name: `${name}:password`, value: url.password });
      }
      if (url.hostname && url.hostname.length >= MIN_MARKER_LENGTH) {
        markers.push({ name: `${name}:hostname`, value: url.hostname });
      }
    } catch {
      // Not a URL — the raw-value marker above already covers it.
    }
  }
  return markers;
}

// Extra markers from --patterns=<file> (array of strings and/or
// {name,value} objects) and/or SCAN_DIST_SECRETS_PATTERNS (comma-separated
// literal substrings). Both optional, both composable with the built-ins.
function markersFromConfig(patternsFile, envValue) {
  const markers = [];
  if (patternsFile) {
    if (!existsSync(patternsFile)) {
      throw new Error(`--patterns file not found: ${patternsFile}`);
    }
    const parsed = JSON.parse(readFileSync(patternsFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`--patterns file must contain a JSON array: ${patternsFile}`);
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        if (entry.length >= MIN_MARKER_LENGTH) markers.push({ name: entry, value: entry });
      } else if (entry && typeof entry === 'object' && typeof entry.value === 'string') {
        if (entry.value.length >= MIN_MARKER_LENGTH) {
          markers.push({ name: typeof entry.name === 'string' ? entry.name : entry.value, value: entry.value });
        }
      }
    }
  }
  if (envValue) {
    for (const raw of envValue.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (raw.length >= MIN_MARKER_LENGTH) markers.push({ name: raw, value: raw });
    }
  }
  return markers;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else if (st.isFile()) out.push(abs);
  }
  return out;
}

// Returns { hit: boolean, files: number }. Stops at the first hit — one leak
// is enough to fail the build, and we never want to accumulate matched
// values in memory or output.
export function scan(distDir, markers) {
  const files = walk(distDir);
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable as text — skip rather than crash the scan
    }
    for (const marker of markers) {
      if (text.includes(marker.value)) {
        console.error(`scan-dist-secrets: LEAK — ${file} contains marker "${marker.name}"`);
        return { hit: true, files: files.length };
      }
    }
  }
  return { hit: false, files: files.length };
}

// Proves the scanner itself works: plant a known canary in a throwaway
// directory and confirm detection fires. Runnable anywhere, no real secrets
// needed — this is what CI can run alongside the real scan.
function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-dist-secrets-selftest-'));
  const marker = { name: 'SELF_TEST_CANARY', value: 'zz_self_test_canary_0000000000' };
  try {
    writeFileSync(join(dir, 'index.html'), `<html>${marker.value}</html>`);
    const result = scan(dir, [marker]);
    if (result.hit) {
      console.log('scan-dist-secrets: self-test OK — planted canary was detected');
      process.exit(0);
    }
    console.error('scan-dist-secrets: self-test FAILED — planted canary was not detected');
    process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  runSelfTest();
} else {
  const varsArg = args.find((a) => a.startsWith('--vars-file='));
  const varsFile = varsArg ? resolve(ROOT, varsArg.slice('--vars-file='.length)) : join(ROOT, '.dev.vars');

  const distArg = args.find((a) => a.startsWith('--dist-dir='));
  const distDir = distArg ? resolve(ROOT, distArg.slice('--dist-dir='.length)) : join(ROOT, 'dist');

  const patternsArg = args.find((a) => a.startsWith('--patterns='));
  const patternsFile = patternsArg ? resolve(ROOT, patternsArg.slice('--patterns='.length)) : null;

  if (!existsSync(distDir)) {
    console.error(`scan-dist-secrets: ${distDir} does not exist — run the build first`);
    process.exit(1);
  }

  const markers = [
    ...markersFromVarsFile(varsFile),
    ...markersFromConfig(patternsFile, process.env.SCAN_DIST_SECRETS_PATTERNS),
    ...UNCONDITIONAL_PATTERNS,
  ];
  const result = scan(distDir, markers);
  if (result.hit) process.exit(1);
  console.log(`scan-dist-secrets: clean — ${result.files} file(s), ${markers.length} marker(s) checked`);
  process.exit(0);
}
