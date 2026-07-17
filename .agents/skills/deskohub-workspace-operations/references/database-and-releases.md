# Database changes and releases

## Generate migrations

Generate Drizzle migrations, journals, and snapshots with Drizzle tooling. Do not hand-write migration metadata or journal entries.

## Release Workspace production

Keep the production release sequence intentionally simple:

1. Build a staged Vercel production deployment without assigning domains.
2. Run pending migrations against the production Neon branch.
3. Promote the ready deployment.

Do not introduce expand/contract migrations or database branch swapping unless the user explicitly requests them.

Do not add a custom Vercel Ignored Build Step for documentation-, test-, CI-, or E2E-only changes. These changes are too infrequent to justify maintaining a classifier; rely on Vercel's automatic affected-project skipping.

## Migrate protected preview databases

Workspace Preview databases are owned by the Neon/Vercel integration for the PR
lifecycle. After the exact immutable Git preview reports success, validate and
resolve its non-primary `preview/<internal-head-ref>` branch, obtain direct and
pooled URLs with pinned `neonctl`, mask both immediately, and migrate with the
direct URL before E2E. Fail closed if the branch-to-PR mapping is missing or
ambiguous. Never fall back to production or shared development.

The Neon/Vercel integration owns both creation and deletion of these preview
branches. Keep its automatic obsolete-branch deletion enabled. E2E and other
repository workflows must not expire or delete integration-owned branches.

Preview Ready currently precedes migration and is acceptable only while builds
are database-independent. Schema-breaking changes must remain compatible with
that ordering or add a preview-only pre-runtime migration mechanism. Do not put
migrations in the Vercel build; production remains staged build, production
migration, then promotion.
