import { Config, Effect, Layer } from "effect";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { ResendEmailProviderLive } from "./providers/resend-provider";

export type EmailProviderType = "console" | "resend";

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
  return Layer.effect(
    "EmailProviderFactory",
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
  ).pipe(
    Layer.flatMap((_factoryLayer) =>
      // Extract the provider layer from the factory
      Layer.effect(
        "EmailProvider",
        Effect.gen(function* () {
          const providerLayer = yield* Effect.service(
            "EmailProviderFactory" as any
          );
          return providerLayer;
        })
      )
    )
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
