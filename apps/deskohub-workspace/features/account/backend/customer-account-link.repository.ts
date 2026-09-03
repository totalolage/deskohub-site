import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type PostgresAdvisoryLockKey,
  WorkspaceDatabaseAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { customerAccountLinks } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { CustomerAccountId } from "../customer-account";

export type CustomerAccountLinkClaim =
  | { readonly kind: "linked"; readonly customerId: DotyposCustomerId }
  | { readonly kind: "claimed" };

export type CustomerAccountLinkError = EffectDrizzleQueryError | SqlError;

const accountLockKey = (
  accountId: CustomerAccountId
): PostgresAdvisoryLockKey => ["customer-account", accountId];

interface ICustomerAccountLinkRepository {
  readonly find: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, CustomerAccountLinkError>;
  readonly claim: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerAccountLinkClaim, CustomerAccountLinkError>;
  readonly findDeletionRequestedAt: (
    accountId: CustomerAccountId
  ) => Effect.Effect<Date | null, CustomerAccountLinkError>;
  readonly markDeletionRequested: (
    accountId: CustomerAccountId,
    requestedAt: Date
  ) => Effect.Effect<void, CustomerAccountLinkError>;
  readonly withAccountLock: <A, E, R>(
    accountId: CustomerAccountId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError, R>;
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
          .select({ customerId: customerAccountLinks.dotyposCustomerId })
          .from(customerAccountLinks)
          .where(eq(customerAccountLinks.customerAccountId, accountId))
          .limit(1);
        return link?.customerId ?? null;
      });

      const claim = Effect.fn("CustomerAccountLinkRepository.claim")(function* (
        accountId: CustomerAccountId,
        customerId: DotyposCustomerId
      ) {
        const [inserted] = yield* db
          .insert(customerAccountLinks)
          .values({
            customerAccountId: accountId,
            dotyposCustomerId: customerId,
          })
          .onConflictDoNothing()
          .returning({ customerId: customerAccountLinks.dotyposCustomerId });
        if (inserted) {
          return {
            kind: "linked",
            customerId: inserted.customerId,
          } as const;
        }

        const racedLink = yield* find(accountId);
        return racedLink
          ? ({ kind: "linked", customerId: racedLink } as const)
          : ({ kind: "claimed" } as const);
      });

      const findDeletionRequestedAt = Effect.fn(
        "CustomerAccountLinkRepository.findDeletionRequestedAt"
      )(function* (accountId: CustomerAccountId) {
        const [row] = yield* db
          .select({ deletionRequestedAt: authUser.deletionRequestedAt })
          .from(authUser)
          .where(eq(authUser.id, accountId))
          .limit(1);
        return row?.deletionRequestedAt ?? null;
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
          advisoryLock.withLock(accountLockKey(accountId), effect);

      return {
        claim,
        find,
        findDeletionRequestedAt,
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
