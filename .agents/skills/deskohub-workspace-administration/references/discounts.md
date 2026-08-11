# Discount administration

Use the authenticated Workspace administration UI or `dhw` commands for ordinary discount, code, sale, target, and customer-audience mutations. Do not prescribe direct SQL as the standard operator workflow.

## Mutation boundaries

- Create or update a discount with its complete locale labels, one adjustment, and at least one reservation-family target.
- Code creation may create its discount atomically or reference an existing discount.
- Code scheduling, enablement, use limit, and customer audience belong to the code rather than its shared discount.
- An empty audience is unrestricted. Removing the last customer therefore broadens access and requires explicit confirmation.
- Deleting a discount or code must fail when immutable applications or claims require it for historical attribution. Prefer disabling a code.
- Customer discount-group changes and administration-session changes are explicit confirmed mutations.

Every CLI mutation carries a client-generated request identity. Persist and replay its result per administration session so retrying an ambiguous transport failure cannot apply the same mutation twice.

## Calendar sales

Create and validate the discount definition before associating it with a scheduled sale. Calendar owns occurrence timing; Workspace owns labels, adjustment, and targets. Keep the calendar reference exact and source-neutral, and never use the event title as customer copy.

## Evidence and diagnosis

Discount applications and code claims are immutable operational evidence. Inspect them through allowlisted administration projections. Do not repair them through ordinary mutation commands or direct edits; use a reviewed migration or dedicated repair workflow.

For production diagnostics or database repair, read the Workspace operations skill and preserve its redaction and staged-release rules.

## Cross-surface changes

Treat `packages/workspace-admin-api/src/workspace-admin-api.ts` as the shared contract for the Admin UI, administration API, and `dhw`. Route discount mutations through `apps/deskohub-workspace/features/discounts/admin/execute-discount-admin-mutation.ts`; preserve CLI replay and mismatch protection in `features/admin-cli/cli-mutation-idempotency.service.ts`. Extend the existing generic mutation endpoint and client unless the transport boundary itself has changed.

Verify the shared schema, discount administration service and dispatcher, Admin actions and components, CLI API idempotency, and exact `dhw` argument-to-mutation and output mappings. The CI-equivalent checks for shared administration-contract work are:

```bash
bun turbo lint --filter=@deskohub/workspace-admin-api --filter=dhw
bun turbo typecheck --filter=@deskohub/workspace-admin-api --filter=dhw
bun --cwd apps/dhw test
bun turbo test:admin-cli --filter=./apps/deskohub-workspace
bun apps/dhw/src/build.ts development
apps/dhw/dist/dhw version --json
```

When a shared contract change affects `dhw`, change the CLI in the same pull request and include a releasable `feat(dhw): ...` or `fix(dhw): ...` commit. `.github/workflows/dhw-ci.yml` enforces that release boundary.
