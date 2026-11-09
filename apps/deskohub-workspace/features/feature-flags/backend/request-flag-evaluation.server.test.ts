import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  PostHogFeatureFlagEvaluationError,
  type PostHogFeatureFlagSubject,
} from "@deskohub/posthog/feature-flags/node";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Clock, Effect, Layer, Logger, Option, References } from "effect";
import { savedConsentCookieValue } from "@/shared/testing/consent-cookie.test-utils";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import {
  type PostHogFeatureFlagKey,
  postHogFeatureFlags,
} from "../generated/contract";
import type { ReleaseGateClass } from "./release-gate";

type FlagValues = Partial<Record<PostHogFeatureFlagKey, boolean>>;

// The flags the classification settles: constants and overrides.
let constants: FlagValues = {};
let policy: "allowed" | "disabled" = "allowed";
// What PostHog answers a remote evaluation with.
let remoteAnswer: Effect.Effect<FlagValues, PostHogFeatureFlagEvaluationError> =
  Effect.succeed({});
// The headers object Next's request store hands out for the current request.
let nextRequestHeaders = new Headers();

const remoteEvaluations: {
  readonly distinctId: string;
  readonly flagKeys: readonly string[];
}[] = [];

mock.module("./node", () => ({
  nodeFeatureFlags: {
    evaluateFlags: (input: {
      readonly options?: { readonly flagKeys?: readonly string[] };
      readonly subject: PostHogFeatureFlagSubject;
    }) =>
      Effect.sync(() =>
        remoteEvaluations.push({
          distinctId: input.subject.distinctId,
          flagKeys: [...(input.options?.flagKeys ?? [])],
        })
      ).pipe(
        Effect.andThen(remoteAnswer),
        Effect.map((values) => ({
          getFlag: (key: PostHogFeatureFlagKey) => values[key],
        }))
      ),
  },
}));
mock.module("./feature-flag-evaluation-mode.server", () => ({
  getGlobalWorkspaceFeatureFlagValue: (key: PostHogFeatureFlagKey) =>
    Promise.resolve(constants[key]),
  getGlobalWorkspaceFeatureFlagValues: (
    keys: readonly PostHogFeatureFlagKey[]
  ) =>
    Promise.resolve(
      keys.every((key) => constants[key] !== undefined)
        ? Object.fromEntries(keys.map((key) => [key, constants[key]]))
        : undefined
    ),
}));
mock.module("./remote-evaluation-policy.server", () => ({
  readRemoteEvaluationPolicy: () => policy,
}));
mock.module("next/headers", () => ({
  headers: async () => nextRequestHeaders,
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
  }),
}));

const { ReleaseGate } = await import("./release-gate");
const { releaseGateForRequest } = await import("./release-gate.server");
const { releaseGateForRun } = await import("./release-gate-run");
const { WorkspaceFeatureFlagService } = await import(
  "./workspace-feature-flag.service"
);
const {
  globalReleaseEvaluationLifetime,
  unavailableGlobalReleaseEvaluationLifetime,
} = await import("./request-flag-evaluation.server");
const { runWorkspaceEffect } = await import(
  "@/shared/backend/workspace-effect"
);
const {
  CurrentVisitorIdentity,
  withAnonymousVisitor,
  withWorkspaceRequestContext,
} = await import("@/shared/backend/workspace-request-context");

class OfficeGate extends ReleaseGate<OfficeGate>()(
  "test/OfficeGate",
  "office_page"
) {}
class MeetingRoomGate extends ReleaseGate<MeetingRoomGate>()(
  "test/MeetingRoomGate",
  "meeting_room_page"
) {}
class ReferralGate extends ReleaseGate<ReferralGate>()(
  "test/ReferralGate",
  "referrals"
) {}
class SiteToolsGate extends ReleaseGate<SiteToolsGate>()(
  "test/SiteToolsGate",
  "webmcp_site_tools"
) {}

const closeOnRunFailure = {
  whenRunFails: "close",
  failureCode: "test.release_gate_failed",
} as const;
const discountFlags = [
  "calendar_sales",
  "customer_discounts",
  "discount_codes",
] as const;

