"use server";

import { Effect, Predicate, Result } from "effect";
import { StandaloneAccessCodeAdministration } from "@/features/access-codes";
import { m } from "@/features/administration/i18n";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import {
  type CreateStandaloneAccessCodeInput,
  createStandaloneAccessCodeInputSchema,
  encodeCreateStandaloneAccessCodeResult,
  toStandaloneAccessCodeCreationFailure,
} from "./create-access-code";

const createStandaloneAccessCodeWorkflow = Effect.fn(
  "access-codes.createStandaloneAccessCode"
)(function* (input: CreateStandaloneAccessCodeInput) {
  const actor = yield* CurrentAdministrator;
  const administration = yield* StandaloneAccessCodeAdministration;
  const attempted = yield* administration
    .create({
      attemptId: input.attemptId,
      actor,
      source: "admin-ui",
      request: {
        name: input.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
      ...(input.providerCredentialRemovedAttemptId !== undefined && {
        providerCredentialRemovedAttemptId:
          input.providerCredentialRemovedAttemptId,
      }),
    })
    .pipe(Effect.result);
  if (Result.isFailure(attempted)) {
    const failure = toStandaloneAccessCodeCreationFailure(attempted.failure);
    if (failure === null) {
      return yield* Effect.die(
        new Error(
          `The ${attempted.failure.outcome} outcome is missing its cleanup target.`
        )
      );
    }
    return encodeCreateStandaloneAccessCodeResult(Result.fail(failure));
  }
  return encodeCreateStandaloneAccessCodeResult(
    Result.succeed(attempted.success)
  );
});

const createStandaloneAccessCodeAction = defineAdministrationAction(
  {
    operation: "access-codes.create-standalone",
    schema: createStandaloneAccessCodeInputSchema,
    logInput: false,
    failureCopy: {
      timeout: m.accessCodesActionTimedOut,
      unexpected: m.accessCodesActionFailedUnexpectedly,
    },
    fallback: m.accessCodesCreateFailed,
    capabilities: StandaloneAccessCodeAdministration.Live,
    publicFailure: (cause, locale) =>
      Predicate.isTagged(cause, "AdministratorUnauthorizedError")
        ? m.accessCodesAuthenticationRequired({}, { locale })
        : undefined,
  },
  createStandaloneAccessCodeWorkflow
);

export const createStandaloneAccessCode: typeof createStandaloneAccessCodeAction =
  async (...args: Parameters<typeof createStandaloneAccessCodeAction>) => {
    "use server";
    return await createStandaloneAccessCodeAction(...args);
  };
