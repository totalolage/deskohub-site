import { describe, expect, test } from "bun:test";
import type { PostHogFeatureFlagSnapshot } from "@deskohub/posthog/feature-flags";
import {
  type PostHogFeatureFlagDefinition,
  PostHogFeatureFlagError,
} from "@deskohub/posthog/feature-flags/management";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import {
  type ConstantFeatureFlagValues,
  featureFlagSnapshotMaxAge,
  makeFeatureFlagClassifier,
} from "./feature-flag-classification";

const snapshotTime = Date.parse("2026-11-01T00:00:00.000Z");

const snapshot: PostHogFeatureFlagSnapshot<PostHogFeatureFlagKey> = {
  generatedAt: new Date(snapshotTime).toISOString(),
  constantValues: {
    account_avatars: null,
    calendar_sales: true,
    customer_discounts: false,
    discount_codes: true,
    login_email_code: true,
    login_passkeys: true,
    meeting_room_page: true,
    office_page: false,
    referrals: false,
    seating_map: false,
    webmcp_site_tools: false,
  },
};

const liveDefinitions: readonly PostHogFeatureFlagDefinition[] = [
  {
    constantEnabledValue: true,
    key: "meeting_room_page",
    payloads: {},
    variants: [],
  },
  {
    constantEnabledValue: false,
    key: "office_page",
    payloads: {},
    variants: [],
  },
  { key: "account_avatars", payloads: {}, variants: [] },
  {
    constantEnabledValue: true,
    key: "outside_contract",
    payloads: {},
    variants: [],
  },
];

const live = Effect.succeed(liveDefinitions);
const listFailure = Effect.fail(
  new PostHogFeatureFlagError({
    message: "Could not list PostHog feature flags.",
    failureCode: "StatusCodeError",
    httpStatus: 429,
  })
);

/** Runs `classify` with the clock at `elapsed` after the snapshot. */
const runAt = <A>(elapsed: Duration.Input, classify: Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(snapshotTime + Duration.toMillis(elapsed));
      return yield* classify;
    }).pipe(Effect.provide(TestClock.layer()))
  );

const noOverrides: ConstantFeatureFlagValues = {};

const pastSnapshotLimit = (millis: number) =>
  Duration.millis(Duration.toMillis(featureFlagSnapshotMaxAge) + millis);

describe("makeFeatureFlagClassifier", () => {
  test("classifies the contract flags PostHog reports as constant", async () => {
    const classify = makeFeatureFlagClassifier({ snapshot });

    const classification = await runAt(
      "1 hour",
      classify({ definitions: live, overrides: noOverrides })
    );

    expect(classification).toEqual({
      source: "live",
      values: { meeting_room_page: true, office_page: false },
    });
  });

  test("keeps the last complete classification when a refresh fails", async () => {
    const classify = makeFeatureFlagClassifier({ snapshot });

    const classification = await runAt(
      pastSnapshotLimit(Duration.toMillis(Duration.days(1))),
      Effect.gen(function* () {
        yield* classify({ definitions: live, overrides: noOverrides });
        return yield* classify({
          definitions: listFailure,
          overrides: noOverrides,
        });
      })
    );

    expect(classification).toEqual({
      source: "last-known",
      values: { meeting_room_page: true, office_page: false },
    });
  });

  test("keeps the last complete classification however long PostHog stays unavailable", async () => {
    const classify = makeFeatureFlagClassifier({ snapshot });

    const classification = await runAt(
      "0 millis",
      Effect.gen(function* () {
        yield* classify({ definitions: live, overrides: noOverrides });
        yield* TestClock.adjust(pastSnapshotLimit(1));
        return yield* classify({
          definitions: listFailure,
          overrides: noOverrides,
        });
      })
    );

    expect(classification).toEqual({
      source: "last-known",
      values: { meeting_room_page: true, office_page: false },
    });
  });

  test("rejects a snapshot read further in the future than clock skew allows", async () => {
    const classify = makeFeatureFlagClassifier({ snapshot });

    const [withinSkew, beyondSkew] = await runAt(
      "-4 minutes",
      Effect.gen(function* () {
        const near = yield* classify({
          definitions: listFailure,
          overrides: noOverrides,
        });
        yield* TestClock.setTime(snapshotTime - Duration.toMillis("6 minutes"));
        const far = yield* classify({
          definitions: listFailure,
          overrides: noOverrides,
        });
        return [near.source, far.source];
      })
    );

    expect([withinSkew, beyondSkew]).toEqual(["snapshot", "none"]);
  });

  test("uses a fresh snapshot when PostHog never answered", async () => {
    const classify = makeFeatureFlagClassifier({ snapshot });

    const classification = await runAt(
      featureFlagSnapshotMaxAge,
      classify({ definitions: listFailure, overrides: noOverrides })
    );

    expect(classification).toEqual({
      source: "snapshot",
      values: {
        calendar_sales: true,
        customer_discounts: false,
        discount_codes: true,
        login_email_code: true,
        login_passkeys: true,
        meeting_room_page: true,
        office_page: false,
        referrals: false,
        seating_map: false,
        webmcp_site_tools: false,
      },
    });
  });

  test("leaves only the overrides constant with a stale or missing snapshot", async () => {
    const overrides: ConstantFeatureFlagValues = { referrals: true };
    const stale = makeFeatureFlagClassifier({ snapshot });
    const missing = makeFeatureFlagClassifier({ snapshot: undefined });
    const pastLimit = pastSnapshotLimit(1);

    const classifications = await runAt(
      pastLimit,
      Effect.all([
        stale({ definitions: listFailure, overrides }),
        stale({ definitions: listFailure, overrides }),
        missing({ definitions: listFailure, overrides }),
      ])
    );

    expect(classifications).toEqual([
      { source: "none", values: overrides },
      { source: "none", values: overrides },
      { source: "none", values: overrides },
    ]);
  });

  test("lets overrides win over live, last-known and snapshot values", async () => {
    const overrides: ConstantFeatureFlagValues = {
      account_avatars: true,
      meeting_room_page: false,
      office_page: true,
    };
    const fromLive = makeFeatureFlagClassifier({ snapshot });
    const fromSnapshot = makeFeatureFlagClassifier({ snapshot });

    const [liveValues, lastKnownValues, snapshotValues] = await runAt(
      "1 hour",
      Effect.gen(function* () {
        const liveClassification = yield* fromLive({
          definitions: live,
          overrides,
        });
        const lastKnownClassification = yield* fromLive({
          definitions: listFailure,
          overrides,
        });
        const snapshotClassification = yield* fromSnapshot({
          definitions: listFailure,
          overrides,
        });
        return [
          liveClassification,
          lastKnownClassification,
          snapshotClassification,
        ].map(({ source, values }) => ({ source, ...pick(values) }));
      })
    );

    for (const [values, source] of [
      [liveValues, "live"],
      [lastKnownValues, "last-known"],
      [snapshotValues, "snapshot"],
    ] as const) {
      expect(values).toEqual({ source, ...overrides });
    }
  });
});

const pick = ({
  account_avatars,
  meeting_room_page,
  office_page,
}: ConstantFeatureFlagValues) => ({
  account_avatars,
  meeting_room_page,
  office_page,
});
