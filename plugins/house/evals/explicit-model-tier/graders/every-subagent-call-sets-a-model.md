---
type: tool_used
tool: Task
input_match: model
min: 3
weight: 1
---
Every subagent dispatch for the three review tasks (the typo check, the security review, and the
architecture assessment) names an explicit `model` in its `Task` call, rather than leaving it
unset and inheriting whatever model the top-level session happens to be running as.
