import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { EmailProviderConfig } from "../types/email.types";
import { EmailProviderLive } from "./provider-factory";
import { EmailConfigTag, EmailProviderTag } from "./service";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const config: EmailProviderConfig = {
  provider: "console" as const,
  defaultFrom: { email: "deskohub@example.test" },
};

const providerName = (overrides: Partial<EmailProviderConfig> = {}) =>
  Effect.runPromise(
    EmailProviderTag.pipe(
      Effect.map((provider) => provider.name),
      Effect.provide(
        EmailProviderLive.pipe(
          Layer.provide(
            Layer.succeed(EmailConfigTag, { ...config, ...overrides })
          )
        )
      )
    )
  );

describe("EmailProviderLive", () => {
  test("chooses provider from EmailConfigTag", async () => {
    process.env.NODE_ENV = "test";
    expect(await providerName()).toBe("console");
    expect(await providerName({ provider: "resend", apiKey: "api-key" })).toBe(
      "resend"
    );
  });

  test("fails for production console and resend without api key", async () => {
    process.env.NODE_ENV = "production";

    expect(await providerName({ apiKey: "api-key" })).toBe("resend");

    const consoleResult = await Effect.runPromise(
      EmailProviderTag.pipe(
        Effect.provide(
          EmailProviderLive.pipe(
            Layer.provide(Layer.succeed(EmailConfigTag, config))
          )
        ),
        Effect.result
      )
    );
    expect(consoleResult._tag).toBe("Failure");

    process.env.NODE_ENV = "test";
    const resendResult = await Effect.runPromise(
      EmailProviderTag.pipe(
        Effect.provide(
          EmailProviderLive.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                ...config,
                provider: "resend",
              })
            )
          )
        ),
        Effect.result
      )
    );
    expect(resendResult._tag).toBe("Failure");
  });

  test("allows console provider in Vercel preview production builds", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";

    expect(await providerName({ apiKey: "api-key" })).toBe("console");
  });
});
