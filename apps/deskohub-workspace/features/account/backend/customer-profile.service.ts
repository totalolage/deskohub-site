import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import type { ReferralSignupIntent } from "@/features/referrals/signup-intent.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import type { CustomerProfile, CustomerProfileInput } from "../contracts";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
  isCustomerProfileMissing,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { resolveCustomerAccountLinkUnderHeldLock } from "./customer-account-resolver.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

const readLinkedProfile = (
  dotypos: CustomerDotyposAdapter["Service"],
  customerId: DotyposCustomerId
) =>
  dotypos.readCustomerProfile(customerId).pipe(
    Effect.mapError(mapCustomerAccountFailure("dotypos.customer-lookup")),
    Effect.flatMap((profile) =>
      profile
        ? Effect.succeed(profile)
        : Effect.fail(customerAccountUnavailable("dotypos.customer-lookup"))
    )
  );

/**
 * The profile a completion ended with, the account it is linked to, and
 * whether this completion created that link rather than finding one.
 */
type CustomerProfileCreation = {
  readonly account: LinkedCustomerAccount;
  readonly profile: CustomerProfile;
  readonly created: boolean;
};

interface ICustomerProfileService {
  readonly load: (
    account: LinkedCustomerAccount
  ) => Effect.Effect<CustomerProfile, CustomerAccountAccessError>;
  readonly update: (
    account: LinkedCustomerAccount,
    input: CustomerProfileInput
  ) => Effect.Effect<CustomerProfile, CustomerAccountAccessError>;
  /**
   * The signup referral is stored with the link only when this call creates
   * it; recording it is left to the caller once the account lock is released.
   */
  readonly create: (
    accountId: CustomerAccountId,
    verifiedEmail: string,
    input: CustomerProfileInput,
    signupReferral?: ReferralSignupIntent
  ) => Effect.Effect<CustomerProfileCreation, CustomerAccountAccessError>;
  /**
   * `create` for a caller that already holds the account lock, such as
   * checkout state creation under the account activity guard. The lock isn't
   * reentrant, so `create` would wait on the caller forever.
   */
  readonly createUnderHeldLock: (
    accountId: CustomerAccountId,
    verifiedEmail: string,
    input: CustomerProfileInput
  ) => Effect.Effect<CustomerProfileCreation, CustomerAccountAccessError>;
}

export class CustomerProfileService extends Context.Service<
  CustomerProfileService,
  ICustomerProfileService
>()("@deskohub-workspace/account/CustomerProfileService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const links = yield* CustomerAccountLinkRepository;
      const dotypos = yield* CustomerDotyposAdapter;
      const reviewAccounts = yield* ReviewAccounts;
      const lockedResolution = {
        findLink: links.find,
        isReviewAccount: reviewAccounts.isReviewAccount,
        classify: dotypos.classifyExactEmailCustomers,
        claimLink: links.claim,
        reactivate: dotypos.reactivateCustomer,
      };

      const load = Effect.fn("CustomerProfileService.load")(
        (account: LinkedCustomerAccount) =>
          requireAccountActivity(links, account.accountId).pipe(
            Effect.andThen(
              readLinkedProfile(dotypos, account.dotyposCustomerId)
            )
          )
      );

      const update = Effect.fn("CustomerProfileService.update")(
        (account: LinkedCustomerAccount, input: CustomerProfileInput) =>
          links
            .withAccountLock(
              account.accountId,
              Effect.gen(function* () {
                yield* requireAccountActivity(links, account.accountId);
                yield* dotypos
                  .updateCustomerProfile(account.dotyposCustomerId, input)
                  .pipe(
                    Effect.mapError(
                      mapCustomerAccountFailure("dotypos.customer-lookup")
                    )
                  );
                return yield* readLinkedProfile(
                  dotypos,
                  account.dotyposCustomerId
                );
              })
            )
            .pipe(
              Effect.mapError(mapCustomerAccountFailure("account-link.lock"))
            )
      );

      const createUnderHeldLock = Effect.fn(
        "CustomerProfileService.createUnderHeldLock"
      )(function* (
        accountId: CustomerAccountId,
        verifiedEmail: string,
        input: CustomerProfileInput,
        signupReferral?: ReferralSignupIntent
      ) {
        yield* Effect.logDebug("Account profile create lock scope entered");
        yield* requireAccountActivity(links, accountId);

        // Resolve before creating, so a returning customer's exact-email
        // profile, or the one an earlier attempt created before its link
        // write failed, is linked instead of duplicated.
        const resolution = yield* resolveCustomerAccountLinkUnderHeldLock(
          lockedResolution,
          { accountId, email: verifiedEmail },
          signupReferral
        ).pipe(
          Effect.catchIf(isCustomerProfileMissing, () => Effect.succeed(null))
        );
        if (resolution) {
          const profile = yield* readLinkedProfile(
            dotypos,
            resolution.account.dotyposCustomerId
          );
          // Under the account lock only this call can have claimed the link.
          return {
            account: resolution.account,
            profile,
            created: resolution.autoLinked,
          } satisfies CustomerProfileCreation;
        }

        const created = yield* dotypos
          .createCustomerProfile({
            email: verifiedEmail,
            profile: input,
          })
          .pipe(
            Effect.mapError(
              mapCustomerAccountFailure("dotypos.customer-lookup")
            )
          );

        const claimed = yield* links
          .claim(accountId, created.customerId, signupReferral)
          .pipe(
            Effect.mapError(mapCustomerAccountFailure("account-link.claim"))
          );
        if (claimed.kind === "claimed") {
          return yield* new CustomerAccountAccessError({
            reason: "link-required",
            linkReason: "claimed",
          });
        }

        const account = {
          accountId,
          dotyposCustomerId: claimed.customerId,
        };
        if (claimed.customerId === created.customerId) {
          return {
            account,
            profile: created.profile,
            created: claimed.created,
          } satisfies CustomerProfileCreation;
        }

        const profile = yield* readLinkedProfile(dotypos, claimed.customerId);
        return {
          account,
          profile,
          created: claimed.created,
        } satisfies CustomerProfileCreation;
      });

      const create = Effect.fn("CustomerProfileService.create")(
        (
          accountId: CustomerAccountId,
          verifiedEmail: string,
          input: CustomerProfileInput,
          signupReferral?: ReferralSignupIntent
        ) =>
          links
            .withAccountLock(
              accountId,
              createUnderHeldLock(
                accountId,
                verifiedEmail,
                input,
                signupReferral
              )
            )
            .pipe(
              Effect.mapError(mapCustomerAccountFailure("account-link.lock")),
              Effect.tap(() =>
                Effect.logDebug("Account profile create lock scope passed")
              )
            )
      );

      return {
        create,
        createUnderHeldLock: (accountId, verifiedEmail, input) =>
          createUnderHeldLock(accountId, verifiedEmail, input),
        load,
        update,
      } satisfies ICustomerProfileService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountLinkRepository.Live,
        CustomerDotyposAdapter.Live,
        ReviewAccounts.Live
      )
    )
  );
}
