import { Config, Context, Effect, Layer } from "effect";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { ResendEmailProviderLive } from "./providers/resend-provider";
import { EmailProviderTag, type EmailProvider } from "./service";

export type EmailProviderType = "console" | "resend";

/**
 * Type for Email Provider Layer
 */
type EmailProviderLayer = Layer.Layer<EmailProvider, never, never>;

/**
 * Email Provider Factory Tag for dependency injection
 */
export class EmailProviderFactoryTag extends Context.Tag(
  "EmailProviderFactory"
)<EmailProviderFactoryTag, EmailProviderLayer>() {}

/**
 * Factory for creating email provider layers based on configuration
 */
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

  // Auto-detect based on environment variables
  // We'll determine which provider to use at runtime
  return Layer.unwrapScoped(
    Effect.gen(function* () {
      const resendApiKey = yield* Config.string("RESEND_API_KEY").pipe(
        Config.withDefault("")
      );

      const nodeEnv = yield* Config.string("NODE_ENV").pipe(
        Config.withDefault("development")
      );

      // Use Resend if API key is available and we're not in test mode
      if (resendApiKey && nodeEnv !== "test") {
        yield* Effect.logInfo("Using Resend email provider");
        return ResendEmailProviderLive;
      }

      // Default to console provider
      yield* Effect.logInfo("Using Console email provider");
      return ConsoleEmailProviderLive;
    })
  );
};

/**
 * Get the email provider layer based on environment configuration
 * This is the recommended way to get the email provider
 */
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

    // Determine which provider to use
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
