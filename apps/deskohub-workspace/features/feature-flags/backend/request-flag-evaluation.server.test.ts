import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  PostHogFeatureFlagEvaluationError,
  type PostHogFeatureFlagSubject,
} from "@deskohub/posthog/feature-flags/node";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import {
  Clock,
  type Context,
  Effect,
  Layer,
  Logger,
  Option,
  References,
} from "effect";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import { savedConsentCookieValue } from "@/shared/testing/consent-cookie.test-utils";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
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
/** What PostHog may answer, variants included. */
type RemoteFlagValues = Partial<
  Record<PostHogFeatureFlagKey, boolean | string>
>;
type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

// The flags the classification settles: constants and overrides.
let constants: FlagValues = {};
// The deployment the evaluation runs in; its policy decides remote calls.
let deploymentEnvironment: DeploymentEnvironment = "production";
// What PostHog answers a remote evaluation with.
let remoteAnswer: Effect.Effect<
  RemoteFlagValues,
  PostHogFeatureFlagEvaluationError
> = Effect.succeed({});
// The headers object Next's request store hands out for the current request.
let nextRequestHeaders = new Headers();
// Resolves once the render reaches request time; a prerender, Next's runtime
// prerender for runtime prefetches included, never does.
let requestStarts: Promise<void> = Promise.resolve();

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
// Kept before the mock replaces the module, so the deployment's policy comes
// from the real mapping.
const { remoteEvaluationPolicyFor } = await import(
  "./remote-evaluation-policy.server"
);
mock.module("./remote-evaluation-policy.server", () => ({
  remoteEvaluationPolicyFor,
  readRemoteEvaluationPolicy: () =>
    remoteEvaluationPolicyFor(deploymentEnvironment),
}));
// The real global release reads the classification through `"use cache"`.
mock.module("next/cache", () => recordNextCache().module);
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => requestStarts,
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

/** Serves `effect` as a new request whose boundary captured `headers`. */
const inNewRequest = (headers: Headers) => {
  nextRequestHeaders = new Headers(headers);
  return withWorkspaceRequestContext(headers);
};

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
    inNewRequest(anonymousHeaders()),
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
  const annotations: LogAnnotations[] = [];
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
  deploymentEnvironment = "production";
  remoteAnswer = Effect.succeed({});
  nextRequestHeaders = new Headers();
  requestStarts = Promise.resolve();
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
      {
        distinctId: "landing-visitor",
        flagKeys: [...postHogFeatureFlags.keys],
      },
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
    const handleRoute = (request: Request) => {
      // Next's request store holds its own copy of the request's headers.
      nextRequestHeaders = new Headers(request.headers);
      return readGatesInOneRun.pipe(
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
    };

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

  test("a route handler shares its evaluation with the request's own gate runs", async () => {
    remoteAnswer = Effect.succeed({ office_page: true });
    const request = new Request("https://workspace.test/api", {
      headers: visitorHeaders("mixed-route-visitor"),
    });
    nextRequestHeaders = new Headers(request.headers);

    const [boundaryGates, requestGate] = await Promise.all([
      readGatesInOneRun.pipe(
        Effect.provide(
          Layer.mergeAll(
            OfficeGate.Live,
            MeetingRoomGate.Live,
            ReferralGate.Live
          )
        ),
        withWorkspaceRequestContext(request.headers),
        runWorkspaceEffect("test.route")
      ),
      decideForRequest(OfficeGate),
    ]);

    expect(boundaryGates).toEqual([true, false, false]);
    expect(requestGate).toBe(true);
    expect(remoteEvaluations).toHaveLength(1);
  });

  test("opens a gate only for true, never for a variant", async () => {
    nextRequestHeaders = visitorHeaders("variant-visitor");
    remoteAnswer = Effect.succeed({ office_page: "treatment" });

    await expect(decideForRequest(OfficeGate)).resolves.toBe(false);
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
        inNewRequest(headers),
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

describe("remote evaluation outside production", () => {
  // Runs first: each flag warns only the first time this isolate closes it.
  test("closes undecided flags without calling PostHog, warning once per flag", async () => {
    deploymentEnvironment = "preview";
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
        inNewRequest(headers),
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

  for (const environment of ["preview", "development"] as const) {
    test(`a ${environment} landing render reads overrides and constants only`, async () => {
      deploymentEnvironment = environment;
      // An override opens referrals; office and the discounts stay undecided.
      constants = { referrals: true, meeting_room_page: true };
      remoteAnswer = Effect.succeed({
        office_page: true,
        calendar_sales: true,
      });
      nextRequestHeaders = visitorHeaders(`${environment}-visitor`);

      await expect(renderLandingPage()).resolves.toEqual([
        false,
        true,
        true,
        false,
        false,
      ]);
      expect(remoteEvaluations).toHaveLength(0);
    });
  }
});

describe("remote evaluation in production", () => {
  test("a prerender decides constant gates and leaves PostHog to request time", async () => {
    // posthog-node reads the clock before its request, which Next.js reports
    // as an error while prerendering (#1187).
    constants = { referrals: true, meeting_room_page: false };
    remoteAnswer = Effect.succeed({ office_page: true });
    nextRequestHeaders = visitorHeaders("prerendered-visitor");
    const { promise: requestTime, resolve: startRequest } =
      Promise.withResolvers<void>();
    requestStarts = requestTime;

    const office = decideForRequest(OfficeGate);
    await expect(decideForRequest(ReferralGate)).resolves.toBe(true);
    await expect(decideForRequest(MeetingRoomGate)).resolves.toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(remoteEvaluations).toEqual([]);

    startRequest();
    await expect(office).resolves.toBe(true);
    expect(remoteEvaluations).toHaveLength(1);
  });

  test("a landing render evaluates every undecided flag in one batched call", async () => {
    constants = { referrals: true, meeting_room_page: true };
    remoteAnswer = Effect.succeed({ office_page: true, calendar_sales: true });
    nextRequestHeaders = visitorHeaders("production-visitor");

    await expect(renderLandingPage()).resolves.toEqual([
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(remoteEvaluations).toEqual([
      {
        distinctId: "production-visitor",
        flagKeys: postHogFeatureFlags.keys.filter(
          (key) => constants[key] === undefined
        ),
      },
    ]);
  });
});
