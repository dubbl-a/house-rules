#!/usr/bin/env python3
# Where subagent 5-minute cache-write dollars go after an agent's first request: expired-cache
# rebuilds (gap over 5 minutes to the previous request in the same file) versus growth within a
# live cache, split by tokens written. Read-only; reuses the loader and prices in subagent_cuts.py.
# Run with python3 -I. Prints aggregates only (no prompt text, paths or project names).
#
#   python3 -I midrun_writes.py [--days 30] [--dir ~/.claude/projects]
#
# Assumptions the numbers depend on:
#  - Dollars are list-price estimates of 5-minute cache writes only (w5 x the model's 5m write price,
#    fast and US factors included), the same quantity as the "5-minute TTL" subagent figure in
#    subagent_cuts.py. 1-hour writes (w1) are not split here; their total is printed for context.
#  - Requests are deduped by message id plus request id across all files, keeping the highest output,
#    as in subagent_cuts.py. A request counts when its timestamp is inside the window.
#  - Each transcript file is one agent. Its requests are sorted by timestamp; "first request" is the
#    earliest, "gap" is the time since the previous request in that file, whatever its model. A file
#    whose first request predates the window has no first-request bucket in the window.
#  - Agent tool, workflow and "other sidechain" (isSidechain outside a subagents folder) follow the
#    loader's kind. Agent type comes from the agent's meta sidecar; types other than built-ins and
#    house-rules: ones are pooled as "(custom, other)".
#  - Turn count = deduped requests in the agent's file. The turn-count table covers agents whose first
#    request is inside the window, so every turn is observable; it sums later-request write dollars
#    in the window.
#  - "Under 5k / 5k to 20k / over 20k" bands use the request's own 5-minute write tokens.
import argparse, collections, glob, importlib.util, os, time
from pathlib import Path

