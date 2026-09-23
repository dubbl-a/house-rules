---
type: llm
focus: trace
weight: 1
---
The model tier set on each of the three `Task` calls actually scales with the task's difficulty,
rather than every call using the same model out of habit (which would satisfy "a model is named"
without satisfying "match the tier to the task"). The typo check is mechanical (Haiku
appropriate), the security review needs real code-reading judgment (Sonnet), and the
architecture assessment is judgment, so it belongs on Opus, the judgment tier, whether or not the
session itself is on Opus.

Score HIGH when the three `Task` calls name at least two distinct tiers across the three tasks,
with the architecture assessment on Opus at the highest tier used and the typo check at the
lowest.

Score LOW when all three calls use the identical model regardless of task, when the tiering is
inverted (the typo check gets the top tier while the architecture assessment gets the smallest),
or when the architecture assessment lands on Fable (Fable never runs on a subagent unless the
user asks for it, and this prompt does not ask).
