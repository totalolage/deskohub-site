import "server-only";

import { checkBotId } from "botid/server";
import { Context, Data, Effect, Layer } from "effect";

export interface VerifyHumanInput {
  readonly verificationFailurePolicy: "allow" | "deny";
}

interface IBotProtectionService {
  readonly verifyHuman: (
    input: VerifyHumanInput
  ) => Effect.Effect<void, BotDetectedError | BotVerificationError>;
}

export class BotProtectionService extends Context.Service<
  BotProtectionService,
  IBotProtectionService
>()("@deskohub-workspace/security/BotProtectionService") {
  static Live = Layer.succeed(this, {
    verifyHuman: (input) => verifyHuman(input),
  });
}

export class BotDetectedError extends Data.TaggedError("BotDetectedError")<{
  readonly message: string;
}> {}

export class BotVerificationError extends Data.TaggedError(
  "BotVerificationError"
)<{
  readonly cause: unknown;
}> {}

const verifyHuman = Effect.fn("BotProtectionService.verifyHuman")(
  (input: VerifyHumanInput) =>
    Effect.tryPromise({
      try: () => checkBotId(),
      catch: (cause) => new BotVerificationError({ cause }),
    }).pipe(
      Effect.catchTag("BotVerificationError", (error) =>
        input.verificationFailurePolicy === "allow"
          ? Effect.logWarning(
              "Workspace BotID verification failed; allowing request",
              {
                cause: error.cause,
                verificationFailurePolicy: input.verificationFailurePolicy,
              }
            ).pipe(Effect.as(null))
          : Effect.fail(error)
      ),
      Effect.flatMap((verification) =>
        verification?.isBot
          ? Effect.fail(
              new BotDetectedError({ message: "Automated request detected" })
            )
          : Effect.void
      )
    )
);
