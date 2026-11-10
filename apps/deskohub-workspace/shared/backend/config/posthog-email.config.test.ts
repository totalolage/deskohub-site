import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Logger, Option, Redacted } from "effect";
import { configuredPostHogEmailConnection } from "./posthog-email.config";

const connectionFrom = async (config: Readonly<Record<string, string>>) => {
  const warnings: unknown[] = [];
  const connection = await Effect.runPromise(
    configuredPostHogEmailConnection.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(config)
      ),
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, message }) => {
            if (logLevel === "Warn") warnings.push(message);
          }),
        ])
      )
    )
  );
  return { connection, warnings };
};

describe("configured PostHog email connection", () => {
  test("reaches the API host with the trimmed, redacted secret key", async () => {
    const { connection } = await connectionFrom({
      POSTHOG_EMAIL_SECRET_KEY: " phs_synthetic ",
      POSTHOG_API_HOST: "https://eu.i.posthog.com",
    });

    expect(Option.isSome(connection)).toBe(true);
    if (Option.isSome(connection)) {
      expect(connection.value.host).toBe("https://eu.i.posthog.com");
      expect(Redacted.value(connection.value.secretKey)).toBe("phs_synthetic");
    }
  });

  test.each([
    ["missing", {}],
    ["blank", { POSTHOG_EMAIL_SECRET_KEY: "   " }],
  ])("is none while the secret key is %s", async (_, keyConfig) => {
    const { connection, warnings } = await connectionFrom({
      ...keyConfig,
      POSTHOG_API_HOST: "https://eu.i.posthog.com",
    });

    expect(Option.isNone(connection)).toBe(true);
    expect(warnings).toEqual([]);
  });

  test("is none, with a warning, for a secret key without a host", async () => {
    const { connection, warnings } = await connectionFrom({
      POSTHOG_EMAIL_SECRET_KEY: "phs_synthetic",
    });

    expect(Option.isNone(connection)).toBe(true);
    expect(warnings).toHaveLength(1);
  });
});
