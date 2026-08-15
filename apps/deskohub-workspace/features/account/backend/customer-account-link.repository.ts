import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccountLinks } from "@/db/schema";
import type { CustomerAccountId } from "../customer-account";

export type CustomerAccountLinkClaim =
  | { readonly kind: "linked"; readonly customerId: DotyposCustomerId }
  | { readonly kind: "claimed" };

interface ICustomerAccountLinkRepository {
  readonly find: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, EffectDrizzleQueryError>;
  readonly claim: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerAccountLinkClaim, EffectDrizzleQueryError>;
  readonly unlink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export class CustomerAccountLinkRepository extends Context.Service<
  CustomerAccountLinkRepository,
  ICustomerAccountLinkRepository
>()("@deskohub-workspace/account/CustomerAccountLinkRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

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

      const unlink = Effect.fn("CustomerAccountLinkRepository.unlink")(
        (accountId: CustomerAccountId) =>
          db
            .delete(customerAccountLinks)
            .where(eq(customerAccountLinks.customerAccountId, accountId))
            .pipe(Effect.asVoid)
      );

      return { claim, find, unlink } satisfies ICustomerAccountLinkRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
