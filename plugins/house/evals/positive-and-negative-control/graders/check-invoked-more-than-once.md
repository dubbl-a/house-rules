---
type: tool_used
tool: Bash
input_match: check-unique-ids|check:unique-ids
min: 2
weight: 0.5
---
The new check was actually invoked more than once via `Bash` (directly with `node
scripts/check-unique-ids.mjs`, or via `npm run check:unique-ids`), rather than run a single time
and trusted from that one call. This is a coarser, deterministic proxy for the same signal the
trace grader checks in more detail: proving a gate works takes at least one run expected to fail
and one expected to pass, which is at least two invocations, not one.