spec = importlib.util.spec_from_file_location('cuts', Path(__file__).with_name('subagent_cuts.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

EXPIRY = 300            # seconds: the 5-minute cache lifetime
BANDS = [('under 5k', 5000), ('5k to 20k', 20000), ('over 20k', None)]
KINDS = [('agent', 'Agent tool'), ('workflow', 'workflow'), ('sidechain', 'other sidechain')]
TURN_BANDS = [('under 10 turns', 0, 10), ('10 to 30 turns', 10, 31), ('over 30 turns', 31, 10 ** 9)]


def w5_cost(r):
    p = c.price_row(r)
    return 0.0 if not p else r['w5'] * p[1] / 1e6


def w1_cost(r):
    p = c.price_row(r)
    return 0.0 if not p else r['w1'] * p[2] / 1e6


def bucket(r, prev_ts):
    """Bucket name for one request; prev_ts None means the first request in its file."""
    if prev_ts is None:
        return 'first'
    if r['ts'] - prev_ts > EXPIRY:
        return 'expired'
    for name, hi in BANDS:
        if hi is None or r['w5'] < hi:
            return 'live ' + name


def money(x):
    return '$%.3f' % x if abs(x) < 1 else '$%.2f' % x


def dist3(xs):
    if not xs:
        return 'n=0'
    q = lambda p: c.pct(xs, p)
    return 'n=%d p25 %s median %s p75 %s p90 %s max %s' % (len(xs), money(q(.25)), money(q(.5)), money(q(.75)), money(q(.9)), money(max(xs)))


def main():
    base = os.environ.get('CLAUDE_CONFIG_DIR') or str(Path.home() / '.claude')
    ap = argparse.ArgumentParser(description='Split subagent 5-minute cache-write dollars after the first request.')
    ap.add_argument('--days', type=float, default=30)
    ap.add_argument('--dir', default=os.path.join(base, 'projects'))
    a = ap.parse_args()
    root = os.path.expanduser(a.dir)
    since = time.time() - a.days * 86400
    files = [f for f in glob.glob(os.path.join(root, '**', '*.jsonl'), recursive=True) if os.path.getmtime(f) >= since]
    best = {}
    for f in files:
        for k, r in c.load(f, Path(os.path.relpath(f, root)).parts)[0].items():
            if k not in best or r['out'] > best[k]['out']:
                best[k] = r
    by_file = collections.defaultdict(list)
    for r in best.values():
        if r['kind'] != 'main' and r['ts'] is not None and r['model'] in c.PRICES:
            by_file[r['file']].append(r)

    # tot[kind][bucket] = [dollars, requests]; big[(bucket, type, model)] = [requests, set(agents), dollars]
    tot = {k: collections.defaultdict(lambda: [0.0, 0]) for k, _ in KINDS}
    big = collections.defaultdict(lambda: [0, set(), 0.0])
    per_agent = collections.defaultdict(list)   # (kind, turn band) -> [(later-request write dollars, later requests)]
    all_w5 = all_w1 = 0.0
    for f, recs in by_file.items():
        recs.sort(key=lambda r: r['ts'])
        kind = recs[0]['kind']
        atype = c.label_type(c.read_meta(f).get('agentType') or '(none)') if kind != 'sidechain' else '(no meta)'
        prev, later_usd, later_n = None, 0.0, 0
        for r in recs:
            if r['ts'] >= since:
                b = bucket(r, prev)
                d = w5_cost(r)
                t = tot[kind][b]
                t[0] += d
                t[1] += 1
                all_w5 += d
                all_w1 += w1_cost(r)
                if b in ('live 5k to 20k', 'live over 20k'):
                    g = big[(b, atype, r['model'], kind)]
                    g[0] += 1
                    g[1].add(f)
                    g[2] += d
                if prev is not None:
                    later_usd += d
                    later_n += 1
            prev = r['ts']
        if recs[0]['ts'] >= since:
            per_agent[(kind, len(recs))].append((later_usd, later_n))

    names = ['first', 'expired', 'live under 5k', 'live 5k to 20k', 'live over 20k']
    labels = {'first': 'first request', 'expired': 'later, gap over 5 min (expired-cache rebuild)',
              'live under 5k': 'later, gap 5 min or under, writes under 5k', 'live 5k to 20k': 'later, gap 5 min or under, writes 5k to 20k',
              'live over 20k': 'later, gap 5 min or under, writes over 20k'}
    print('Subagent 5-minute cache-write dollars after the first request, last %g days (list-price estimates; aggregates only).' % a.days)
    print('Files read: %d; subagent files with a priced request: %d' % (len(files), len(by_file)))
    grand = 0.0
    for k, label in KINDS:
        sub = sum(v[0] for v in tot[k].values())
        grand += sub
        print('\n%s: %s over %d requests' % (label, money(sub), sum(v[1] for v in tot[k].values())))
        for n in names:
            d, q = tot[k][n]
            print('  %-50s %10s  %5.1f%%  %7d requests' % (labels[n], money(d), 100 * d / sub if sub else 0, q))
    print('\nAll subagent kinds')
    for n in names:
        d = sum(tot[k][n][0] for k, _ in KINDS)
        print('  %-50s %10s  %5.1f%%' % (labels[n], money(d), 100 * d / grand if grand else 0))
    print('Total subagent 5-minute write dollars (sum of buckets): %s; direct sum over requests: %s; difference %s' % (
        money(grand), money(all_w5), money(abs(grand - all_w5))))
    print('For context, 1-hour subagent write dollars (not split here): %s' % money(all_w1))

    for b in ('live 5k to 20k', 'live over 20k'):
        rows = sorted(((k, v) for k, v in big.items() if k[0] == b), key=lambda kv: -kv[1][2])
        print('\nBand "%s" by kind, agent type and model (%d groups, top 15; %s total):' % (labels[b], len(rows), money(sum(v[2] for _, v in rows))))
        for (_, atype, model, kind), (n, ag, d) in rows[:15]:
            print('  %-16s %-26s %-20s %6d requests %5d agents %10s' % (dict(KINDS)[kind], atype, model, n, len(ag), money(d)))
        rest = rows[15:]
        if rest:
            print('  (remaining %d groups: %d requests, %s)' % (len(rest), sum(v[0] for _, v in rest), money(sum(v[2] for _, v in rest))))

    print('\nLater-request write dollars per agent by turn count (agents whose first request is in the window):')
    for k, label in KINDS:
        for name, lo, hi in TURN_BANDS:
            rows = [x for (kk, turns), xs in per_agent.items() if kk == k and lo <= turns < hi for x in xs]
            if not rows:
                continue
            usd = [d for d, _ in rows]
            n = sum(q for _, q in rows)
            print('  %-16s %-15s agents %5d; total %s; per agent %s; per later request %s' % (
                label, name, len(rows), money(sum(usd)), dist3(usd), money(sum(usd) / n) if n else 'n/a'))
    print('Reading the table: a rising per-agent median with turn count is expected from more requests alone; the per-later-request')
    print('figure shows whether each extra turn also writes more.')
    print('Assumptions: see the header of this script (gap to the previous request in the file; 5-minute writes only; list prices).')


if __name__ == '__main__':
    main()
