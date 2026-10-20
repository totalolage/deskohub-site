import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  type PostgresAdvisoryLockKey,
  WorkspaceDatabaseAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { customerAccountLinks, customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import {
  insertReferralSignupIntent,
  type ReferralSignupIntent,
} from "@/features/referrals/signup-intent.repository";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import type { CustomerAccountId } from "../customer-account";
import {
  ensureCustomerAccount,
  recordCustomerAccountLink,
} from "./customer-account.repository";
import { linkedDotyposCustomerId } from "./customer-account-dotypos-link";

/**
 * `created` is true only for the claim that inserted the link; a claim that
 * found this account already linked to the customer reports false.
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
        const [link] = yield* db
          .select({ customerId: linkedDotyposCustomerId })
          .from(authUser)
          .leftJoin(customerAccounts, eq(customerAccounts.id, authUser.id))
          .leftJoin(
            customerAccountLinks,
            eq(customerAccountLinks.customerAccountId, authUser.id)
          )
          .where(eq(authUser.id, accountId))
          .limit(1);
        return link?.customerId ?? null;
      });

      const performClaim = Effect.fn("CustomerAccountLinkRepository.claim")(
        function* (
          accountId: CustomerAccountId,
          customerId: DotyposCustomerId,
          signupReferral: ReferralSignupIntent | undefined
        ) {
          const settled = yield* db.transaction(
            Effect.fn(function* (tx) {
              // The contract release (#682) links accounts through the column
              // alone, so the column decides before the link row does. The
              // row lock orders this claim after any claim of the account
              // that release is committing.
              yield* ensureCustomerAccount(tx, accountId);
              const [account] = yield* tx
                .select({ customerId: customerAccounts.dotyposCustomerId })
                .from(customerAccounts)
                .where(eq(customerAccounts.id, accountId))
                .for("update");
              if (account?.customerId) {
                return {
                  kind: "linked",
                  customerId: account.customerId,
                  created: false,
                } as const;
              }
              const [holder] = yield* tx
                .select({ id: customerAccounts.id })
                .from(customerAccounts)
                .where(
                  and(
                    eq(customerAccounts.dotyposCustomerId, customerId),
                    ne(customerAccounts.id, accountId),
                    isNull(customerAccounts.deletedAt)
                  )
                )
                .limit(1);
              if (holder) return { kind: "claimed" } as const;

              const [link] = yield* tx
                .insert(customerAccountLinks)
                .values({
                  customerAccountId: accountId,
                  dotyposCustomerId: customerId,
                })
                .onConflictDoNothing()
                .returning({
                  customerId: customerAccountLinks.dotyposCustomerId,
                });
              if (!link) return link;
              yield* recordCustomerAccountLink(tx, accountId, link.customerId);
              if (signupReferral) {
                yield* insertReferralSignupIntent(
                  tx,
                  accountId,
                  signupReferral
                );
              }
              yield* recordAccountCreated(tx, accountId, link.customerId);
              return {
                kind: "linked",
                customerId: link.customerId,
                created: true,
              } as const;
            })
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

/**
 * The first link gives the account a mailable Dotypos customer, so it is
 * recorded as created at the durable account's creation instant. The link's
 * transaction has already recorded the link on the durable account.
 */
const recordAccountCreated = Effect.fn(function* (
  tx: WorkspaceDatabaseClient,
  accountId: CustomerAccountId,
  customerId: DotyposCustomerId
) {
  const [account] = yield* tx
    .select({ createdAt: customerAccounts.createdAt })
    .from(customerAccounts)
    .where(eq(customerAccounts.id, accountId))
    .limit(1);
  if (!account) {
    return yield* Effect.die("Durable customer account is missing.");
  }
  yield* recordCustomerEvent(tx, {
    kind: "account-created",
    occurredAt: account.createdAt,
    dotyposCustomerId: customerId,
    customerAccountId: accountId,
  });
});
