import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

const createClient = (evaluationResult: Promise<boolean>) => {
  const isEnabled = mock(() => false);
  const evaluateFlags = mock(() =>
    evaluationResult.then((enabled) => {
      isEnabled.mockReturnValue(enabled);
      return { isEnabled };
    })
  );
  const shutdown = mock(() => Promise.resolve());

  return {
    client: { evaluateFlags, shutdown },
    evaluateFlags,
    isEnabled,
    shutdown,
  };
};

describe("isPostHogFeatureFlagEnabled", () => {
  test("returns true for an enabled boolean flag", async () => {
    const { isPostHogFeatureFlagEnabled } = await import(
      "./posthog-feature-flag"
    );
    const { client, evaluateFlags, isEnabled, shutdown } = createClient(
      Promise.resolve(true)
    );

    await expect(
      Effect.runPromise(
        isPostHogFeatureFlagEnabled({
          client,
          distinctId: "public-site",
          key: "meeting_room_page",
        })
      )
    ).resolves.toBe(true);

    expect(evaluateFlags).toHaveBeenCalledWith("public-site", {
      disableGeoip: true,
      flagKeys: ["meeting_room_page"],
    });
    expect(isEnabled).toHaveBeenCalledWith("meeting_room_page");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  test("returns false for disabled and absent flags", async () => {
    const { isPostHogFeatureFlagEnabled } = await import(
      "./posthog-feature-flag"
    );

    await expect(
      Effect.runPromise(
        isPostHogFeatureFlagEnabled({
          client: createClient(Promise.resolve(false)).client,
          distinctId: "public-site",
          key: "meeting_room_page",
        })
      )
    ).resolves.toBe(false);
  });

  test("transmits PostHog evaluation failures through the Effect error channel", async () => {
    const { isPostHogFeatureFlagEnabled, PostHogFeatureFlagEvaluationError } =
      await import("./posthog-feature-flag");
    const { client, shutdown } = createClient(
      Promise.reject(new Error("PostHog unavailable"))
    );

    const result = await Effect.runPromise(
      isPostHogFeatureFlagEnabled({
        client,
        distinctId: "public-site",
        key: "meeting_room_page",
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined,
        })
      )
    );

    expect(result).toBeInstanceOf(PostHogFeatureFlagEvaluationError);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
