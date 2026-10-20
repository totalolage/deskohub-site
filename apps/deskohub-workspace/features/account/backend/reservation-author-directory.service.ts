import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { Locale } from "@/features/i18n";
import type { CustomerAccountId } from "../customer-account";

/** The reservation authors could not be read. */
export class ReservationAuthorReadError extends Data.TaggedError(
  "ReservationAuthorReadError"
)<{
  readonly code: "reservation-author.read";
}> {}

/**
 * The customer account that made a reservation, as its readers see it. A
 * deleted-account tombstone, or an account whose deletion is under way,
 * exposes nothing but its id. An active author carries its own linked
 * Dotypos customer, when it has one, its login email, and its saved
 * language preference.
 */
export type ReservationAuthor =
  | { readonly kind: "deleted"; readonly accountId: CustomerAccountId }
  | {
      readonly kind: "active";
      readonly accountId: CustomerAccountId;
      readonly dotyposCustomerId: DotyposCustomerId | null;
      readonly email: string;
      readonly locale: Locale | null;
    };

/**
 * Whether the author is the reservation customer's own account. An authorless
 * reservation counts as the customer's own, so it carries no author label. A
 * deleted author's customer link is gone, so it never counts as the
 * customer's own.
 */
export const isCustomerOwnAuthor = (
  author: ReservationAuthor | null,
  customerId: DotyposCustomerId
) =>
  author === null ||
  (author.kind === "active" && author.dotyposCustomerId === customerId);

interface IReservationAuthorDirectory {
  /**
   * Describes each named author. Every id names a durable customer account,
   * so the result has an entry for each one.
   */
  readonly describe: (
    accountIds: readonly CustomerAccountId[]
  ) => Effect.Effect<
    ReadonlyMap<CustomerAccountId, ReservationAuthor>,
    ReservationAuthorReadError
  >;
}

/**
 * Reads reservation authors through the durable customer account, so
 * reservation surfaces never touch the sign-in identity themselves.
 */
export class ReservationAuthorDirectory extends Context.Service<
  ReservationAuthorDirectory,
  IReservationAuthorDirectory
>()("@deskohub-workspace/account/ReservationAuthorDirectory") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const describe = Effect.fn("ReservationAuthorDirectory.describe")(
        function* (accountIds: readonly CustomerAccountId[]) {
          const authors = new Map<CustomerAccountId, ReservationAuthor>();
          const ids = [...new Set(accountIds)];
          if (ids.length === 0) return authors;

          const rows = yield* db
            .select({
              accountId: customerAccounts.id,
              deletedAt: customerAccounts.deletedAt,
              email: authUser.email,
              locale: authUser.locale,
              deletionRequestedAt: authUser.deletionRequestedAt,
              dotyposCustomerId: customerAccounts.dotyposCustomerId,
            })
            .from(customerAccounts)
            .leftJoin(authUser, eq(authUser.id, customerAccounts.id))
            .where(inArray(customerAccounts.id, ids))
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAuthorReadError({
                    code: "reservation-author.read",
                  })
              )
            );

          for (const row of rows) {
            authors.set(
              row.accountId,
              row.deletedAt || row.deletionRequestedAt || row.email === null
                ? { kind: "deleted", accountId: row.accountId }
                : {
                    kind: "active",
                    accountId: row.accountId,
                    dotyposCustomerId: row.dotyposCustomerId,
                    email: row.email,
                    locale: row.locale,
                  }
            );
          }
          return authors;
        }
      );

      return { describe } satisfies IReservationAuthorDirectory;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
