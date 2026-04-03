import type { EmailProviderConfig } from "@deskohub/email";
import { EmailConfigTag } from "@deskohub/email";
import { Config, Layer } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

const emailConfig = Config.all({
  provider: Config.withDefault(
    Config.literal(
      "resend",
      "smtp",
      "sendgrid",
      "mailgun",
      "console"
    )("EMAIL_PROVIDER"),
    "console" as const
  ),
  defaultFromEmail: Config.withDefault(
    Config.string("EMAIL_FROM_ADDRESS"),
    "mail@deskohub.cz"
  ),
  defaultFromName: Config.withDefault(
    Config.string("EMAIL_FROM_NAME"),
    workspaceSiteConstants.brand.name
  ),
  apiKey: Config.option(Config.string("EMAIL_API_KEY")),
  smtpHost: Config.option(Config.string("EMAIL_SMTP_HOST")),
  smtpPort: Config.option(Config.number("EMAIL_SMTP_PORT")),
  smtpUser: Config.option(Config.string("EMAIL_SMTP_USER")),
  smtpPassword: Config.option(Config.string("EMAIL_SMTP_PASSWORD")),
  smtpSecure: Config.withDefault(Config.boolean("EMAIL_SMTP_SECURE"), true),
  testMode: Config.withDefault(Config.boolean("EMAIL_TEST_MODE"), false),
});

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
        apiKey: config.apiKey._tag === "Some" ? config.apiKey.value : undefined,
        smtpHost:
          config.smtpHost._tag === "Some" ? config.smtpHost.value : undefined,
        smtpPort:
          config.smtpPort._tag === "Some" ? config.smtpPort.value : undefined,
        smtpUser:
          config.smtpUser._tag === "Some" ? config.smtpUser.value : undefined,
        smtpPassword:
          config.smtpPassword._tag === "Some"
            ? config.smtpPassword.value
            : undefined,
        smtpSecure: config.smtpSecure,
        testMode: config.testMode,
      };

      return providerConfig;
    })
  )
);
