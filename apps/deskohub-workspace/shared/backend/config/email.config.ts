import type { EmailProviderConfig } from "@deskohub/email";
import { EmailConfigTag } from "@deskohub/email";
import { Config, Layer, Option } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

const defaultFromEmail = "reservations@workspace.deskohub.cz";

const emailConfig = Config.all({
  provider: Config.option(
    Config.literals(["resend", "console"], "EMAIL_PROVIDER")
  ),
  apiKey: Config.option(Config.string("EMAIL_API_KEY")),
});

export const EmailConfigLayer = Layer.effect(
  EmailConfigTag,
  emailConfig.pipe(
    Config.map((config) => {
      const apiKey = Option.getOrUndefined(config.apiKey);
      const provider: EmailProviderConfig["provider"] = Option.getOrElse(
        config.provider,
        () => (apiKey ? "resend" : "console")
      );
      const providerConfig: EmailProviderConfig = {
        provider,
        defaultFrom: {
          email: defaultFromEmail,
          name: workspaceSiteConstants.brand.name,
        },
        apiKey,
      };

      return providerConfig;
    })
  )
);
