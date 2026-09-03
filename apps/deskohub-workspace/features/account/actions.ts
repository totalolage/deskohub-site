"use server";

import { Effect, Layer, Result, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { deleteCurrentAccountThroughAuthEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import {
  type CustomerProfileInput,
  updateCustomerProfileStandardSchema,
} from "@/features/account/contracts";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const deleteCustomerAccountConfirmedSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ confirmed: Schema.Literal(true) }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const requireVerifiedSession = Effect.flatMap(
  CustomerAuthentication,
  (authentication) => authentication.currentUser
).pipe(
  Effect.flatMap((user) =>
    user
      ? Effect.succeed(user)
      : Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        )
  )
);

const profileActionErrorMessage = (
  cause: CustomerAccountAccessError,
  locale: Locale
) => {
  if (cause.reason === "unauthenticated") {
    return m.accountSessionExpired({}, { locale });
  }
  if (
    cause.reason === "link-required" &&
    cause.linkReason === "deletion-requested"
  ) {
    return m.accountDeletionPendingError({}, { locale });
  }
  return m.accountProfileError({}, { locale });
};

const profileActionError =
  (locale: Locale) =>
  (cause: CustomerAccountAccessError): PublicSafeActionError =>
    new PublicSafeActionError({
      message: profileActionErrorMessage(cause, locale),
      cause,
    });

/**
 * Saves the Dotypos-owned profile for the verified account: a not-yet-linked
 * account creates and claims its customer profile, an already-linked account
 * updates it. Both paths run under the authoritative session, re-check the
 * deletion marker under the account lock, and never accept an email: the
 * profile input has no email field and the verified login email is read only
 * from the session.
 */
const saveCustomerProfile = (input: CustomerProfileInput, locale: Locale) =>
  Effect.gen(function* () {
    const user = yield* requireVerifiedSession;
    const resolution = yield* CustomerAccountResolver.pipe(
      Effect.flatMap((resolver) => resolver.resolve),
      Effect.result
    );

    if (Result.isSuccess(resolution)) {
      return yield* Effect.flatMap(CustomerProfileService, (profile) =>
        profile.update(resolution.success, input)
      );
    }

    const failure = resolution.failure;
    if (
      failure.reason === "link-required" &&
      failure.linkReason === "not-found"
    ) {
      return yield* Effect.flatMap(CustomerProfileService, (profile) =>
        profile.create(user.accountId, user.email, input)
      );
    }
    return yield* failure;
  }).pipe(
    Effect.mapError(profileActionError(locale)),
    Effect.provide(
      Layer.mergeAll(
        CustomerAuthentication.Default,
        CustomerAccountResolver.Live,
        CustomerProfileService.Live
      )
    )
  );

const completeCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.complete-profile",
    schema: updateCustomerProfileStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    Effect.as(
      Effect.andThen(
        saveCustomerProfile(input, locale),
        Effect.sync(() => revalidatePath(`/${locale}/account`))
      ),
      { status: "completed" as const }
    )
);

const updateCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.update-profile",
    schema: updateCustomerProfileStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    Effect.as(
      Effect.andThen(
        saveCustomerProfile(input, locale),
        Effect.sync(() => revalidatePath(`/${locale}/account`))
      ),
      { status: "updated" as const }
    )
);

export type CustomerAccountDeletionResult =
  | { readonly status: "deleted" }
  | { readonly status: "reauthentication-required" }
  | { readonly status: "failed" };

const revalidateDeletionAuthority = (locale: Locale) =>
  Effect.sync(() => {
    revalidatePath(`/${locale}/account`);
    revalidatePath(`/${locale}/account/deleted`);
  });

/**
 * Runs account deletion exclusively through Better Auth's public delete-user
 * endpoint, so its session-freshness gate and the provider-first beforeDelete
 * hook stay the single identity-deletion path. A stale or missing session
 * asks for reauthentication; a retryable provider failure keeps the durable
 * deletion marker and the account untouched.
 */
const deleteCustomerAccountAction = defineWorkspaceAction(
  {
    operation: "account.delete",
    schema: deleteCustomerAccountConfirmedSchema,
    logInput: false,
  },
  (_input, { locale }) =>
    Effect.gen(function* () {
      const session = yield* requireVerifiedSession.pipe(
        Effect.provide(CustomerAuthentication.Default),
        Effect.result
      );
      if (Result.isFailure(session)) {
        return yield* revalidateDeletionAuthority(locale).pipe(
          Effect.as({ status: "reauthentication-required" } as const)
        );
      }

      const deletion = yield* Effect.promise(() =>
        deleteCurrentAccountThroughAuthEndpoint()
      ).pipe(Effect.result);

      yield* revalidateDeletionAuthority(locale);

      if (Result.isSuccess(deletion)) {
        const result = deletion.success;
        if (result.status === "failed") {
          yield* Effect.log("Customer account deletion did not complete").pipe(
            Effect.annotateLogs({ code: result.code })
          );
          return { status: "failed" } as const;
        }
        return result;
      }

      yield* Effect.log("Customer account deletion did not complete").pipe(
        Effect.annotateLogs({ code: "account.delete.unexpected" })
      );
      return { status: "failed" } as const;
    })
);

export const completeCustomerProfile: typeof completeCustomerProfileAction =
  async (...args: Parameters<typeof completeCustomerProfileAction>) => {
    "use server";
    return await completeCustomerProfileAction(...args);
  };

export const updateCustomerProfile: typeof updateCustomerProfileAction = async (
  ...args: Parameters<typeof updateCustomerProfileAction>
) => {
  "use server";
  return await updateCustomerProfileAction(...args);
};

export const deleteCustomerAccount: typeof deleteCustomerAccountAction = async (
  ...args: Parameters<typeof deleteCustomerAccountAction>
) => {
  "use server";
  return await deleteCustomerAccountAction(...args);
};
