import json, re, sys, datetime
# For each idle gap, was the Mac awake when idle compaction should have fired (about 54 min after the last response)?
# Usage: idle_sleep.py <gaps file from idle_versions.py --gaps> <saved output of `pmset -g log`>
gaps_path, log_path = sys.argv[1], sys.argv[2]
ev = []
pat = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [-+]\d{4}) (Sleep|Wake|DarkWake)\s+(\S+)')
for line in open(log_path, errors='replace'):
    m = pat.match(line)
    if not m: continue
    t = datetime.datetime.strptime(m[1], '%Y-%m-%d %H:%M:%S %z'); kind, word = m[2], m[3]
    if kind == 'Sleep' and word == 'Entering': ev.append((t, 'asleep'))
    elif kind == 'DarkWake': ev.append((t, 'darkwake'))
    elif kind == 'Wake' and word in ('Wake', 'DarkWake'): ev.append((t, 'awake'))
ev.sort()
def state_at(t):
    s = 'unknown'
    for et, es in ev:
        if et > t: break
        s = es
    return s
def minutes_by_state(a, b):
    out = {'awake': 0.0, 'asleep': 0.0, 'darkwake': 0.0, 'unknown': 0.0}
    cur, s = a, state_at(a)
    for et, es in ev:
        if et <= a: continue
        if et >= b: break
        out[s] += (et - cur).total_seconds() / 60; cur, s = et, es
    out[s] += (b - cur).total_seconds() / 60
    return out
ts = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
for line in open(gaps_path):
    g = json.loads(line); a, b = ts(g['start']), ts(g['end'])
    fire = a + datetime.timedelta(minutes=54)
    mins = minutes_by_state(a, b)
    awake54 = minutes_by_state(a, fire)['awake']
    print('%s  gap %4.0f min  ctx %3dk  at +54min: %-8s  awake through first 54 min: %2.0f/54  gap awake %4.0f asleep %4.0f darkwake %3.0f' % (
        a.astimezone().strftime('%m-%d %H:%M'), (b - a).total_seconds() / 60, g['ctx_k'], state_at(fire), awake54, mins['awake'], mins['asleep'], mins['darkwake']))
