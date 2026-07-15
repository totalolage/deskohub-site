# PostHog API service

`@deskohub/posthog` provides the Effect service used for PostHog management API
calls. Its request operations and response decoders are generated from PostHog's
current public OpenAPI schema.

Run generation from the repository root:

```sh
bun turbo run generate --filter=@deskohub/posthog
```

The generator downloads `https://eu.posthog.com/api/schema/?format=json`, keeps
the feature-flag list operation and its transitive component references, and
writes `src/generated/effect.gen.ts`. The full upstream schema is not committed.
Set `POSTHOG_OPENAPI_SCHEMA_URL` only when generation should target another
PostHog installation. Turbo caching is disabled for this task so each generation
uses the schema currently published by PostHog.

PostHog currently exposes the feature flag `filters` property as an untyped
object while publishing the detailed `FeatureFlagFiltersSchema` separately. The
generator connects those two official definitions before generating the client.
