"use server";

import { NexiContractIdSchema } from "@deskohub/nexi";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountReservationOwnership } from "@/features/account/backend/customer-account-reservation-ownership";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  type SavedCardError,
  type SavedCardRemovalResult,
  SavedCardService,
} from "@/features/account/backend/saved-card/saved-card.service";
import type { SavedCardContractRepositoryError } from "@/features/account/backend/saved-card/saved-card-contract.repository";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import { areAccountsEnabled } from "@/features/account/server/account-feature-flag.server";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const startSavedCardEnrollmentSchema = Schema.toStandardSchemaV1(
  Schema.Struct({}),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const removeSavedCardSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    contractId: Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(18)
    ),
  }),
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

const accountAccessActionError =
  (locale: Locale) =>
  (cause: CustomerAccountAccessError): PublicSafeActionError => {
    if (cause.reason === "unauthenticated") {
      return new PublicSafeActionError({
        message: m.accountSessionExpired({}, { locale }),
        cause,
      });
    }
    if (
      cause.reason === "link-required" &&
      cause.linkReason === "deletion-requested"
    ) {
      return new PublicSafeActionError({
        message: m.accountDeletionPendingError({}, { locale }),
        cause,
      });
    }
    return new PublicSafeActionError({
      message: m.accountUnavailableDescription({}, { locale }),
      cause,
    });
  };

const savedCardActionError =
  (locale: Locale) =>
  (cause: SavedCardError | SavedCardContractRepositoryError) =>
    new PublicSafeActionError({
      // Fixed, non-PII public copy only; provider details stay internal.
      message: m.accountUnavailableDescription({}, { locale }),
      cause,
    });

const mapSavedCardActionFailure =
  (locale: Locale) =>
  (cause: unknown): PublicSafeActionError => {
    if (cause instanceof CustomerAccountAccessError) {
      return accountAccessActionError(locale)(cause);
    }
    if (cause instanceof PublicSafeActionError) return cause;
    return savedCardActionError(locale)(
      cause as SavedCardError | SavedCardContractRepositoryError
    );
  };

const savedCardsActionLayer = Layer.mergeAll(
  CustomerAuthentication.Default,
  CustomerAccountReservationOwnership.Live,
  SavedCardService.Live
);

const requireAccountsEnabled = (locale: Locale) =>
  Effect.promise(areAccountsEnabled).pipe(
    Effect.filterOrFail(
      (enabled) => enabled,
      () =>
        new PublicSafeActionError({
          message: m.accountUnavailableDescription({}, { locale }),
        })
    ),
    Effect.asVoid
  );

const startSavedCardEnrollmentHandler = Effect.fn(
  "account.saved-card.start-enrollment.handler"
)(function* (locale: Locale) {
  yield* requireAccountsEnabled(locale);
  yield* requireVerifiedSession;
  const account = yield* Effect.flatMap(
    CustomerAccountReservationOwnership,
    (ownership) => ownership.resolve
  );
  return yield* Effect.flatMap(SavedCardService, (savedCards) =>
    savedCards.startEnrollment(account, locale)
  );
});

const removeSavedCardHandler = Effect.fn("account.saved-card.remove.handler")(
  function* (input: { readonly contractId: string }, locale: Locale) {
    yield* requireAccountsEnabled(locale);
    yield* requireVerifiedSession;
    const account = yield* Effect.flatMap(
      CustomerAccountReservationOwnership,
      (ownership) => ownership.resolve
    );
    const contractId = yield* Effect.try({
      try: () =>
        Schema.decodeUnknownSync(NexiContractIdSchema)(input.contractId),
      catch: () =>
        new PublicSafeActionError({
          message: m.accountUnavailableDescription({}, { locale }),
        }),
    });
    return yield* Effect.flatMap(SavedCardService, (savedCards) =>
      savedCards.removeCard(account, contractId)
    ).pipe(
      Effect.catchTag("SavedCardError", (error) =>
        error.code === "unavailable"
          ? Effect.succeed({ status: "retry" } as const)
          : Effect.fail(error)
      )
    );
  }
);

/**
 * Starts a saved-card enrollment: the linked account is re-resolved under the
 * deletion guard, then a zero-amount VERIFY hosted page is created and its
 * security token is stored as a digest only.
 */
const startSavedCardEnrollmentAction = defineWorkspaceAction(
  {
    operation: "account.saved-card.start-enrollment",
    schema: startSavedCardEnrollmentSchema,
    logInput: false,
  },
  (_input, { locale }) =>
    startSavedCardEnrollmentHandler(locale).pipe(
      Effect.mapError(mapSavedCardActionFailure(locale)),
      Effect.provide(savedCardsActionLayer)
    )
);

/**
 * Removes a saved card for the signed-in account. A retryable provider
 * failure surfaces as `{ status: "retry" }`; the card stays active.
 */
const removeSavedCardAction = defineWorkspaceAction(
  {
    operation: "account.saved-card.remove",
    schema: removeSavedCardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    removeSavedCardHandler(input, locale).pipe(
      Effect.mapError(mapSavedCardActionFailure(locale)),
      Effect.provide(savedCardsActionLayer)
    )
);

export const startSavedCardEnrollment: typeof startSavedCardEnrollmentAction =
  async (...args: Parameters<typeof startSavedCardEnrollmentAction>) => {
    "use server";
    return await startSavedCardEnrollmentAction(...args);
  };

export const removeSavedCard: typeof removeSavedCardAction = async (
  ...args: Parameters<typeof removeSavedCardAction>
) => {
  "use server";
  return await removeSavedCardAction(...args);
};

export type { SavedCardRemovalResult };
