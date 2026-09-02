---
type: llm
focus: trace
weight: 1
---
The model tier set on each of the three `Task` calls actually scales with the task's difficulty,
rather than every call using the same model out of habit (which would satisfy "a model is named"
without satisfying "match the tier to the task"). The typo check is mechanical (small/cheap tier
appropriate), the security review needs real code-reading judgment (a mid tier), and the
architecture assessment needs the most judgment (the top tier available).

Score HIGH when the three `Task` calls name at least two distinct tiers across the three tasks,
with the architecture assessment at the highest tier used and the typo check at the lowest.

Score LOW when all three calls use the identical model regardless of task, or when the tiering is
inverted (the typo check gets the top tier while the architecture assessment gets the smallest).
