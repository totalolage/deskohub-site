"use server";

import { Effect, Result } from "effect";
import { StandaloneAccessCodeAdministration } from "@/features/access-codes";
import { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import {
  type CreateStandaloneAccessCodeInput,
  createStandaloneAccessCodeInputSchema,
  encodeCreateStandaloneAccessCodeResult,
  toStandaloneAccessCodeCreationFailure,
} from "./create-access-code";

const createStandaloneAccessCodeWorkflow = Effect.fn(
  "access-codes.createStandaloneAccessCode"
)(
  function* (input: CreateStandaloneAccessCodeInput) {
    const actor = yield* requireAdministratorAuthorization().pipe(
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "Administrator authentication is required.",
            cause,
          })
      )
    );
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
  },
  (effect) =>
    effect.pipe(
      Effect.provide(StandaloneAccessCodeAdministration.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message:
              cause instanceof PublicSafeActionError
                ? cause.message
                : "The access code could not be created. Try again.",
            cause,
          })
      )
    )
);

const createStandaloneAccessCodeAction = defineWorkspaceAction(
  {
    operation: "access-codes.create-standalone",
    schema: createStandaloneAccessCodeInputSchema,
    logInput: false,
  },
  createStandaloneAccessCodeWorkflow
);

export const createStandaloneAccessCode: typeof createStandaloneAccessCodeAction =
  async (...args: Parameters<typeof createStandaloneAccessCodeAction>) => {
    "use server";
    return await createStandaloneAccessCodeAction(...args);
  };
