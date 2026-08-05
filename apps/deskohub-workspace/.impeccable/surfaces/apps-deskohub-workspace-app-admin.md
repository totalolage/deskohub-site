---
version: 1
slug: "apps-deskohub-workspace-app-admin"
primary_target: "apps/deskohub-workspace/app/admin/page.tsx"
related_targets: ["apps/deskohub-workspace/app/admin/reservations","apps/deskohub-workspace/app/admin/customers","apps/deskohub-workspace/app/admin/discounts","apps/deskohub-workspace/app/admin/codes","apps/deskohub-workspace/app/admin/sales"]
---

Scope and mode: `/admin` and all nested administration routes; Operate mode for authenticated Deskohub operators doing frequent lookup and configuration work.

Audience and job: Find reservations or customers quickly, understand a reservation's current condition and reconstructed journey, follow related records, and retain the complete existing discounts, codes, sales, and customer-discount capabilities.

Direction: A restrained three-part operations console. Persistent grouped navigation owns global location on the left, breadcrumbs and the entity story own the center, and a quiet related-entity rail owns contextual links on detail pages. The memorable moment is the reservation journey: one friendly current status, a readable chronological history, and a compact branching lifecycle explainer.

Constraints: Current state comes from Workspace lifecycle data enriched with live Dotypos facts. PostHog is best-effort historical visibility, never audit evidence. No raw payloads, secret/access fields, provider diagnostics, or competing technical status badges. Search and filters remain URL-addressable. Responsive layouts structurally collapse navigation and move related context below the entity story.

Unresolved decisions: None for the first implementation; advanced query syntax, customizable dashboards, bulk actions, and auditability are explicitly deferred.
