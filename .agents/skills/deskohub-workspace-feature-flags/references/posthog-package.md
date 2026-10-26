# `@deskohub/posthog` package

## Generated API client

The package's Effect client is generated from PostHog's complete public OpenAPI schema. Regenerate from the repository root and commit the result:

```sh
bun turbo run generate --filter=@deskohub/posthog
```

The task downloads `https://eu.posthog.com/api/schema/?format=json`; set `POSTHOG_OPENAPI_SCHEMA_URL` only to target another PostHog installation. It's uncached and nothing depends on it, so typecheck and consumers use the checked-in client.

`scripts/generate.ts` patches the schema, never the generated client. Effect's generator drops the null member of OpenAPI 3.1 `type: [value, null]` unions, so the patch rewrites the pagination links, `UserBasic.hedgehog_config`, and `FeatureFlag.last_called_at` as `oneOf`. It also widens `FeatureFlag.surveys` and `features`, which the live endpoint returns as arrays while the schema declares objects. Remove each patch entry when its upstream issue is fixed.

## Typed feature flags

Each application owns its generated contract, because applications can use different PostHog projects and flags. The package exports the generator (`feature-flags/codegen`), the management definition reader (`feature-flags/management`), and the Node and React adapters (`feature-flags/node`, `feature-flags/react`). The generator doesn't read environment variables or choose an output path; the consuming application validates its environment and passes both. `apps/deskohub-workspace/scripts/sync-posthog-feature-flags.ts` is the reference consumer.

The React adapter doesn't use `@posthog/react`, which imports the whole browser SDK at module load. Its hooks read the client from `PostHogClientProvider`, whose source can publish the client after the hooks mount, and return the default value until then. Workspace's `PostHogProvider` passes the consent-gated SDK module as that source.

- Use a PostHog personal API key restricted to reading feature flags. The management API runs only during generation and classification; browser and server SDKs evaluate at runtime.
- The contract includes inactive flags, so code can ship before rollout, and excludes archived and deleted flags.
- Unknown or cross-application keys fail TypeScript compilation. Variant and payload types come from the owning application's definitions.
- `makePostHogNodeFeatureFlagService` creates one SDK client lazily and reuses it. Run `shutdown` when a long-lived process exits.
- The server subject uses the browser SDK's distinct ID. A shared fallback identity for a global release switch sets `sendFeatureFlagEvents: false` so it doesn't pollute per-user flag analytics.
