# PostHog API service

`@deskohub/posthog` provides the Effect client generated from PostHog's current
public OpenAPI schema.

Run generation from the repository root:

```sh
bun turbo run generate --filter=@deskohub/posthog
```

The generator downloads `https://eu.posthog.com/api/schema/?format=json` and
runs Effect's OpenAPI generator against the complete schema. Set
`POSTHOG_OPENAPI_SCHEMA_URL` only when generation should target another PostHog
installation. Turbo caching is disabled for this task so each generation uses
the schema currently published by PostHog.

Before generation, nullable feature-flag fields are converted from OpenAPI 3.1's
`type: [value, null]` notation to the equivalent `oneOf` notation because
Effect's generator currently drops the null member of those unions. The patch
covers the pagination links, `UserBasic.hedgehog_config`, and
`FeatureFlag.last_called_at`. It also widens `FeatureFlag.surveys` and `features`
because PostHog's live endpoint returns arrays while its published schema
currently declares objects. The generated client itself remains untouched, and
each compatibility patch can be removed independently when its upstream issue is
fixed.

## Typed feature flags

PostHog remains the source of truth for feature flag keys, variants, and
payloads. Each application owns its generated contract because applications can
use different PostHog projects and different sets of flags. The package exports
an Effect-based generator, but does not read environment variables or choose an
output location.

Create a generator script in the consuming application:

```ts
import { generatePostHogFeatureFlagContract } from "@deskohub/posthog/feature-flags/codegen";
import { Effect } from "effect";

const program = generatePostHogFeatureFlagContract({
  apiKey: process.env.WORKSPACE_POSTHOG_FEATURE_FLAGS_API_KEY!,
  host: new URL(process.env.WORKSPACE_POSTHOG_HOST ?? "https://eu.posthog.com"),
  outputFile: new URL(
    "../features/feature-flags/generated/contract.ts",
    import.meta.url
  ),
  projectId: process.env.WORKSPACE_POSTHOG_PROJECT_ID!,
});

if (import.meta.main) await Effect.runPromise(program);
```

The consumer should validate its environment before calling the generator. The
API key must be a PostHog personal API key restricted to reading feature flags.
The generated file contains payload shapes, but never payload values. Inactive
flags are included so code can be prepared before rollout; archived and deleted
flags are excluded. Commit the generated contract so normal builds do not need
the management key or network access.

Pass the generated contract to the runtime adapter needed by the application:

```tsx
"use client";

import { createPostHogReactFeatureFlags } from "@deskohub/posthog/feature-flags/react";
import { postHogFeatureFlags } from "./generated/contract";

export const { useFeatureFlagEnabled } =
  createPostHogReactFeatureFlags(postHogFeatureFlags);

export function MeetingRoomEntry() {
  const enabled = useFeatureFlagEnabled("meeting_room_page", false);

  return enabled ? <a href="/meeting-room">Meeting room</a> : null;
}
```

Server code creates an app-configured service from the generated contract. The
service constructs one official Node SDK client lazily and reuses it for the
service lifetime. Client and evaluation options use the types exported by
`posthog-node`:

```ts
import { makePostHogNodeFeatureFlagService } from "@deskohub/posthog/feature-flags/node";
import { postHogFeatureFlags } from "./generated/contract";

export const nodeFeatureFlags = makePostHogNodeFeatureFlagService(
  postHogFeatureFlags,
  {
    clientOptions: {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    },
    defaultEvaluationOptions: {
      disableGeoip: true,
    },
    projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  }
);

const enabled = yield* nodeFeatureFlags.isEnabled({
  key: "meeting_room_page",
  subject: {
    distinctId: visitorId,
    sendFeatureFlagEvents: true,
  },
});
```

Call `nodeFeatureFlags.shutdown()` when a long-lived process shuts down. Normal
evaluations do not close the shared client.

The subject should use the same distinct ID as the browser SDK. If an
application must use a shared fallback identity for a global release switch, it
should set `sendFeatureFlagEvents` to `false` so fallback evaluations do not
pollute per-user feature-flag analytics.

Unknown or cross-application keys fail TypeScript compilation. Multivariate
values and payloads are typed from the owning application's PostHog definition.
The management API is used only during generation; browser and server SDKs
perform runtime evaluation using the end user's context.
