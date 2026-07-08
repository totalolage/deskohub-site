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
      testMode: false,
    });
  });

  test("present API values unwrap correctly", async () => {
    const config = await readConfig({
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM_ADDRESS: "from@example.test",
      EMAIL_FROM_NAME: "From Name",
      EMAIL_API_KEY: "api-key",
      EMAIL_TEST_MODE: "true",
    });

    expect(config).toEqual({
      provider: "resend",
      defaultFrom: { email: "from@example.test", name: "From Name" },
      apiKey: "api-key",
      testMode: true,
    });
  });
});
