import { describe, expect, test } from "bun:test";
import { EmailConfigTag } from "@deskohub/email";
import { ConfigProvider, Effect } from "effect";
import { siteConstants } from "@/shared/utils/constants";
import { EmailConfigLayer } from "./email.config";

const readConfig = (env: Record<string, string>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* EmailConfigTag;
    }).pipe(
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
      smtpHost: undefined,
      smtpPort: undefined,
      smtpUser: undefined,
      smtpPassword: undefined,
      smtpSecure: true,
      testMode: false,
    });
  });

  test("present API and SMTP values unwrap correctly", async () => {
    const config = await readConfig({
      EMAIL_PROVIDER: "smtp",
      EMAIL_FROM_ADDRESS: "from@example.test",
      EMAIL_FROM_NAME: "From Name",
      EMAIL_API_KEY: "api-key",
      EMAIL_SMTP_HOST: "smtp.example.test",
      EMAIL_SMTP_PORT: "2525",
      EMAIL_SMTP_USER: "smtp-user",
      EMAIL_SMTP_PASSWORD: "smtp-password",
      EMAIL_SMTP_SECURE: "false",
      EMAIL_TEST_MODE: "true",
    });

    expect(config).toEqual({
      provider: "smtp",
      defaultFrom: { email: "from@example.test", name: "From Name" },
      apiKey: "api-key",
      smtpHost: "smtp.example.test",
      smtpPort: 2525,
      smtpUser: "smtp-user",
      smtpPassword: "smtp-password",
      smtpSecure: false,
      testMode: true,
    });
  });
});
