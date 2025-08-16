import { Config, Effect, Option } from "effect";

// Email service configuration
export interface EmailConfig {
  provider: "resend" | "sendgrid" | "smtp";
  apiKey?: string;
  from: string;
  replyTo?: string;
  // SMTP specific
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
}

// Create config from environment variables
export const EmailConfigLive = Effect.gen(function* () {
  const provider = yield* Config.string("EMAIL_PROVIDER").pipe(
    Config.withDefault("resend")
  );
  const apiKey = yield* Config.string("EMAIL_API_KEY").pipe(Config.option);
  const from = yield* Config.string("EMAIL_FROM").pipe(
    Config.withDefault("noreply@deskohub.cz")
  );
  const replyTo = yield* Config.string("EMAIL_REPLY_TO").pipe(Config.option);
  const smtpHost = yield* Config.string("SMTP_HOST").pipe(Config.option);
  const smtpPort = yield* Config.number("SMTP_PORT").pipe(Config.option);
  const smtpUser = yield* Config.string("SMTP_USER").pipe(Config.option);
  const smtpPassword = yield* Config.string("SMTP_PASSWORD").pipe(
    Config.option
  );
  const smtpSecure = yield* Config.boolean("SMTP_SECURE").pipe(Config.option);

  return {
    provider: provider as EmailConfig["provider"],
    apiKey: Option.getOrUndefined(apiKey),
    from,
    replyTo: Option.getOrUndefined(replyTo),
    smtpHost: Option.getOrUndefined(smtpHost),
    smtpPort: Option.getOrUndefined(smtpPort),
    smtpUser: Option.getOrUndefined(smtpUser),
    smtpPassword: Option.getOrUndefined(smtpPassword),
    smtpSecure: Option.getOrUndefined(smtpSecure),
  };
});

// Helper to load config
export const getEmailConfig = EmailConfigLive;
