import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type PostgresAdvisoryLockKey,
  WorkspaceDatabaseAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { findViolatedConstraint } from "@/db/sql-constraint";
import {
  insertReferralSignupIntent,
  type ReferralSignupIntent,
} from "@/features/referrals/signup-intent.repository";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import type { CustomerAccountId } from "../customer-account";

/**
 * `created` is true only for the claim that recorded the link; a claim that
 * found this account already linked reports false with the account's own
 * customer. `claimed` means another live account holds the customer.
 */
export type CustomerAccountLinkClaim =
  | {
      readonly kind: "linked";
      readonly customerId: DotyposCustomerId;
      readonly created: boolean;
    }
  | { readonly kind: "claimed" };

/**
 * Authoritative account activity facts read from the auth schema. A missing
 * auth row means the identity no longer exists, so it is never conflated with
 * an active account that simply has no deletion marker.
 */
export type CustomerAccountActivityState =
  | { readonly kind: "missing" }
  | { readonly kind: "active"; readonly deletionRequestedAt: Date | null };

export type CustomerAccountLinkError =
  | EffectDrizzleQueryError
  | SqlError.SqlError;

export const customerAccountLockKey = (
  accountId: CustomerAccountId
): PostgresAdvisoryLockKey => ["customer-account", accountId];

interface ICustomerAccountLinkRepository {
  readonly find: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, CustomerAccountLinkError>;
  /**
   * A signup referral is written in the link's transaction and only when this
   * claim creates the link, so it belongs to exactly one completion.
   */
  readonly claim: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId,
    signupReferral?: ReferralSignupIntent
  ) => Effect.Effect<CustomerAccountLinkClaim, CustomerAccountLinkError>;
  readonly findActivityState: (
    accountId: CustomerAccountId
  ) => Effect.Effect<CustomerAccountActivityState, CustomerAccountLinkError>;
  readonly markDeletionRequested: (
    accountId: CustomerAccountId,
    requestedAt: Date
  ) => Effect.Effect<void, CustomerAccountLinkError>;
  readonly withAccountLock: <A, E, R>(
    accountId: CustomerAccountId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError.SqlError, R>;
}

export class CustomerAccountLinkRepository extends Context.Service<
  CustomerAccountLinkRepository,
  ICustomerAccountLinkRepository
>()("@deskohub-workspace/account/CustomerAccountLinkRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;

      const find = Effect.fn("CustomerAccountLinkRepository.find")(function* (
        accountId: CustomerAccountId
      ) {
        const [account] = yield* db
          .select({ customerId: customerAccounts.dotyposCustomerId })
          .from(customerAccounts)
          .where(eq(customerAccounts.id, accountId))
          .limit(1);
        return account?.customerId ?? null;
      });

      const performClaim = Effect.fn("CustomerAccountLinkRepository.claim")(
        function* (
          accountId: CustomerAccountId,
          customerId: DotyposCustomerId,
          signupReferral: ReferralSignupIntent | undefined
        ) {
          const settled = yield* db
            .transaction(
              Effect.fn(function* (tx) {
                // Only a live account without a customer takes one; the
                // unique customer index rejects a customer another account
                // holds, and a concurrent claim of the same account waits on
                // the row and then finds it linked.
                const [link] = yield* tx
                  .update(customerAccounts)
                  .set({ dotyposCustomerId: customerId })
                  .where(
                    and(
                      eq(customerAccounts.id, accountId),
                      isNull(customerAccounts.dotyposCustomerId),
                      isNull(customerAccounts.deletedAt)
                    )
                  )
                  .returning({
                    createdAt: customerAccounts.createdAt,
                    legacy: customerAccounts.legacy,
                  });
                if (!link) return undefined;
                if (signupReferral) {
                  yield* insertReferralSignupIntent(
                    tx,
                    accountId,
                    signupReferral
                  );
                }
                // The first link gives the account a mailable Dotypos
                // customer, so the account counts as created at its creation
                // instant. An existing customer's account was never created
                // here (D37), so its first link records nothing.
                if (!link.legacy) {
                  yield* recordCustomerEvent(tx, {
                    kind: "account-created",
                    occurredAt: link.createdAt,
                    dotyposCustomerId: customerId,
                    customerAccountId: accountId,
                  });
                }
                return {
                  kind: "linked",
                  customerId,
                  created: true,
                } as const;
              })
            )
            .pipe(
              Effect.catchIf(isCustomerHeldElsewhere, () =>
                Effect.succeed(undefined)
              )
            );
          if (settled) return settled;

          const racedLink = yield* find(accountId);
          return racedLink
            ? ({
                kind: "linked",
                customerId: racedLink,
                created: false,
              } as const)
            : ({ kind: "claimed" } as const);
        }
      );

      const claim: ICustomerAccountLinkRepository["claim"] = (
        accountId,
        customerId,
        signupReferral
      ) =>
        performClaim(accountId, customerId, signupReferral).pipe(
          Effect.tap(() => Effect.logDebug("Account link claim completed"))
        );

      const findActivityState = Effect.fn(
        "CustomerAccountLinkRepository.findActivityState"
      )(function* (accountId: CustomerAccountId) {
        const [row] = yield* db
          .select({ deletionRequestedAt: authUser.deletionRequestedAt })
          .from(authUser)
          .where(eq(authUser.id, accountId))
          .limit(1);
        if (!row) return { kind: "missing" } as const;
        return {
          kind: "active",
          deletionRequestedAt: row.deletionRequestedAt ?? null,
        } as const;
      });

      const markDeletionRequested = Effect.fn(
        "CustomerAccountLinkRepository.markDeletionRequested"
      )((accountId: CustomerAccountId, requestedAt: Date) =>
        db
          .update(authUser)
          .set({ deletionRequestedAt: requestedAt })
          .where(eq(authUser.id, accountId))
          .pipe(Effect.asVoid)
      );

      const withAccountLock: ICustomerAccountLinkRepository["withAccountLock"] =
        (accountId, effect) =>
          advisoryLock.withLock(customerAccountLockKey(accountId), effect);

      return {
        claim,
        find,
        findActivityState,
        markDeletionRequested,
        withAccountLock,
      } satisfies ICustomerAccountLinkRepository;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDatabaseAdvisoryLock.Default
      )
    )
  );
}

/** The claimed customer is already another account's. */
const isCustomerHeldElsewhere = (error: CustomerAccountLinkError) =>
  findViolatedConstraint(error).pipe(
    Option.exists(
      (constraint) =>
        constraint === "customer_accounts_dotypos_customer_unique_idx"
    )
  );
