import { describe, expect, mock, test } from "bun:test";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import { ConfigProvider, Effect } from "effect";
import { siteConstants } from "@/shared/utils/constants";
import { BoardgameEmailLayer, EmailConfigLayer } from "./email.config";

const resendSend = mock(async () => ({
  data: { id: "synthetic-resend-delivery" },
}));
mock.module("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const readConfig = (env: Record<string, string>) =>
  Effect.runPromise(
    EmailConfigTag.pipe(
      Effect.provide(EmailConfigLayer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env)
      )
    )
  );

describe("EmailConfigLayer", () => {
  test("missing optional values are undefined", async () => {
    const config = await readConfig({});

    expect(config).toEqual({
      provider: "console",
      defaultFrom: {
        email: siteConstants.contact.fromEmail,
        name: siteConstants.brand.name,
      },
      apiKey: undefined,
      testMode: false,
    });
  });

  test("defaults to resend when an API key is configured", async () => {
    const config = await readConfig({
      EMAIL_API_KEY: "api-key",
    });

    expect(config).toMatchObject({
      provider: "resend",
      apiKey: "api-key",
    });
  });

  test("keeps explicit console provider with an API key", async () => {
    const config = await readConfig({
      EMAIL_PROVIDER: "console",
      EMAIL_API_KEY: "api-key",
    });

    expect(config).toMatchObject({
      provider: "console",
      apiKey: "api-key",
    });
  });
});

test.each([
  {
    stage: { NODE_ENV: "production", VERCEL_ENV: "preview" },
    provider: "console",
  },
  {
    stage: { NODE_ENV: "production", VERCEL_ENV: "production" },
    provider: "resend",
  },
])(
  "BoardgameEmailLayer sends through $provider for $stage",
  async ({ stage, provider }) => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send({
          from: { email: "boardgame-sender@deskohub.test" },
          to: { email: "boardgame-recipient@deskohub.test" },
          subject: "Synthetic composition check",
          text: "Synthetic body",
        });
      }).pipe(
        Effect.provide(BoardgameEmailLayer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            ...stage,
            EMAIL_PROVIDER: "console",
            EMAIL_API_KEY: "re_test",
          })
        )
      )
    );
    expect(result.provider).toBe(provider);
  }
);
