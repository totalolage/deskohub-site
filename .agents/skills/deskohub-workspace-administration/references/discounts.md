# Discount administration

The [discount specification](../../../../apps/deskohub-workspace/docs/discount-codes.md) defines code syntax, limits, voucher credit, and audience policy. Use the Admin UI or `dhw` for ordinary discount, code, voucher, sale, and audience changes. Never prescribe direct SQL as an operator workflow.

## Mutation rules

- Route discount mutations through `features/discounts/admin/execute-discount-admin-mutation.ts` so the UI and API share one dispatcher.
- A discount needs complete locale labels, one adjustment, and at least one product target: a reservation family or one saleable cowork tier (`{kind:"cowork",tier}`). See [Cowork tier targets](#cowork-tier-targets). Code creation can create its discount atomically or reference an existing one.
- A voucher is a separate promotional-credit resource, never a product or a `discount_codes` variant. It has no discount definition and no use limit. Show issued and remaining credit rather than calling it unlimited.
- `promotion_codes` owns the globally unique entered value, scheduling, enablement, and customer audience. Discount codes and vouchers use separate child tables and claim ledgers.
- Database triggers keep the common fields on `discount_codes` and the `discount_code_customers` table in sync with `promotion_codes` for older deployments. Drop the mirrors and triggers only in a dedicated contract migration.
- Global and per-customer use limits belong to the discount-code child, not the shared discount. An omitted limit is unlimited in that dimension.
- An empty audience is unrestricted, so removing the last customer broadens access and needs explicit confirmation.
- Deleting a code or voucher must fail when immutable claims reference it. Prefer disabling.
- Calendar sales: validate the discount definition before associating it with a sale. Load `deskohub-workspace-domain` for Calendar sale semantics.

## Cowork tier targets

- A cowork target without a tier covers every cowork tier. The shared contract and stored-definition decoding both reject duplicate targets and any mix of the whole-cowork target with tier targets.

## Evidence

Discount applications and code claims are immutable evidence. Voucher remaining credit is issued value minus reserved and redeemed applications; a released claim restores availability without rewriting history. Inspect evidence through allowlisted administration projections. Repair it only through a reviewed migration or dedicated repair workflow, never through ordinary mutations or direct edits. Load `deskohub-workspace-operations` before production diagnostics or database repair.
