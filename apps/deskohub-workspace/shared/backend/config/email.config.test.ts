import { describe, expect, test } from "bun:test";
import { EmailConfigTag } from "@deskohub/email";
import { ConfigProvider, Effect } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";
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
  test("defaults to console without email provider credentials", async () => {
    const config = await readConfig({});

    expect(config).toEqual({
      provider: "console",
      defaultFrom: {
        email: "reservations@workspace.deskohub.cz",
        name: workspaceSiteConstants.brand.name,
      },
      apiKey: undefined,
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
