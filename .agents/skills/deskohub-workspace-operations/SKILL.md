---
name: deskohub-workspace-operations
description: Workspace production, preview, deployment, migration, and provider diagnostics.
---

# Deskohub Workspace operations

Read only the reference for the active operation:

- For production diagnostics, logging, redaction, Dotypos, PostHog, or Cloudinary incidents, read [references/diagnostics.md](references/diagnostics.md).
- For a scheduled PostHog incident dispatcher pass, read [references/posthog-agent-dispatcher.md](references/posthog-agent-dispatcher.md).
- For a T3 worker assigned to a PostHog GitHub issue, read [references/posthog-agent-worker.md](references/posthog-agent-worker.md).
- For installing, checking, or stopping the local incident timer, read [references/posthog-agent-loop-setup.md](references/posthog-agent-loop-setup.md).
- For schema migrations, production database changes, deployments, or releases, read [references/database-and-releases.md](references/database-and-releases.md).
- For Cache Components timeout history, read [references/cache-components-investigation.md](references/cache-components-investigation.md) only as dated diagnostic evidence, then verify current configuration and telemetry.

Read both when a release investigation crosses database and runtime-log boundaries. Update the relevant reference when developer feedback changes a durable operational constraint.
