---
type: llm
focus: trace
weight: 1
---
The transcript shows the new `scripts/check-unique-ids.mjs` being exercised in both directions
before it is declared ready: against a case with a repeated `id` (constructed for the purpose,
whether as a temporary edit to `data/modules.json`, a scratch copy, or an equivalent fixture),
where the script is confirmed to exit nonzero and name the repeated id; and against a case with
all-unique ids, where the script is confirmed to exit 0 and print `PASS: ids are unique`. A single
run against the original, already-unique `data/modules.json` does not by itself satisfy this: the
script has to be shown catching a real violation, not just shown passing on data that was never
going to fail it.

Score HIGH when the transcript (tool calls and their output, not just the final summary) shows the
script being run against a deliberately-broken case and a clean case, with the nonzero exit and
the offending id actually observed on the broken case.

Score LOW when the transcript shows the script run only once, against the pre-existing unique
`data/modules.json`, with that single clean pass treated as sufficient confirmation the script
works.
