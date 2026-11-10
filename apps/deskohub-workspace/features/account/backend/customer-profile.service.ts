import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import type { ReferralSignupIntent } from "@/features/referrals/signup-intent.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import type { CustomerProfile, CustomerProfileSave } from "../contracts";
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
import { resolveHeldCustomerAccountLink } from "./customer-account-resolver.service";
import {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "./customer-account-sections";
import { CustomerAuthentication } from "./customer-authentication.service";
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
    input: CustomerProfileSave
  ) => Effect.Effect<CustomerProfile, CustomerAccountAccessError>;
  /**
   * Creates or finds the account's Dotypos customer for its login email,
   * holding the account's section. Inside a section that already holds the
   * account, such as checkout state creation, it runs under that hold.
   * The signup referral is stored with the link only when this call creates
   * it; recording it is left to the caller once the section is released.
   */
  readonly create: (
    accountId: CustomerAccountId,
    input: CustomerProfileSave,
    signupReferral?: ReferralSignupIntent
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
      const sections = yield* CustomerAccountSections;
      const dotypos = yield* CustomerDotyposAdapter;
      const reviewAccounts = yield* ReviewAccounts;
      const heldResolution = {
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
        (account: LinkedCustomerAccount, input: CustomerProfileSave) =>
          sections.withActiveAccount(
            account.accountId,
            Effect.gen(function* () {
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
            }),
            { recheck: "active" }
          )
      );

      const createHeld = Effect.fn("CustomerProfileService.createHeld")(
        function* (
          input: CustomerProfileSave,
          signupReferral?: ReferralSignupIntent
        ) {
          const { accountId, email } = yield* HeldCustomerAccount;

          // Resolve before creating, so a returning customer's exact-email
          // profile, or the one an earlier attempt created before its link
          // write failed, is linked instead of duplicated.
          const resolution = yield* resolveHeldCustomerAccountLink(
            heldResolution,
            signupReferral
          ).pipe(
            Effect.catchIf(isCustomerProfileMissing, () => Effect.succeed(null))
          );
          if (resolution) {
            const profile = yield* readLinkedProfile(
              dotypos,
              resolution.account.dotyposCustomerId
            );
            // Holding the account, only this call can have claimed the link.
            return {
              account: resolution.account,
              profile,
              created: resolution.autoLinked,
            } satisfies CustomerProfileCreation;
          }

          const created = yield* dotypos
            .createCustomerProfile({ email, profile: input })
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
        }
      );

      const create = Effect.fn("CustomerProfileService.create")(
        (
          accountId: CustomerAccountId,
          input: CustomerProfileSave,
          signupReferral?: ReferralSignupIntent
        ) =>
          sections.withActiveAccount(
            accountId,
            createHeld(input, signupReferral),
            { recheck: "active" }
          )
      );

      return {
        create,
        load,
        update,
      } satisfies ICustomerProfileService;
    })
  );

  /**
   * The service whose sections read the session through this
   * authentication, such as an agent's access token instead of the browser
   * session.
   */
  static withAuthentication = <E, R>(
    authentication: Layer.Layer<CustomerAuthentication, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          CustomerAccountLinkRepository.Live,
          CustomerAccountSections.withAuthentication(authentication),
          CustomerDotyposAdapter.Live,
          ReviewAccounts.Live
        )
      )
    );

  static Live = this.withAuthentication(CustomerAuthentication.Default);
}
