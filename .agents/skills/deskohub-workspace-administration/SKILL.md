---
name: deskohub-workspace-administration
description: Workspace administration dashboard, administration API, dhw CLI, discount, code, sale, session, and standalone Igloohome access-code creation operations.
---

# Deskohub Workspace administration

Read only the reference relevant to the change:

- For dashboard projections, navigation, standalone access-code creation, data sources, search, and operational history, read [references/dashboard.md](references/dashboard.md).
- For discount, code, target, customer allowlist, claim, and Calendar-sale operations, read [references/discounts.md](references/discounts.md).
- For the administration API, `dhw` commands, standalone access-code creation, authentication, builds, updates, and releases, read [references/dhw-cli.md](references/dhw-cli.md).

Use the same application services and validation contracts across the administration UI, administration API, and CLI. Keep provider enrichment read-only unless the named operator workflow explicitly owns a mutation. Consult the business-facing [administration dashboard](../../../apps/deskohub-workspace/docs/administration-dashboard.md) and [discount-code](../../../apps/deskohub-workspace/docs/discount-codes.md) specifications before changing operator-visible policy.
