import { and, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccounts } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";

interface IReviewAccounts {
  /**
   * Whether the account is an app-directory review account, whose bookings
   * run in the review sandbox. The marker never goes away, so an account
   * stays sandboxed after its email leaves the reviewer allowlist.
   */
  readonly isReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /**
   * Creates the durable account of a new review login, marked as a review
   * account, before Better Auth inserts the login under the same id. One
   * insert, so the account never exists without its marker.
   */
  readonly register: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

/** The app-directory review accounts among the durable customer accounts. */
export class ReviewAccounts extends Context.Service<
  ReviewAccounts,
  IReviewAccounts
>()("@deskohub-workspace/review-accounts/ReviewAccounts") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const isReviewAccount = Effect.fn("ReviewAccounts.isReviewAccount")(
        function* (accountId: CustomerAccountId) {
          const rows = yield* db
            .select({ id: customerAccounts.id })
            .from(customerAccounts)
            .where(
              and(
                eq(customerAccounts.id, accountId),
                eq(customerAccounts.review, true)
              )
            )
            .limit(1);
          return rows.length > 0;
        }
      );

      const register = Effect.fn("ReviewAccounts.register")(
        (accountId: CustomerAccountId) =>
          db
            .insert(customerAccounts)
            .values({ id: accountId, review: true })
            .pipe(Effect.asVoid)
      );

      return { isReviewAccount, register } satisfies IReviewAccounts;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
