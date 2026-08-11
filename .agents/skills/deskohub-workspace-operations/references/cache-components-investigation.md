# Cache Components timeout investigation

This is dated diagnostic evidence, not current configuration. In July 2026, Workspace temporarily disabled Cache Components while investigating successful responses whose runtime work continued until the hosting timeout. Database cold-start tuning happened near the same period and was a confounding change. Cache Components have since been re-enabled.

For a recurrence, compare an isolated preview change against a stable baseline and inspect:

- runtime timeout count and affected routes;
- prerender timer warnings;
- request-duration distributions for the same routes;
- bounded external-provider durations; and
- post-response logging or telemetry flush failures.

Record the exact deployment and commit, compare equivalent traffic over a meaningful window, and avoid attributing an improvement to caching when database or provider behavior changed at the same time.

Reproduce any configuration change in preview first. Verify the current `next.config.mjs` and deployed runtime rather than copying the historical disabled state from this note.
