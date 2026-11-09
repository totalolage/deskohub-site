import "server-only";

import { checkBotId } from "botid/server";
import { Context, Data, Effect, Layer, Match } from "effect";
import { isWorkspaceBotIdEnforcedAtRuntime } from "./bot-protection.runtime";
import {
  type BotProtectionCallSite,
  recordBotProtectionRejection,
} from "./bot-protection-rejection";

/**
 * Which Vercel-verified bots a call site lets through, by `verifiedBotName`.
 * Every unverified bot is rejected either way.
 */
export type VerifiedBotPolicy = { readonly allow: readonly string[] } | "deny";

export interface VerifyHumanInput {
  readonly verificationFailurePolicy: "allow" | "deny";
  readonly verifiedBots: VerifiedBotPolicy;
  /** Where the request was screened, so rejections count per call site. */
  readonly callSite: BotProtectionCallSite;
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
  static Default = Layer.succeed(this, {
    verifyHuman: (input) => verifyHuman(input),
  });
}

/** Why BotID rejected a request. */
export type BotRejectionReason =
  /** BotID classified the request as a bot it could not verify. */
  | "unverified_bot"
  /** A verified bot the call site's `verifiedBots` policy does not allow. */
  | "verified_bot_not_allowed";

export class BotDetectedError extends Data.TaggedError("BotDetectedError")<{
  readonly message: string;
  readonly reason: BotRejectionReason;
  /** BotID's category for a verified bot; absent for unverified bots. */
  readonly verifiedBotCategory?: string;
}> {}

export class BotVerificationError extends Data.TaggedError(
  "BotVerificationError"
)<{
  readonly cause: unknown;
}> {}

type BotIdVerification = Awaited<ReturnType<typeof checkBotId>>;

const allowsVerifiedBot = (
  policy: VerifiedBotPolicy,
  verifiedBotName: string | undefined
) =>
  policy !== "deny" &&
  verifiedBotName !== undefined &&
  policy.allow.includes(verifiedBotName);

/**
 * Passes humans and the verified bots the policy allows, logging the allowed
 * bot's name so production logs show agents getting through.
 */
const screenVerification = Effect.fn("BotProtectionService.screenVerification")(
  function* ({
    verification,
    verifiedBots,
  }: {
    readonly verification: BotIdVerification | null;
    readonly verifiedBots: VerifiedBotPolicy;
  }) {
    if (!verification?.isBot) return;
    const { verifiedBotName, verifiedBotCategory } =
      "verifiedBotName" in verification
        ? verification
        : { verifiedBotName: undefined, verifiedBotCategory: undefined };

    if (
      verification.isVerifiedBot &&
      allowsVerifiedBot(verifiedBots, verifiedBotName)
    ) {
      yield* Effect.logInfo("Workspace BotID allowed a verified bot", {
        verifiedBotName,
        verifiedBotCategory,
      });
      return;
    }

    const message = "Automated request detected";
    return yield* verification.isVerifiedBot
      ? new BotDetectedError({
          message,
          reason: "verified_bot_not_allowed",
          verifiedBotCategory,
        })
      : new BotDetectedError({ message, reason: "unverified_bot" });
  }
);

const verifyHuman = Effect.fn("BotProtectionService.verifyHuman")(
  (input: VerifyHumanInput) =>
    Effect.tryPromise({
      try: () => checkBotId(),
      catch: (cause) => new BotVerificationError({ cause }),
    }).pipe(
      Effect.catchTag("BotVerificationError", (error) =>
        Match.value(input.verificationFailurePolicy).pipe(
          Match.when("allow", () =>
            Effect.logWarning(
              "Workspace BotID verification failed; allowing request",
              {
                cause: error.cause,
                verificationFailurePolicy: input.verificationFailurePolicy,
              }
            ).pipe(Effect.as(null))
          ),
          Match.when("deny", () => Effect.fail(error)),
          Match.exhaustive
        )
      ),
      Effect.flatMap((verification) =>
        screenVerification({
          verification,
          verifiedBots: input.verifiedBots,
        }).pipe(
          Effect.tapError(() =>
            verification === null
              ? Effect.void
              : recordBotProtectionRejection(input.callSite, verification)
          )
        )
      ),
      Effect.when(Effect.sync(isWorkspaceBotIdEnforcedAtRuntime)),
      Effect.asVoid
    )
);
