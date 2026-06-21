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
  provider: Config.withDefault(
    Config.literals(
      ["resend", "smtp", "sendgrid", "mailgun", "console"],
      "EMAIL_PROVIDER"
    ),
    "console" as const
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
  smtpHost: Config.option(Config.string("EMAIL_SMTP_HOST")),
  smtpPort: Config.option(Config.number("EMAIL_SMTP_PORT")),
  smtpUser: Config.option(Config.string("EMAIL_SMTP_USER")),
  smtpPassword: Config.option(Config.string("EMAIL_SMTP_PASSWORD")),
  smtpSecure: Config.withDefault(Config.boolean("EMAIL_SMTP_SECURE"), true),
  testMode: Config.withDefault(Config.boolean("EMAIL_TEST_MODE"), false),
});

/**
 * Email configuration layer
 */
export const EmailConfigLayer = Layer.effect(
  EmailConfigTag,
  emailConfig.pipe(
    Config.map((config) => {
      const providerConfig: EmailProviderConfig = {
        provider: config.provider,
        defaultFrom: {
          email: config.defaultFromEmail,
          name: config.defaultFromName,
        },
        apiKey: Option.getOrUndefined(config.apiKey),
        smtpHost: Option.getOrUndefined(config.smtpHost),
        smtpPort: Option.getOrUndefined(config.smtpPort),
        smtpUser: Option.getOrUndefined(config.smtpUser),
        smtpPassword: Option.getOrUndefined(config.smtpPassword),
        smtpSecure: config.smtpSecure,
        testMode: config.testMode,
      };
      return providerConfig;
    })
  )
);

export const EmailServiceLayer = StandaloneEmailServiceLayer.pipe(
  Layer.provide(EmailConfigLayer)
);
