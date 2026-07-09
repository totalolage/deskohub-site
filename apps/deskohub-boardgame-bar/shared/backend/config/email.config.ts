/**
 * Email Configuration
 *
 * Configuration for the email service
 */

import {
  EmailConfigTag,
  type EmailProviderConfig,
  StandaloneEmailServiceLayer,
} from "@deskohub/email";
import { Config, Layer, Option } from "effect";
import { siteConstants } from "@/shared/utils/constants";

/**
 * Email configuration from environment variables
 */
const emailConfig = Config.all({
  provider: Config.option(
    Config.literals(["resend", "console"], "EMAIL_PROVIDER")
  ),
  defaultFromEmail: Config.withDefault(
    Config.string("EMAIL_FROM_ADDRESS"),
    siteConstants.contact.fromEmail
  ),
  defaultFromName: Config.withDefault(
    Config.string("EMAIL_FROM_NAME"),
    siteConstants.brand.name
  ),
  apiKey: Config.option(Config.string("EMAIL_API_KEY")),
  testMode: Config.withDefault(Config.boolean("EMAIL_TEST_MODE"), false),
});

/**
 * Email configuration layer
 */
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
          email: config.defaultFromEmail,
          name: config.defaultFromName,
        },
        apiKey,
        testMode: config.testMode,
      };
      return providerConfig;
    })
  )
);

export const EmailServiceLayer = StandaloneEmailServiceLayer.pipe(
  Layer.provide(EmailConfigLayer)
);
