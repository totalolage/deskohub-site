import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { definePostHogFeatureFlags } from "./contract";

const evaluateFlags = mock((_distinctId: string, _options?: unknown) =>
  Promise.resolve({
    getFlag: () => true,
    getFlagPayload: () => undefined,
    isEnabled: () => true,
  })
);
const getAllFlagsAndPayloads = mock((_distinctId: string, _options?: unknown) =>
  Promise.resolve({
    featureFlags: {
      meeting_room_page: true,
      room_experience: "treatment",
    },
    featureFlagPayloads: {
      room_experience: { capacity: 8 },
    },
  })
);
const getFeatureFlagResult = mock(
  (_key: string, _distinctId: string, _options?: unknown) =>
    Promise.resolve({
      enabled: true,
      key: "meeting_room_page",
      payload: undefined,
      variant: undefined,
    })
);
const shutdown = mock(() => Promise.resolve());
const createClient = mock((_projectToken: string, _options: unknown) => {});

mock.module("posthog-node", () => ({
  PostHog: function PostHog(projectToken: string, options: unknown) {
    createClient(projectToken, options);
    return {
      evaluateFlags,
      getAllFlagsAndPayloads,
      getFeatureFlagResult,
      shutdown,
    };
  },
}));

const contract = definePostHogFeatureFlags<{
  readonly meeting_room_page: {
    readonly payload: undefined;
    readonly value: boolean;
  };
  readonly room_experience: {
    readonly payload: { readonly capacity: number } | undefined;
    readonly value: false | "control" | "treatment";
  };
}>(["meeting_room_page", "room_experience"]);

describe("createPostHogNodeFeatureFlags", () => {
  test("returns a typed view over one evaluation snapshot", async () => {
    const { createPostHogNodeFeatureFlags } = await import("./node");
    const calls: unknown[] = [];
    const raw = {
      getFlag: (key: string) =>
        key === "room_experience" ? "treatment" : true,
      getFlagPayload: (key: string) =>
        key === "room_experience" ? { capacity: 8 } : undefined,
      isEnabled: () => true,
    };
    const featureFlags = createPostHogNodeFeatureFlags(contract, {
      evaluateFlags: (distinctId, options) => {
        calls.push({ distinctId, options });
        return Promise.resolve(raw);
      },
    });

    const flags = await Effect.runPromise(
      featureFlags.evaluateFlags("public-site", {
        disableGeoip: true,
        flagKeys: ["meeting_room_page", "room_experience"],
      })
    );

    expect(flags.isEnabled("meeting_room_page")).toBeTrue();
    expect(flags.getFlag("room_experience")).toBe("treatment");
    expect(flags.getFlagPayload("room_experience")).toEqual({ capacity: 8 });
    expect(flags.raw).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      distinctId: "public-site",
      options: expect.objectContaining({
        disableGeoip: true,
        flagKeys: ["meeting_room_page", "room_experience"],
      }),
    });
  });

  test("reports SDK failures through the Effect error channel", async () => {
    const { createPostHogNodeFeatureFlags, PostHogFeatureFlagEvaluationError } =
      await import("./node");
    const featureFlags = createPostHogNodeFeatureFlags(contract, {
      evaluateFlags: () => Promise.reject(new Error("network unavailable")),
    });

    const error = await Effect.runPromise(
      featureFlags.evaluateFlags("public-site").pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(PostHogFeatureFlagEvaluationError);
    expect(error.cause).toBeInstanceOf(Error);
  });
});

