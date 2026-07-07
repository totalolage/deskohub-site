import type { EmailProviderConfig } from "@deskohub/email";
import { EmailConfigTag } from "@deskohub/email";
import { Config, Layer, Option } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

const defaultFromEmail = "reservations@workspace.deskohub.cz";

const emailConfig = Config.all({
  provider: Config.withDefault(
    Config.literals(["resend", "console"], "EMAIL_PROVIDER"),
    "console" as const
  ),
  apiKey: Config.option(Config.string("EMAIL_API_KEY")),
  testMode: Config.withDefault(Config.boolean("EMAIL_TEST_MODE"), false),
});

export const EmailConfigLayer = Layer.effect(
  EmailConfigTag,
  emailConfig.pipe(
    Config.map((config) => {
      const providerConfig: EmailProviderConfig = {
        provider: config.provider,
        defaultFrom: {
          email: defaultFromEmail,
          name: workspaceSiteConstants.brand.name,
        },
        apiKey: Option.getOrUndefined(config.apiKey),
        testMode: config.testMode,
      };

      return providerConfig;
    })
  )
);
