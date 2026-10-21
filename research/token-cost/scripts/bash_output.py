"""Share of list-price cost that comes from tool output, mainly Bash, over a window.

Model: a tool result of T tokens (chars / 4) enters context at the next request
(paid at that request's cache-write price, blended by its 5m/1h split) and is read
from cache at every later request in the same file at that request's read price,
until a compaction boundary or the end of the file. Total cost is computed as
plugins/house/scripts/cost-report.mjs does (same prices, dedupe, window).

    python3 -I bash_output.py [--days 30] [--dir ~/.claude/projects]

Prints counts and first words of commands only, never transcript content.
"""
import argparse, collections, glob, json, os, time
from datetime import datetime

# Copied from PRICES in plugins/house/scripts/cost-report.mjs (2026-10-20).
# Per MTok: input, 5m cache write, 1h cache write, cache read, output.
PRICES = {
    'claude-fable-5-1': (10, 12.5, 20, 0.25, 50), 'claude-fable-5': (10, 12.5, 20, 1, 50),
    'claude-opus-5-5': (4, 5, 8, 0.2, 20), 'claude-opus-5': (5, 6.25, 10, 0.5, 25),
    'claude-opus-4-8': (5, 6.25, 10, 0.5, 25), 'claude-sonnet-5-5': (2, 2.5, 4, 0.1, 10),
    'claude-sonnet-5': (2, 2.5, 4, 0.2, 10), 'claude-haiku-5-5': (0.1, 0.125, 0.2, 0.01, 0.5),
}
HAIKU_LONG = ('claude-haiku-5-5', 100000, (0.5, 0.625, 1, 0.05, 2.5))
FAST = {'claude-opus-5-5': 2, 'claude-opus-5': 2, 'claude-opus-4-8': 2}
US_FACTOR = 1.1
BUCKETS = ('<2k', '2k-5k', '5k-10k', '>10k')  # Bash output is capped near 30k chars, about 7.5k tokens


def price_row(r):
    p = PRICES.get(r['model'])
    if not p:
        return None
    if r['model'] == HAIKU_LONG[0] and r['in'] + r['w5'] + r['w1'] + r['read'] > HAIKU_LONG[1]:
        p = HAIKU_LONG[2]
    f = FAST.get(r['model'], 1) if r['speed'] == 'fast' else 1
    if r['geo'] == 'us':
        f *= US_FACTOR
    return [x * f for x in p]


def cost_of(r):
    p = price_row(r)
    return 0 if not p else (r['in'] * p[0] + r['w5'] * p[1] + r['w1'] * p[2] + r['read'] * p[3] + r['out'] * p[4]) / 1e6


def bucket(t):
    return BUCKETS[0] if t < 2000 else BUCKETS[1] if t < 5000 else BUCKETS[2] if t <= 10000 else BUCKETS[3]


