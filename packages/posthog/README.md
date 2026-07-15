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

## Typed feature flags

PostHog remains the source of truth for feature flag keys, variants, and
payloads. Synchronize that definition into the checked-in TypeScript contract:

```sh
POSTHOG_FEATURE_FLAGS_API_KEY=phx_... \
POSTHOG_PROJECT_ID=12345 \
bun turbo run feature-flags:sync --filter=@deskohub/posthog
```

`POSTHOG_HOST` defaults to `https://eu.posthog.com`. The API key must be a
PostHog personal API key restricted to reading feature flags. The generated
file contains payload shapes, but never payload values. Inactive flags are
included so code can be prepared before rollout; archived and deleted flags are
excluded.

Import keys and their generated value or payload types from
`@deskohub/posthog/feature-flags`. Client components should consume flags
through the wrappers around PostHog's official React package:

```tsx
"use client";

import { useFeatureFlagEnabled } from "@deskohub/posthog/feature-flags/react";

export function MeetingRoomEntry() {
  const enabled = useFeatureFlagEnabled("meeting_room_page", false);

  return enabled ? <a href="/meeting-room">Meeting room</a> : null;
}
```

Unknown keys fail TypeScript compilation. Multivariate values and payloads are
typed from the PostHog definition. Prefer `useFeatureFlagResult` when value and
payload need to come from the same evaluation. PostHog's payload-only hook does
not send a `$feature_flag_called` exposure event, so pair
`useFeatureFlagPayload` with the enabled or variant hook when using it directly.

The management API under `@deskohub/posthog/feature-flags/management` exists for
generation and tooling. It must not be used to evaluate a flag for an end user;
the browser or server SDK performs that evaluation using the user's context.
