import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import { CustomerAccountService } from "@/features/account/backend/customer-account.service";
import {
  getCustomerAccountId,
  getCustomerSession,
} from "@/features/account/session.server";
import { MobileShopFailure } from "../errors";

/**
 * Deliberately narrow projection of the account feature. The eventual live
 * adapter must obtain these values from Neon Auth and customer_account_links;
 * mobile shop code never performs an email lookup or owns a session table.
 */
export interface MobileShopAuthenticatedAccount {
  readonly customerLink:
    | { readonly kind: "linked"; readonly customerId: DotyposCustomerId }
    | { readonly kind: "unavailable" };
}

export interface IMobileShopCustomerAccess {
  readonly resolve: (
    request: Request
  ) => Effect.Effect<MobileShopAuthenticatedAccount, MobileShopFailure>;
}

export class MobileShopCustomerAccess extends Context.Service<
  MobileShopCustomerAccess,
  IMobileShopCustomerAccess
>()("@deskohub-workspace/mobile-shop/MobileShopCustomerAccess") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const accounts = yield* CustomerAccountService;

      return {
        resolve: Effect.fn("MobileShopCustomerAccess.resolve")(function* () {
          const session = yield* Effect.tryPromise({
            try: getCustomerSession,
            catch: MobileShopFailure.unauthorized,
          });
          const accountId = getCustomerAccountId(session?.user.id);
          if (!session?.user || !accountId) {
            return yield* MobileShopFailure.unauthorized();
          }
          if (!session.user.emailVerified) {
            return { customerLink: { kind: "unavailable" } } as const;
          }

          const link = yield* accounts
            .resolveCustomerLink({
              accountId,
              email: session.user.email,
              name: session.user.name,
            })
            .pipe(Effect.mapError(MobileShopFailure.integrationUnavailable));
          return link.kind === "linked"
            ? { customerLink: { kind: "linked", customerId: link.customerId } }
            : { customerLink: { kind: "unavailable" } };
        }),
      } satisfies IMobileShopCustomerAccess;
    })
  );

  static Unavailable = Layer.succeed(this, {
    resolve: Effect.fn("MobileShopCustomerAccess.unavailable")(() =>
      MobileShopFailure.integrationUnavailable(
        "The Neon Auth customer-account adapter has not been installed."
      )
    ),
  });
}
