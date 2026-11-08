#!/usr/bin/env python3
# How skewed main-session cost is over the last 30 days: percentiles, the top
# decile's share, and how often a "$5 and unusual for this account" test would
# fire. Read-only; reuses the loader and prices in subagent_cuts.py. Run with
# python3 -I. Each main transcript file counts as one session; list-price estimates.
import importlib.util, time
from pathlib import Path

spec = importlib.util.spec_from_file_location('cuts', Path(__file__).with_name('subagent_cuts.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
root = Path.home() / '.claude' / 'projects'
since = time.time() - 30 * 86400
seen = {}
for p in root.rglob('*.jsonl'):
    rel = p.relative_to(root).parts
    if 'subagents' in rel or p.stat().st_mtime < since:
        continue
    reqs = c.load(str(p), rel)[0]
    for k, r in reqs.items():
        if r['ts'] and r['ts'] >= since and r['kind'] == 'main':
            if k not in seen or r['out'] > seen[k]['out']:
                seen[k] = r
by = {}
for r in seen.values():
    by[r['file']] = by.get(r['file'], 0) + c.cost_of(r)
xs = sorted(by.values())
tot = sum(xs)
print('sessions', len(xs), 'main total', round(tot, 2))
for q in (.25, .5, .75, .9, .95, .99):
    print('p%d' % (q * 100), round(c.pct(xs, q), 2))
print('max', round(xs[-1], 2), 'mean', round(tot / len(xs), 2))
n = len(xs)
print('top 10%% share %.1f%%' % (100 * sum(xs[-max(1, n // 10):]) / tot))
for t in (5, 20, 50):
    print('sessions over $%d: %d (%.0f%%)' % (t, sum(x > t for x in xs), 100 * sum(x > t for x in xs) / n))
for q in (.9, .95):
    t = max(5, c.pct(xs, q))
    print('past $5 and over p%d ($%.2f): %d sessions, %.1f%% of main cost' % (q * 100, t, sum(x > t for x in xs), 100 * sum(x for x in xs if x > t) / tot))