def text_chars(c):
    if isinstance(c, str):
        return len(c)
    if isinstance(c, list):
        return sum(len(b.get('text') or '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
    return 0


def load(path):
    """One pass over a file: ordered unique request keys with best usage, tool uses, results."""
    reqs, order, uses, events = {}, [], {}, []  # events: ('req', key) | ('res', id, chars) | ('cut',)
    n = 0
    for line in open(path, errors='replace'):
        try:
            e = json.loads(line)
        except Exception:
            continue
        t, m = e.get('type'), e.get('message')
        if t == 'system' and e.get('subtype') == 'compact_boundary' or e.get('isCompactSummary'):
            events.append(('cut',))
        if not isinstance(m, dict):
            continue
        ct = m.get('content')
        if t == 'assistant':
            if isinstance(ct, list):
                for b in ct:
                    if isinstance(b, dict) and b.get('type') == 'tool_use':
                        inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                        cmd = (inp.get('command') or '').split()
                        uses[b.get('id')] = (b.get('name') or '?', cmd[0].rsplit('/', 1)[-1] if cmd else '')
            u = m.get('usage')
            if not u or m.get('model') == '<synthetic>':
                continue
            cc = u.get('cache_creation') or {}
            cw = u.get('cache_creation_input_tokens') or 0
            w1 = cc.get('ephemeral_1h_input_tokens') or 0
            rec = dict(file=path, model=m.get('model'), ts=e.get('timestamp') or '', out=u.get('output_tokens') or 0,
                       **{'in': u.get('input_tokens') or 0}, w5=cw - w1, w1=w1, read=u.get('cache_read_input_tokens') or 0,
                       speed=u.get('speed'), geo=u.get('inference_geo'), sub=e.get('isSidechain') is True)
            key = (m.get('id'), e.get('requestId')) if m.get('id') or e.get('requestId') else (path, n)
            n += 1
            if key not in reqs:
                order.append(key)
                events.append(('req', key))
            if key not in reqs or rec['out'] > reqs[key]['out']:
                reqs[key] = rec
        elif t == 'user' and isinstance(ct, list):
            for b in ct:
                if isinstance(b, dict) and b.get('type') == 'tool_result':
                    events.append(('res', b.get('tool_use_id'), text_chars(b.get('content'))))
    return reqs, uses, events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=float, default=30)
    ap.add_argument('--dir', default=os.path.expanduser('~/.claude/projects'))
    a = ap.parse_args()
    since = time.time() - a.days * 86400
    files = [f for f in glob.glob(a.dir + '/**/*.jsonl', recursive=True) if os.path.getmtime(f) >= since]
    loaded = {f: load(f) for f in files}
    best = {}  # global dedupe, as cost-report: keep the copy with the most output
    for f, (reqs, _, _) in loaded.items():
        for k, r in reqs.items():
            r['sub'] = r['sub'] or '/subagents/' in f
            if k not in best or r['out'] > best[k]['out']:
                best[k] = r
    since_iso = datetime.utcfromtimestamp(since).strftime('%Y-%m-%dT%H:%M:%S')
    inwin = lambda r: r['ts'] >= since_iso
    total, tot_thread = 0.0, collections.Counter()
    for r in best.values():
        if inwin(r):
            c = cost_of(r)
            total += c
            tot_thread['sub' if r['sub'] else 'main'] += c
    # Attribution: group = (kind, bucket) where kind is 'Bash' or 'Other'.
    cost = collections.Counter()   # (thread, kind, bucket) -> usd
    count = collections.Counter()  # (kind, bucket) -> results entering in window
    toks = collections.Counter()
    cuts = 0
    words = collections.Counter()  # (bucket, first word) -> results
    word_cost = collections.Counter()
    for f, (reqs, uses, events) in loaded.items():
        active = collections.Counter()  # (kind, bucket, word) -> tokens in context
        pending = []
        for ev in events:
            if ev[0] == 'cut':
                cuts += 1
                active.clear()
            elif ev[0] == 'res':
                name, word = uses.get(ev[1], ('?', ''))
                tk = ev[2] / 4
                pending.append((('Bash' if name == 'Bash' else 'Other', bucket(tk), word if name == 'Bash' else ''), tk))
            else:
                r = reqs[ev[1]]
                owner = best[ev[1]] is r and inwin(r)
                p = price_row(r)
                thread = 'sub' if r['sub'] else 'main'
                if owner and p:
                    for (kind, b, w), tk in active.items():
                        c = tk * p[3] / 1e6
                        cost[(thread, kind, b)] += c
                        if kind == 'Bash':
                            word_cost[(b, w)] += c
                    wt = r['w5'] + r['w1']
                    wp = (r['w5'] * p[1] + r['w1'] * p[2]) / wt if wt else p[0]
                    for (kind, b, w), tk in pending:
                        c = tk * wp / 1e6
                        cost[(thread, kind, b)] += c
                        count[(kind, b)] += 1
                        toks[(kind, b)] += tk
                        if kind == 'Bash':
                            word_cost[(b, w)] += c
                            words[(b, w)] += 1
                for key, tk in pending:
                    active[key] += tk
                pending = []

    def usd(x): return '$%.2f' % x
    def share(x): return '%.1f%%' % (100 * x / total) if total else 'n/a'
    print('Window: last %g days, %d files, %d requests in window' % (a.days, len(files), sum(inwin(r) for r in best.values())))
    print('Compaction boundaries seen: %d' % cuts)
    print('Total list-price cost: %s (main %s, subagent %s)' % (usd(total), usd(tot_thread['main']), usd(tot_thread['sub'])))
    for kind, label in (('Bash', 'Bash results'), ('Other', 'All other tool results (Read, Grep, ...)')):
        k = sum(v for (t, kd, b), v in cost.items() if kd == kind)
        n = sum(v for (kd, b), v in count.items() if kd == kind)
        print('\n%s: %s = %s of total, %d results' % (label, usd(k), share(k), n))
        for t in ('main', 'sub'):
            v = sum(x for (th, kd, b), x in cost.items() if kd == kind and th == t)
            print('  %-9s %s (%s of total, %s of that thread)' % ('main' if t == 'main' else 'subagent', usd(v), share(v), '%.1f%%' % (100 * v / tot_thread[t]) if tot_thread[t] else 'n/a'))
        for b in BUCKETS:
            v = sum(x for (th, kd, bb), x in cost.items() if kd == kind and bb == b)
            print('  size %-7s %s (%s of total), %d results, %.1fM est tokens' % (b, usd(v), share(v), count[(kind, b)], toks[(kind, b)] / 1e6))
    for b in BUCKETS[2:]:
        print('\nBash results %s est tokens, top first words of command: results, cost (incl. later cache reads)' % b)
        top = sorted(((n, w) for (bb, w), n in words.items() if bb == b), reverse=True)[:8]
        for n, w in top:
            print('  %-14s %4d  %s' % (w or '(none)', n, usd(word_cost[(b, w)])))
        if not top:
            print('  (none)')
        print('  bucket total: %d results, %s' % (count[('Bash', b)], usd(sum(v for (bb, w), v in word_cost.items() if bb == b))))


if __name__ == '__main__':
    main()
