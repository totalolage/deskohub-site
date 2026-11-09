# Database changes and releases

## Generate migrations

Generate Drizzle migrations, journals, and snapshots with Drizzle tooling. Never hand-write migration metadata or journal entries.

## Release Workspace production

Every push to `main` that touches Workspace inputs deploys production, so merging is the release. `.github/workflows/deploy-workspace-production.yml` runs this sequence; keep it:

1. Build a staged Vercel production deployment without assigning domains.
2. Run pending migrations against the production Neon branch.
3. Promote the ready deployment.

After the canonical smoke check passes, the last step submits the production sitemap's canonical URLs to IndexNow with `apps/deskohub-workspace/scripts/submit-indexnow.ts`. It runs after the rollback and failure steps, with `continue-on-error`, so a failed or cancelled submission never fails or rolls back the release. A failure shows up as a `::warning` annotation on the run. The step log records only the HTTP status, host, and URL count, never the key. IndexNow verifies the key at `/<key>.txt`, which only production serves. Rotating the key means renaming the `app/<key>.txt` route folder along with `features/public-pages/indexnow-key.ts`.

Don't add database branch swapping unless the user asks for it. Don't put migrations in the Vercel build.

Old and new functions overlap during a rollout. When a schema change would break queries, mutations, constraints, or decoded data in the previous deployment, ship an expand, backfill, and compatibility release that keeps both representations in sync. Rename or drop the old representation only in a later release, after the compatibility version is fully deployed.

Skew Protection (12-hour max age from deployment creation) keeps browsers that loaded an older deployment calling its Server Actions. Don't hold a merge for it. A stale tab that hits an incompatible Server Action sees an error and retries.

Vercel queue messages stay pinned to the deployment that published them, and that older code can consume them until they're acknowledged or expire. Late-payment recovery messages are retained for seven days. Before a release that older consumers can't tolerate, check what each topic's consumer writes and whether undelivered messages from older deployments remain.

Email automation work units (`workspace-email-automation-unit`) ship consumer first. Each deployment compiles in a list of the unit kinds it can run, and it claims, promotes and reaps only those kinds. A message for an unknown kind is acknowledged without being claimed, and a deployment that supports the kind re-sends the unit. Add a kind's handler before any code plans that kind. Once automated campaigns exist, never instant-roll back past the release that added the automation schema and the unit consumer. Older code can't decode automated campaigns, shows automated sends as one-off sends, and can't run newer unit kinds.

Don't add a custom Vercel Ignored Build Step for documentation-, test-, CI-, or E2E-only changes. Rely on Vercel's automatic affected-project skipping.

## Migrate protected preview databases

The Neon/Vercel integration creates and deletes Workspace preview branches for the PR lifecycle. Keep its automatic obsolete-branch deletion on. E2E and other repository workflows must not expire or delete integration-owned branches.

`.github/workflows/workspace-e2e.yml` migrates each preview before E2E. When you change that flow, keep these properties:

- Wait for the exact immutable Git preview to report success.
- Resolve its non-primary `preview/<internal-head-ref>` branch. Fail closed when the branch-to-PR mapping is missing or ambiguous. Never fall back to production or shared development.
- Get direct and pooled URLs with pinned `neonctl`, mask both immediately, and migrate with the direct URL.

Preview reports Ready before migration runs. That's acceptable only while builds don't touch the database. A schema-breaking change must stay compatible with that order or add a preview-only migration step that runs before the runtime starts.
