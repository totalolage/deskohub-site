import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { definePostHogFeatureFlags } from "./contract";
import {
  createPostHogNodeFeatureFlags,
  PostHogFeatureFlagEvaluationError,
} from "./node";

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
