# PostHog API service

`@deskohub/posthog` provides the Effect client generated from PostHog's current
public OpenAPI schema.

Run generation from the repository root:

```sh
bun turbo run generate --filter=@deskohub/posthog
```

The generator downloads `https://eu.posthog.com/api/schema/?format=json` and
runs Effect's OpenAPI generator directly against the complete, unmodified
schema. Set `POSTHOG_OPENAPI_SCHEMA_URL` only when generation should target
another PostHog installation. Turbo caching is disabled for this task so each
generation uses the schema currently published by PostHog.
