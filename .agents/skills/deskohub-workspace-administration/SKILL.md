---
name: deskohub-workspace-administration
description: Workspace admin dashboard, /admin pages, /[locale]/admin, admin sign-in, admin access gate, administrator role, account role grants, Administrators page, admin 404, admin localization, admin i18n, admin Czech copy, admin Inlang catalogs, admin language switcher, administration API, administration operation annotations, destructive operations, credential fields, dhw CLI, dhw minimum version, MCP admin tools, administrators' AI agents, administration agent tools, CLI sessions, operator cancellation and refunds, access recovery, standalone access codes, invoices, discount codes, vouchers, sales administration, reservation product-details backfill.
---

# Deskohub Workspace administration

Read the reference that matches the change:

- [references/dashboard.md](references/dashboard.md): `/admin` rendering, data sources, reservation and customer projections, cancellation and refund state, access recovery, standalone access codes, and history.
- [references/localization.md](references/localization.md): locale-prefixed routes and the proxy redirect, administration paths in code, the administration Inlang project and its per-area catalogs, and the build-output check that keeps administration copy out of customer chunks.
- [references/discounts.md](references/discounts.md): discount, code, voucher, audience, and claim mutations.
- [references/dhw-cli.md](references/dhw-cli.md): the shared administration API contract, operation annotations, the MCP tools derived from it, `dhw` authentication, confirmation, retries, the reservation product-details backfill, configuration, checks, and releases.

Always apply these rules:

- Route the Admin UI, administration API, and `dhw` through the same application services and schemas so all three enforce the same validation.
- Keep page loads read-only. Mutate only inside an explicit operator workflow, such as cancellation, access recovery, or a discount change.
- Read the business specifications before changing operator-visible policy: [administration](../../../apps/deskohub-workspace/docs/administration-dashboard.md), [discounts](../../../apps/deskohub-workspace/docs/discount-codes.md), and [`dhw`](../../../apps/dhw/README.md).
