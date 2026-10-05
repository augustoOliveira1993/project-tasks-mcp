# Napkin Runbook

## Execution & Validation (Highest Priority)

1. **[2026-09-10] Keep browser administration behind the human API.**
   Do instead: use `/admin/query` and `/admin` with a human bearer token; do not weaken MCP authentication.
2. **[2026-10-03] Duplicate repository records can make workspace resolution ambiguous.**
   Do instead: confirm the unique project and match the repository record to the active checkout's URL and root commit before Git-scoped work.

## User Directives

1. **[2026-09-30] Improve visible UI issues during frontend work.**
   Do instead: fix clipping and hidden information with responsive wrapping while preserving existing controls.