describe("makePostHogNodeFeatureFlagService", () => {
  test("suppresses access events for a non-recording batched subject", async () => {
    const { makePostHogNodeFeatureFlagService } = await import("./node");
    createClient.mockClear();
    evaluateFlags.mockClear();
    getAllFlagsAndPayloads.mockClear();
    const featureFlags = makePostHogNodeFeatureFlagService(contract, {
      defaultEvaluationOptions: { disableGeoip: true },
      projectToken: "phc_test",
    });

    const snapshot = await Effect.runPromise(
      featureFlags.evaluateFlags({
        options: {
          flagKeys: ["meeting_room_page", "room_experience"],
        },
        subject: {
          distinctId: "global-release",
          sendFeatureFlagEvents: false,
        },
      })
    );

    expect(snapshot.getFlag("meeting_room_page")).toBeTrue();
    expect(snapshot.getFlag("room_experience")).toBe("treatment");
    expect(snapshot.getFlagPayload("room_experience")).toEqual({ capacity: 8 });
    expect(snapshot.isEnabled("meeting_room_page")).toBeTrue();
    expect(getAllFlagsAndPayloads).toHaveBeenCalledTimes(1);
    expect(getAllFlagsAndPayloads).toHaveBeenCalledWith("global-release", {
      disableGeoip: true,
      flagKeys: ["meeting_room_page", "room_experience"],
    });
    expect(evaluateFlags).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledTimes(1);

    await Effect.runPromise(featureFlags.shutdown());
  });

  test("retains access events for a recording batched subject", async () => {
    const { makePostHogNodeFeatureFlagService } = await import("./node");
    createClient.mockClear();
    evaluateFlags.mockClear();
    getAllFlagsAndPayloads.mockClear();
    const featureFlags = makePostHogNodeFeatureFlagService(contract, {
      defaultEvaluationOptions: { disableGeoip: true },
      projectToken: "phc_test",
    });

    await Effect.runPromise(
      featureFlags.evaluateFlags({
        options: { flagKeys: ["meeting_room_page"] },
        subject: {
          distinctId: "visitor-id",
          sendFeatureFlagEvents: true,
        },
      })
    );

    expect(evaluateFlags).toHaveBeenCalledTimes(1);
    expect(evaluateFlags).toHaveBeenCalledWith("visitor-id", {
      disableGeoip: true,
      flagKeys: ["meeting_room_page"],
    });
    expect(getAllFlagsAndPayloads).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledTimes(1);

    await Effect.runPromise(featureFlags.shutdown());
  });

  test("acquires one scoped SDK client for the service lifetime", async () => {
    const { makePostHogNodeFeatureFlagService } = await import("./node");
    createClient.mockClear();
    evaluateFlags.mockClear();
    getAllFlagsAndPayloads.mockClear();
    getFeatureFlagResult.mockClear();
    shutdown.mockClear();
    const featureFlags = makePostHogNodeFeatureFlagService(contract, {
      clientOptions: {
        featureFlagsRequestTimeoutMs: 2_000,
        host: "https://posthog.example",
      },
      defaultEvaluationOptions: { disableGeoip: true },
      projectToken: "phc_test",
    });

    expect(createClient).not.toHaveBeenCalled();

    const firstEvaluation = await Effect.runPromise(
      featureFlags.isEnabled({
        key: "meeting_room_page",
        subject: {
          distinctId: "visitor-id",
          sendFeatureFlagEvents: true,
        },
      })
    );
    const secondEvaluation = await Effect.runPromise(
      featureFlags.isEnabled({
        key: "meeting_room_page",
        subject: {
          distinctId: "another-visitor-id",
          sendFeatureFlagEvents: false,
        },
      })
    );

    expect(firstEvaluation).toBeTrue();
    expect(secondEvaluation).toBeTrue();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("phc_test", {
      featureFlagsRequestTimeoutMs: 2_000,
      host: "https://posthog.example",
    });
    expect(getFeatureFlagResult).toHaveBeenNthCalledWith(
      1,
      "meeting_room_page",
      "visitor-id",
      {
        disableGeoip: true,
        sendFeatureFlagEvents: true,
      }
    );
    expect(getFeatureFlagResult).toHaveBeenNthCalledWith(
      2,
      "meeting_room_page",
      "another-visitor-id",
      {
        disableGeoip: true,
        sendFeatureFlagEvents: false,
      }
    );
    expect(shutdown).not.toHaveBeenCalled();

    await Effect.runPromise(featureFlags.shutdown());

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  test("reports missing runtime configuration through the Effect error channel", async () => {
    const {
      makePostHogNodeFeatureFlagService,
      PostHogFeatureFlagEvaluationError,
    } = await import("./node");
    createClient.mockClear();
    const featureFlags = makePostHogNodeFeatureFlagService(contract, {
      clientOptions: { host: "https://posthog.example" },
    });

    const error = await Effect.runPromise(
      featureFlags
        .isEnabled({
          key: "meeting_room_page",
          subject: {
            distinctId: "visitor-id",
            sendFeatureFlagEvents: true,
          },
        })
        .pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(PostHogFeatureFlagEvaluationError);
    expect(createClient).not.toHaveBeenCalled();
  });
});
