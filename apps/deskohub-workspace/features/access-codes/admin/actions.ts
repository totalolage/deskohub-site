"use server";

import { AdministrationStandaloneAccessCodeCreateInput } from "@deskohub/workspace-admin-api";
import { Effect, Result, Schema } from "effect";
import { StandaloneAccessCodeAdministration } from "@/features/access-codes";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import {
  type CreateStandaloneAccessCodeResult,
  createStandaloneAccessCodeInputSchema,
} from "./create-access-code";

const createStandaloneAccessCodeAction = defineWorkspaceAction(
  {
    operation: "access-codes.create-standalone",
    schema: createStandaloneAccessCodeInputSchema,
    logInput: false,
  },
  (input) =>
    Effect.gen(function* () {
      const actor = yield* requireDiscountAdminAuthorization().pipe(
        Effect.mapError(
          (cause) =>
            new PublicSafeActionError({
              message: "Administrator authentication is required.",
              cause,
            })
        )
      );
      const request = yield* Schema.decodeEffect(
        AdministrationStandaloneAccessCodeCreateInput
      )({
        name: input.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      }).pipe(
        Effect.mapError(
          () =>
            new PublicSafeActionError({
              message:
                "The access window must be 1 to 672 whole hours long, in site-local time.",
            })
        )
      );
      const administration = yield* StandaloneAccessCodeAdministration;
      const outcome = yield* administration
        .create({
          attemptId: input.attemptId,
          actor,
          source: "admin-ui",
          request,
        })
        .pipe(Effect.result);
      return Result.match(outcome, {
        onSuccess: (created): CreateStandaloneAccessCodeResult => created,
        onFailure: (error): CreateStandaloneAccessCodeResult => ({
          outcome: "failed",
          kind: error.outcome,
        }),
      });
    }).pipe(
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

export const createStandaloneAccessCode: typeof createStandaloneAccessCodeAction =
  async (...args: Parameters<typeof createStandaloneAccessCodeAction>) => {
    "use server";
    return await createStandaloneAccessCodeAction(...args);
  };
