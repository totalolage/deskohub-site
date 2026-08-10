---
version: 1
slug: "apps-deskohub-workspace-app-admin"
primary_target: "apps/deskohub-workspace/app/admin/page.tsx"
related_targets: ["apps/deskohub-workspace/app/admin/reservations","apps/deskohub-workspace/app/admin/customers","apps/deskohub-workspace/app/admin/codes","apps/deskohub-workspace/app/admin/sales"]
---

Scope and mode: `/admin` and all nested administration routes; Operate mode for authenticated Deskohub operators doing frequent lookup and configuration work.

Audience and job: Find reservations or customers quickly, understand a reservation's current condition and reconstructed journey, inspect the booking and payment records attached to it, and retain the existing codes, sales, and customer-discount capabilities.

Direction: A restrained reservation-centric operations console. The visible navigation is limited to Overview, Reservations, Customers, Codes, and Sales. Overview is a compact activity-and-lookup surface. The reservation detail owns the complete operational story: an actual-state lifecycle, booking facts, payment attempts, Nexi orders and operations, chronological history, and quiet related-reservation context. Discount definitions live directly in Codes and Sales instead of a separate primary workflow.

Constraints: Current state comes from Workspace lifecycle data enriched with live Dotypos facts. Nexi data is read-only enrichment and external provider IDs remain usable when it is unavailable. PostHog is best-effort historical visibility, never audit evidence. No raw payloads, secret/access fields, provider redirect URLs, or competing technical status badges. Search and filters remain URL-addressable. Responsive layouts structurally collapse navigation and move related context below the entity story. Hidden compatibility routes may retain unlinked provider diagnostics but are not part of the visible navigation.

Unresolved decisions: None for the first implementation; advanced query syntax, customizable dashboards, bulk actions, and auditability are explicitly deferred.