const analyticsConsentCookie = `cc_cookie=${savedConsentCookieValue({ categories: ["necessary", "analytics"] })}`;
const visitorHeaders = (distinctId: string) =>
  new Headers({
    cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=${distinctId}; ${POSTHOG_SESSION_ID_COOKIE}=session-id`,
  });
const anonymousHeaders = () => new Headers();

const decideForRequest = <Self>(gate: ReleaseGateClass<Self>) =>
  releaseGateForRequest(gate, {
    operation: "test.landing-gate",
    ...closeOnRunFailure,
  }).isOpen();

/** The gates and flags a landing page reads, each in its own run. */
const renderLandingPage = () =>
  Promise.all([
    decideForRequest(OfficeGate),
    decideForRequest(MeetingRoomGate),
    decideForRequest(ReferralGate),
    decideForRequest(SiteToolsGate),
    WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.evaluateFlags({ flagKeys: discountFlags })
      ),
      Effect.map((flags) => flags.getFlag("calendar_sales") === true),
      Effect.provide(WorkspaceFeatureFlagService.Default),
      runWorkspaceEffect("test.sale-banner")
    ),
  ]);

const readGatesInOneRun = Effect.all([
  OfficeGate.isOpen,
  MeetingRoomGate.isOpen,
  ReferralGate.isOpen,
]);

let now = 0;
/** Runs `effect` on a clock that reads `now`. */
const onTestClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Clock.clockWith((clock) =>
    effect.pipe(
      Effect.provideService(Clock.Clock, {
        currentTimeMillisUnsafe: () => now,
        currentTimeMillis: Effect.sync(() => now),
        currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
        sleep: (duration) => clock.sleep(duration),
      })
    )
  );

/** Whether an anonymous visitor's request at `time` sees the office open. */
const readOfficeAnonymouslyAt = (time: number) => {
  now = time;
  return WorkspaceFeatureFlagService.pipe(
    Effect.flatMap((featureFlags) => featureFlags.isEnabled("office_page")),
    Effect.provide(WorkspaceFeatureFlagService.Default),
    withWorkspaceRequestContext(anonymousHeaders()),
    onTestClock,
    Effect.option,
    Effect.runPromise
  );
};

const millisOf = (lifetime: `${number} seconds`) =>
  Number.parseInt(lifetime, 10) * 1000;

const unavailable = Effect.fail(
  new PostHogFeatureFlagEvaluationError({
    message: "Synthetic PostHog outage",
    cause: undefined,
  })
);

const disabledWarningCode = "feature_flags.remote_evaluation_disabled";

const recordLogs = <A, E>(effect: Effect.Effect<A, E>) => {
  const annotations: Record<string, unknown>[] = [];
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            annotations.push(
              options.fiber.getRef(References.CurrentLogAnnotations)
            );
          }),
        ])
      )
    )
  ).then((value) => ({ value, annotations }));
};

beforeEach(() => {
  constants = {};
  policy = "allowed";
  remoteAnswer = Effect.succeed({});
  nextRequestHeaders = new Headers();
  remoteEvaluations.length = 0;
});

describe("one remote evaluation per request", () => {
  test("a landing render's server components share one evaluation of every undecided flag", async () => {
    // Incomplete classification: no flag is known to be constant.
    nextRequestHeaders = visitorHeaders("landing-visitor");
    remoteAnswer = Effect.succeed({
      calendar_sales: true,
      meeting_room_page: true,
      office_page: false,
      referrals: true,
      webmcp_site_tools: false,
    });

    await expect(renderLandingPage()).resolves.toEqual([
      false,
      true,
      true,
      false,
      true,
    ]);

    expect(remoteEvaluations).toEqual([
      { distinctId: "landing-visitor", flagKeys: [...postHogFeatureFlags.keys] },
    ]);
  });

  test("an anonymous production landing render makes one remote evaluation", async () => {
    constants = { account_avatars: false, login_passkeys: true };
    nextRequestHeaders = anonymousHeaders();
    remoteAnswer = Effect.succeed({
      calendar_sales: false,
      meeting_room_page: true,
      office_page: true,
      referrals: false,
      webmcp_site_tools: true,
    });

    await expect(renderLandingPage()).resolves.toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);

    expect(remoteEvaluations).toHaveLength(1);
    expect(remoteEvaluations[0]?.distinctId).toBe(
      "deskohub-workspace:global-release"
    );
    expect(remoteEvaluations[0]?.flagKeys).not.toContain("login_passkeys");
  });

  test("a Server Action shares its request's evaluation with the page", async () => {
    constants = { calendar_sales: true };
    nextRequestHeaders = visitorHeaders("acting-visitor");
    remoteAnswer = Effect.succeed({ office_page: true, referrals: true });

    await renderLandingPage();
    // The action boundary captures Next's request headers for its run.
    const actionGates = await readGatesInOneRun.pipe(
      Effect.provide(
        Layer.mergeAll(OfficeGate.Live, MeetingRoomGate.Live, ReferralGate.Live)
      ),
      withWorkspaceRequestContext(nextRequestHeaders),
      runWorkspaceEffect("test.action")
    );

    expect(actionGates).toEqual([true, false, true]);
    expect(remoteEvaluations).toHaveLength(1);
  });

  test("a route handler's gates share one evaluation per request", async () => {
    remoteAnswer = Effect.succeed({ office_page: true, referrals: true });
    const handleRoute = (request: Request) =>
      readGatesInOneRun.pipe(
        Effect.provide(
          Layer.mergeAll(
            releaseGateForRun(OfficeGate, closeOnRunFailure),
            releaseGateForRun(MeetingRoomGate, closeOnRunFailure),
            releaseGateForRun(ReferralGate, closeOnRunFailure)
          )
        ),
        withWorkspaceRequestContext(request.headers),
        runWorkspaceEffect("test.route")
      );

    const first = new Request("https://workspace.test/api", {
      headers: visitorHeaders("route-visitor"),
    });
    await expect(handleRoute(first)).resolves.toEqual([true, false, true]);
    expect(remoteEvaluations).toHaveLength(1);

    const second = new Request("https://workspace.test/api", {
      headers: visitorHeaders("route-visitor"),
    });
    await handleRoute(second);
    expect(remoteEvaluations).toHaveLength(2);
  });

  test("a run outside any request evaluates once per run", async () => {
    remoteAnswer = Effect.succeed({ office_page: true });
    const queuedRun = () =>
      readGatesInOneRun.pipe(
        Effect.provide(
          Layer.mergeAll(
            releaseGateForRun(OfficeGate, closeOnRunFailure),
            releaseGateForRun(MeetingRoomGate, closeOnRunFailure),
            releaseGateForRun(ReferralGate, closeOnRunFailure)
          )
        ),
        // An identified subject outside any request bypasses the shared cache.
        Effect.provideService(
          CurrentVisitorIdentity,
          Option.some({ distinctId: PostHogDistinctId.make("queued-visitor") })
        ),
        runWorkspaceEffect("test.queue")
      );

    await expect(queuedRun()).resolves.toEqual([true, false, false]);
    expect(remoteEvaluations).toHaveLength(1);

    await queuedRun();
    expect(remoteEvaluations).toHaveLength(2);
  });

  test("a task's anonymous run shares one evaluation", async () => {
    constants = { seating_map: true };
    remoteAnswer = Effect.succeed({ office_page: true });

    await readGatesInOneRun.pipe(
      Effect.provide(
        Layer.mergeAll(
          releaseGateForRun(OfficeGate, closeOnRunFailure),
          releaseGateForRun(ReferralGate, closeOnRunFailure),
          releaseGateForRun(MeetingRoomGate, closeOnRunFailure)
        )
      ),
      withAnonymousVisitor,
      runWorkspaceEffect("test.task")
    );

    expect(remoteEvaluations).toHaveLength(1);
  });
});

describe("the global subject's shared evaluation", () => {
  test("is reused within its lifetime and evaluated again after it", async () => {
    constants = { account_avatars: false };
    remoteAnswer = Effect.succeed(
      Object.fromEntries(postHogFeatureFlags.keys.map((key) => [key, true]))
    );
    const lifetime = millisOf(globalReleaseEvaluationLifetime);

    expect(await readOfficeAnonymouslyAt(0)).toEqual(Option.some(true));
    expect(await readOfficeAnonymouslyAt(lifetime - 1)).toEqual(
      Option.some(true)
    );
    expect(remoteEvaluations).toHaveLength(1);

    await readOfficeAnonymouslyAt(lifetime);
    expect(remoteEvaluations).toHaveLength(2);
  });

  test("keeps a failed evaluation only for the shorter lifetime", async () => {
    constants = { account_avatars: false, calendar_sales: false };
    remoteAnswer = unavailable;
    const lifetime = millisOf(unavailableGlobalReleaseEvaluationLifetime);

    expect(await readOfficeAnonymouslyAt(0)).toEqual(Option.none());
    expect(await readOfficeAnonymouslyAt(lifetime - 1)).toEqual(Option.none());
    expect(remoteEvaluations).toHaveLength(1);

    remoteAnswer = Effect.succeed({ office_page: true });
    expect(await readOfficeAnonymouslyAt(lifetime)).toEqual(Option.some(true));
    expect(remoteEvaluations).toHaveLength(2);
  });

  test("keeps an evaluation PostHog left incomplete only for the shorter lifetime", async () => {
    constants = { account_avatars: false, customer_discounts: false };
    // posthog-node answers a quota-limited evaluation with no flags.
    remoteAnswer = Effect.succeed({});
    const lifetime = millisOf(unavailableGlobalReleaseEvaluationLifetime);

    expect(await readOfficeAnonymouslyAt(0)).toEqual(Option.none());
    await readOfficeAnonymouslyAt(lifetime - 1);
    expect(remoteEvaluations).toHaveLength(1);

    await readOfficeAnonymouslyAt(lifetime);
    expect(remoteEvaluations).toHaveLength(2);
  });

  test("never serves an identified visitor", async () => {
    remoteAnswer = Effect.succeed({ office_page: true });
    const readOfficeFor = (headers: Headers) =>
      WorkspaceFeatureFlagService.pipe(
        Effect.flatMap((featureFlags) => featureFlags.isEnabled("office_page")),
        Effect.provide(WorkspaceFeatureFlagService.Default),
        withWorkspaceRequestContext(headers),
        onTestClock,
        Effect.runPromise
      );
    now = 0;

    await readOfficeFor(visitorHeaders("cached-visitor"));
    await readOfficeFor(visitorHeaders("cached-visitor"));

    expect(remoteEvaluations.map(({ distinctId }) => distinctId)).toEqual([
      "cached-visitor",
      "cached-visitor",
    ]);
  });
});

describe("disabled remote evaluation", () => {
  test("closes undecided flags without calling PostHog, warning once per flag", async () => {
    policy = "disabled";
    constants = { office_page: true, login_passkeys: true };
    const undecided = postHogFeatureFlags.keys.filter(
      (key) => constants[key] === undefined
    );
    const readGatesFor = (headers: Headers) =>
      readGatesInOneRun.pipe(
        Effect.provide(
          Layer.mergeAll(
            OfficeGate.Live,
            MeetingRoomGate.Live,
            ReferralGate.Live
          )
        ),
        withWorkspaceRequestContext(headers),
        recordLogs
      );

    const first = await readGatesFor(visitorHeaders("disabled-visitor"));
    const second = await readGatesFor(anonymousHeaders());

    expect(first.value).toEqual([true, false, false]);
    expect(second.value).toEqual([true, false, false]);
    expect(remoteEvaluations).toHaveLength(0);
    const disabledWarnings = [...first.annotations, ...second.annotations]
      .filter(({ code }) => code === disabledWarningCode)
      .map(({ featureFlag }) => featureFlag);
    expect(disabledWarnings.toSorted()).toEqual(undecided.toSorted());
  });
});
