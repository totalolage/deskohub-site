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
