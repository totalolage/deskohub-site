# AGENTS

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the Agent.md file to help prevent future agents from having the same issue.

## Points

- Always use bun to run scripts
- Leverage Effect primarily before trying to use other tools
- Make heavy use of exploration and research subagents to make sure you are taking the correct approach
- The workspace app does not currently share the bar app's server-action/email scaffolding, so fully wired form features may require adding workspace-local backend config/service wiring instead of reusing imports directly.
- Dotypos request/response debug logging can include Authorization headers, refresh tokens, bearer tokens, and token response bodies; do not enable, fetch, or quote those logs for production diagnostics without explicit redaction.
