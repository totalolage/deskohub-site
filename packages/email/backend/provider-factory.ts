import { Effect, Layer } from "effect";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { ResendEmailProviderLive } from "./providers/resend-provider";
import { EmailConfigTag, EmailServiceError } from "./service";

export const EmailProviderLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;

    if (config.provider === "resend") {
      yield* Effect.logInfo("Using Resend email provider");
      return ResendEmailProviderLive;
    }

    if (config.provider !== "console") {
      return yield* Effect.fail(
        new EmailServiceError(
          `Unsupported email provider: ${config.provider}`,
          undefined,
          config.provider
        )
      );
    }

    if (process.env.NODE_ENV === "production" && !config.testMode) {
      if (config.apiKey) {
        yield* Effect.logInfo("Using Resend email provider");
        return ResendEmailProviderLive;
      }

      return yield* Effect.fail(
        new EmailServiceError(
          "Console email provider is disabled in production",
          undefined,
          "console"
        )
      );
    }

    yield* Effect.logInfo("Using Console email provider");
    return ConsoleEmailProviderLive;
  })
);
