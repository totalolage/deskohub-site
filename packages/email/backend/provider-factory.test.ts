import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Effect, Layer } from "effect";
import type { EmailProviderConfig } from "../types/email.types";
import { EmailConfigTag, EmailProviderTag } from "./capabilities";
import { ConfiguredEmailProviderLayer } from "./provider-factory";

const providerName = (
  stage: Record<string, string>,
  overrides: Partial<EmailProviderConfig> = {}
) =>
  Effect.runPromise(
    EmailProviderTag.pipe(
      Effect.map((provider) => provider.name),
      Effect.provide(
        ConfiguredEmailProviderLayer.pipe(
          Layer.provide(
            Layer.succeed(EmailConfigTag, {
              provider: "console",
              defaultFrom: { email: testEmailAddress("sender") },
              ...overrides,
            })
          )
        )
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(stage)
      ),
      Effect.result
    )
  );

test.each([
  { stage: {}, allowed: true },
  { stage: { NODE_ENV: "test" }, allowed: true },
  { stage: { NODE_ENV: "development" }, allowed: true },
  { stage: { NODE_ENV: "unknown", VERCEL_ENV: "production" }, allowed: true },
  { stage: { NODE_ENV: "production" }, allowed: false },
  {
    stage: { NODE_ENV: "production", VERCEL_ENV: "development" },
    allowed: false,
  },
  { stage: { NODE_ENV: "production", VERCEL_ENV: "unknown" }, allowed: false },
  {
    stage: { NODE_ENV: "production", VERCEL_ENV: "production" },
    allowed: false,
  },
  { stage: { NODE_ENV: "production", VERCEL_ENV: "preview" }, allowed: true },
])("Console stage parity for $stage", async ({ stage, allowed }) => {
  const withoutKey = await providerName(stage);
  expect(withoutKey._tag).toBe(allowed ? "Success" : "Failure");
  if (withoutKey._tag === "Success") expect(withoutKey.success).toBe("console");
  if (withoutKey._tag === "Failure")
    expect(withoutKey.failure._tag).toBe("EmailServiceError");

  const withKey = await providerName(stage, { apiKey: "re_test" });
  expect(withKey._tag).toBe("Success");
  if (withKey._tag === "Success")
    expect(withKey.success).toBe(allowed ? "console" : "resend");
});

test("test mode permits Console in production and explicit Resend stays Resend", async () => {
  expect(
    await providerName({ NODE_ENV: "production" }, { testMode: true })
  ).toMatchObject({ _tag: "Success", success: "console" });
  expect(
    await providerName({}, { provider: "resend", apiKey: "re_test" })
  ).toMatchObject({ _tag: "Success", success: "resend" });
  expect(
    await providerName({ VERCEL_ENV: "preview" }, { provider: "resend" })
  ).toMatchObject({ _tag: "Failure" });
});
