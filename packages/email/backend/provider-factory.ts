import { Config, Effect, Layer, Option } from "effect";
import { EmailConfigTag, EmailServiceError } from "./capabilities";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { ResendEmailProviderLive } from "./providers/resend-provider";

export const ConfiguredEmailProviderLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;

    if (config.provider === "resend") {
      yield* Effect.logInfo("Using Resend email provider");
      return ResendEmailProviderLive;
    }

    if (config.provider !== "console") {
      return yield* new EmailServiceError(
        `Unsupported email provider: ${config.provider}`,
        undefined,
        config.provider
      );
    }

    const stage = yield* Config.all({
      nodeEnv: Config.option(Config.string("NODE_ENV")),
      vercelEnv: Config.option(Config.string("VERCEL_ENV")),
    });
    const consoleProviderAllowed =
      !Option.contains(stage.nodeEnv, "production") ||
      Option.contains(stage.vercelEnv, "preview") ||
      config.testMode === true;

    if (!consoleProviderAllowed) {
      if (config.apiKey) {
        yield* Effect.logInfo("Using Resend email provider");
        return ResendEmailProviderLive;
      }

      return yield* new EmailServiceError(
        "Console email provider is disabled in production",
        undefined,
        "console"
      );
    }

    yield* Effect.logInfo("Using Console email provider");
    return ConsoleEmailProviderLive;
  })
);
