import { Context, Effect, Layer } from "effect";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
  LinkedCustomerAccount,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAuthentication } from "./customer-authentication.service";
import { requireLinkedCustomerAccount } from "./linked-customer-account";

interface ICustomerAccountReservationOwnership {
  /**
   * The signed-in account, verified active, without requiring a linked
   * Dotypos customer. It identifies the account that authored a reservation.
   */
  readonly activeAccountId: Effect.Effect<
    CustomerAccountId,
    CustomerAccountAccessError
  >;
  /**
   * The signed-in account with its linked Dotypos customer, verified active.
   * It identifies the customer a reservation was booked for.
   */
  readonly resolve: Effect.Effect<
    LinkedCustomerAccount,
    CustomerAccountAccessError
  >;
}

export class CustomerAccountReservationOwnership extends Context.Service<
  CustomerAccountReservationOwnership,
  ICustomerAccountReservationOwnership
>()("@deskohub-workspace/account/CustomerAccountReservationOwnership") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const current = yield* CurrentCustomerAccount;
      const links = yield* CustomerAccountLinkRepository;

      const activeAccountId = current.requireActive.pipe(
        Effect.map((session) => session.accountId),
        Effect.tap((accountId) => requireAccountActivity(links, accountId))
      );

      const resolve = requireLinkedCustomerAccount.pipe(
        Effect.provideService(CurrentCustomerAccount, current),
        Effect.tap((account) =>
          requireAccountActivity(links, account.accountId)
        )
      );

      return {
        activeAccountId,
        resolve,
      } satisfies ICustomerAccountReservationOwnership;
    })
  );

  /**
   * The service reading the customer through this authentication, such as
   * an agent's access token instead of the browser session.
   */
  static withAuthentication = <E, R>(
    authentication: Layer.Layer<CustomerAuthentication, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          CurrentCustomerAccount.withAuthentication(authentication),
          CustomerAccountLinkRepository.Live
        )
      )
    );

  static Live = this.withAuthentication(CustomerAuthentication.Default);
}
