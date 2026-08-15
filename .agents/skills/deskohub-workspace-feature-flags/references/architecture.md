# Workspace feature-flag architecture

PostHog is the source of truth for Workspace flag keys, variants, and payload types. Workspace owns a checked-in generated contract so normal builds do not need the management API or its credential.

## Synchronize the contract

After changing flags in PostHog, run:

```bash
bun turbo run feature-flags:sync --filter=deskohub-workspace
```

Generation uses the dedicated management configuration and writes only definitions and payload shapes, never live payload values. Keep that dedicated synchronization credential out of runtime application configuration.

## Runtime evaluation

Server features resolve the app-owned feature-flag Context capability. That boundary owns the process-scoped typed Node client. It reads the live management definition through the cached runtime management configuration and proves whether boolean enablement is constant. Inactive flags, unconditional 0% flags, and unconditional 100% flags are constant; partial rollouts, person/group/cohort/dependent conditions, continuity, and unknown definitions require the request subject. A management read failure also requires the request subject.

Constant flags use one fixed non-recording Workspace release subject and can participate in prerendered public UI. Request-dependent flags use the consented PostHog visitor identity, falling back to the fixed subject before consent. A cache boundary may use the explicit global-release layer only after checking that every flag it evaluates is currently constant. Server enforcement stays on the adaptive default so it follows the same classification.

React consumers use the generated typed hook under the single provider at the localized application root. Do not add feature-local providers or independently declared flag-key types.

## Deployment-scoped overrides

The optional server-only override map is decoded against the generated contract. Unknown keys, malformed values, and values of the wrong generated type fail environment validation.

Only development and protected preview may configure a non-empty map. Production must reject it. Apply one immutable map to the process-scoped server client and serialize that same map to the consent-aware browser boundary. Never derive or mutate overrides from requests, cookies, URLs, headers, or visitor identity.

After browser analytics initializes, replace the complete override set. Explicitly clear persisted overrides when configuration is absent. Do not initialize analytics merely to apply an override before consent.

Overrides are isolated validation tools, not rollout management, and never mutate the definitions stored by PostHog.

## Rollout inspection

Read a flag's enabled status independently from its release conditions. A disabled flag may still display the conditions that would apply if enabled; that configuration is not evidence that the flag is active.
