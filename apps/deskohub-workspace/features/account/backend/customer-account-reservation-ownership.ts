import { Context, Effect, Layer } from "effect";
import type {
  CustomerAccountAccessError,
  LinkedCustomerAccount,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";

interface ICustomerAccountReservationOwnership {
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
      const resolver = yield* CustomerAccountResolver;
      const links = yield* CustomerAccountLinkRepository;

      const resolve = Effect.gen(function* () {
        const account = yield* resolver.resolve;
        yield* requireAccountActivity(links, account.accountId);
        return account;
      });

      return { resolve } satisfies ICustomerAccountReservationOwnership;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountResolver.Live,
        CustomerAccountLinkRepository.Live
      )
    )
  );
}
