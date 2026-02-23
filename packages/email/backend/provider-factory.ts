import { Config, Context, Effect, Layer } from "effect";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { ResendEmailProviderLive } from "./providers/resend-provider";
import type { EmailProvider } from "./service";

export type EmailProviderType = "console" | "resend";

type EmailProviderLayer = Layer.Layer<EmailProvider, never, never>;

export class EmailProviderFactoryTag extends Context.Tag(
  "EmailProviderFactory"
)<EmailProviderFactoryTag, EmailProviderLayer>() {}

export const createEmailProviderLayer = (providerType?: EmailProviderType) => {
  if (providerType) {
    switch (providerType) {
      case "console":
        return ConsoleEmailProviderLive;
      case "resend":
        return ResendEmailProviderLive;
      default:
        return ConsoleEmailProviderLive;
    }
  }

  return Layer.unwrapScoped(
    Effect.gen(function* () {
      const resendApiKey = yield* Config.string("RESEND_API_KEY").pipe(
        Config.withDefault("")
      );

      const nodeEnv = yield* Config.string("NODE_ENV").pipe(
        Config.withDefault("development")
      );

      if (resendApiKey && nodeEnv !== "test") {
        yield* Effect.logInfo("Using Resend email provider");
        return ResendEmailProviderLive;
      }

      yield* Effect.logInfo("Using Console email provider");
      return ConsoleEmailProviderLive;
    })
  );
};

export const EmailProviderLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const resendApiKey = yield* Config.string("RESEND_API_KEY").pipe(
      Config.withDefault(""),
      Config.withDescription("Resend API key for email sending")
    );

    const emailProvider = yield* Config.string("EMAIL_PROVIDER").pipe(
      Config.withDefault("auto"),
      Config.withDescription("Email provider to use: console, resend, or auto")
    );

    const nodeEnv = yield* Config.string("NODE_ENV").pipe(
      Config.withDefault("development")
    );

    if (
      emailProvider === "resend" ||
      (emailProvider === "auto" && resendApiKey && nodeEnv !== "test")
    ) {
      yield* Effect.logInfo("Initializing Resend email provider");
      return ResendEmailProviderLive;
    }

    yield* Effect.logInfo("Initializing Console email provider");
    return ConsoleEmailProviderLive;
  })
);
