# Napkin Runbook

## Execution & Validation
1. **[2026-10-07] Use MCP task records before repository changes**
   Do instead: resolve the workspace project, locate the matching feature/task, read task context, and claim it before editing.
2. **[2026-10-07] Keep implementation and validation scoped**
   Do instead: search with `rg`, inspect only relevant code, and run validation only when requested.

## Shell & Command Reliability
1. **[2026-10-07] Keep MCP configuration global**
   Do instead: use the connected global project-tasks MCP; never add repository MCP config.

## Domain Behavior Guardrails
1. **[2026-10-07] Update task execution evidence as work progresses**
   Do instead: record heartbeats/milestones, persist acceptance evidence when proven, and submit a concise final execution report.
