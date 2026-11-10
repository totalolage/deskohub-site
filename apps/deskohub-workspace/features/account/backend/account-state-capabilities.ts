import { type Context, Effect, Layer } from "effect";
import {
  AccountAvatarReleaseGate,
  PasskeyReleaseGate,
} from "@/features/account/backend/account-release-gates";
import {
  AccountAvatarReleaseGateForRun,
  PasskeyReleaseGateForRun,
} from "@/features/account/backend/account-release-gates-run";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { ReferralService } from "@/features/referrals";
import type { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralReleaseGateForRun } from "@/features/referrals/referral-release-gate-run";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import {
  failuresAsDefects,
  isRecoverableCause,
} from "@/shared/backend/workspace-effect";

/** Everything the account state reads while it loads. */
export type AccountStateCapabilities =
  | CurrentCustomerAccount
  | CustomerProfileService
  | CustomerAvatarService
  | CustomerPasskeys
  | CustomerAgentConnections
  | ReferralService
  | ReferralSignupIntentRepository
  | ReferralReleaseGate
  | RememberedReferral
  | PasskeyReleaseGate
  | AccountAvatarReleaseGate;

/**
 * The layers the account state's capabilities come from. Each may fail to
 * build as its live layer can: on Dotypos or Cloudinary configuration, or
 * while loading a server module.
 */
export type AccountStateLayers = {
  readonly authentication: Layer.Layer<CustomerAuthentication>;
  /** The standing, reading the session through `authentication`. */
  readonly currentAccount: Layer.Layer<
    CurrentCustomerAccount,
    Layer.Error<typeof CurrentCustomerAccount.ForProvidedAuthentication>,
    CustomerAuthentication
  >;
  readonly profile: Layer.Layer<
    CustomerProfileService,
    Layer.Error<typeof CustomerProfileService.Live>
  >;
  readonly avatar: Layer.Layer<
    CustomerAvatarService,
    Layer.Error<typeof CustomerAvatarService.Live>
  >;
  readonly passkeys: Layer.Layer<CustomerPasskeys>;
  readonly assistants: Layer.Layer<CustomerAgentConnections>;
  /** The review marker the standing reads when its links can't be built. */
  readonly reviewAccounts: Layer.Layer<ReviewAccounts>;
  readonly referrals: Layer.Layer<
    ReferralService,
    Layer.Error<typeof ReferralService.Live>,
    ReferralReleaseGate
  >;
  readonly signupIntents: Layer.Layer<ReferralSignupIntentRepository>;
  readonly referralRelease: Layer.Layer<ReferralReleaseGate>;
  readonly rememberedReferral: Layer.Layer<
    RememberedReferral,
    Layer.Error<typeof CustomerAccountContactService.Live>,
    ReferralService | ReferralReleaseGate
  >;
  readonly passkeyRelease: Layer.Layer<PasskeyReleaseGate>;
  readonly avatarRelease: Layer.Layer<AccountAvatarReleaseGate>;
};

/**
 * The layers of the account services every edge reads through, independent
 * of how the request decides its release gates or remembers a referral code.
 */
export type AccountServiceLayers = Omit<
  AccountStateLayers,
  "referralRelease" | "rememberedReferral" | "passkeyRelease" | "avatarRelease"
> & {
  /** The session's customer, for the remembered referral's order bookers. */
  readonly contacts: Layer.Layer<
    CustomerAccountContactService,
    Layer.Error<typeof CustomerAccountContactService.Live>
  >;
  /** Link resolution for the operations outside the account state. */
  readonly resolver: Layer.Layer<
    CustomerAccountResolver,
    Layer.Error<typeof CustomerAccountResolver.Live>
  >;
};

/** The account services' live layers. */
export const liveAccountServiceLayers: AccountServiceLayers = {
  authentication: CustomerAuthentication.Default,
  currentAccount: CurrentCustomerAccount.ForProvidedAuthentication,
  resolver: CustomerAccountResolver.Live,
  profile: CustomerProfileService.Live,
  avatar: CustomerAvatarService.Live,
  passkeys: CustomerPasskeys.Default,
  assistants: CustomerAgentConnections.Default,
  reviewAccounts: ReviewAccounts.Live,
  referrals: ReferralService.Live,
  signupIntents: ReferralSignupIntentRepository.Live,
  contacts: CustomerAccountContactService.Live,
};

/** The account release gates, which each edge decides its own way. */
export type AccountReleaseLayers = Pick<
  AccountStateLayers,
  "referralRelease" | "passkeyRelease" | "avatarRelease"
>;

/**
 * The account release gates for a request served outside Next.js, such as
 * the customer HTTP API: each decided once per build, without React `cache`
 * or a nested runner. Build them once per request.
 */
export const runAccountReleaseLayers: AccountReleaseLayers = {
  referralRelease: ReferralReleaseGateForRun,
  passkeyRelease: PasskeyReleaseGateForRun,
  avatarRelease: AccountAvatarReleaseGateForRun,
};

/**
 * The account state's capabilities for one request served outside Next.js,
 * such as the customer HTTP API: release gates decided once per build,
 * without React `cache` or a nested runner, and the referral code the client
 * sent, which this request never writes. Build it once per request, inside
 * the request's Workspace request context.
 */
export const accountStateCapabilitiesForRun = (
  request: {
    /** The referral code the client remembers, as it sent it. */
    readonly referralCode: string | undefined;
  },
  services: AccountServiceLayers = liveAccountServiceLayers,
  releases: AccountReleaseLayers = runAccountReleaseLayers
): Layer.Layer<AccountStateCapabilities> =>
  accountStateCapabilities({
    ...services,
    ...releases,
    rememberedReferral: RememberedReferral.fromClient(
      request.referralCode
    ).pipe(Layer.provide(services.contacts)),
  });

/**
 * The account state's capabilities, built once at the caller's edge. A
 * capability whose layer fails to build is replaced by one whose every
 * operation dies with that failure, so only the sections that use it
 * degrade, through their own recovery, and a section the load skips is
 * unaffected. The authentication that every state needs stays as it is:
 * when the standing's link capabilities can't be built, the standing still
 * reads the session and review marker and reports its links unavailable.
 */
export const accountStateCapabilities = (
  layers: AccountStateLayers
): Layer.Layer<AccountStateCapabilities> => {
  const referrals = layers.referrals.pipe(
    unavailableUntilUsed(ReferralService, (failure) => ({
      getAccountSummary: () => failure,
      acceptReferral: () => failure,
      lookupCodeKind: () => failure,
      findAvailableCode: () => failure,
      evaluateCheckoutReferral: () => failure,
      hasSettledReferral: () => failure,
      resolveInvitationCandidate: () => failure,
      resolveReferrerCandidate: () => failure,
    }))
  );
  const reviewAccounts = layers.reviewAccounts.pipe(
    unavailableUntilUsed(ReviewAccounts, (failure) => ({
      isReviewAccount: () => failure,
      register: () => failure,
    }))
  );
  return Layer.mergeAll(
    layers.currentAccount.pipe(
      Layer.catchCause((cause) =>
        isRecoverableCause(cause)
          ? CurrentCustomerAccount.LinksUnavailable.pipe(
              Layer.provide(reviewAccounts)
            )
          : Layer.effect(
              CurrentCustomerAccount,
              Effect.failCause(failuresAsDefects(cause))
            )
      ),
      Layer.provide(layers.authentication)
    ),
    layers.profile.pipe(
      unavailableUntilUsed(CustomerProfileService, (failure) => ({
        load: () => failure,
        update: () => failure,
        create: () => failure,
      }))
    ),
    layers.avatar.pipe(
      unavailableUntilUsed(CustomerAvatarService, (failure) => ({
        upload: () => failure,
        remove: () => failure,
        destroy: () => failure,
        lookup: () => failure,
      }))
    ),
    layers.passkeys.pipe(
      unavailableUntilUsed(CustomerPasskeys, (failure) => ({
        list: failure,
      }))
    ),
    layers.assistants.pipe(
      unavailableUntilUsed(CustomerAgentConnections, (failure) => ({
        list: failure,
      }))
    ),
    referrals,
    layers.signupIntents.pipe(
      unavailableUntilUsed(ReferralSignupIntentRepository, (failure) => ({
        find: () => failure,
        findCodeTarget: () => failure,
        findAttributedCode: () => failure,
        settle: () => failure,
        acknowledge: () => failure,
      }))
    ),
    // Over the same referral capability, so its build failure surfaces
    // where the remembered code is checked.
    layers.rememberedReferral.pipe(
      Layer.provide(referrals),
      unavailableUntilUsed(RememberedReferral, (failure) => ({
        code: failure,
        forBooking: () => failure,
        remember: () => failure,
        forgetIfSettled: () => failure,
        isSettled: () => failure,
      }))
    ),
    layers.passkeyRelease.pipe(
      unavailableUntilUsed(PasskeyReleaseGate, (failure) => ({
        isOpen: failure,
      }))
    ),
    layers.avatarRelease.pipe(
      unavailableUntilUsed(AccountAvatarReleaseGate, (failure) => ({
        isOpen: failure,
      }))
    )
  ).pipe(Layer.provideMerge(layers.referralRelease));
};

/**
 * The build failure each stand-in replays, so a step can replay it before
 * it reads anything else.
 */
const buildFailures = new WeakMap<object, Effect.Effect<never>>();

/**
 * Replays the build failure of the capability `tag` names when its layer
 * couldn't be built, and does nothing otherwise. A step that may finish
 * without using the capability starts with it, so it fails as when it
 * provided that layer itself.
 */
export const replayBuildFailure = <I, S extends object>(
  tag: Context.Key<I, S>
) =>
  Effect.flatMap(tag, (service) => buildFailures.get(service) ?? Effect.void);

/**
 * Provides `tag` from a layer, or, when that layer can't be built, the
 * capability `unavailable` makes from an Effect that replays the build
 * failure, typed failures as defects. The failure then surfaces where the
 * capability is used, as it did when each section provided its own layer,
 * and interruption or Next.js control flow stays what it was.
 */
export const unavailableUntilUsed =
  <I, S extends object>(
    tag: Context.Key<I, S>,
    unavailable: (failure: Effect.Effect<never>) => S
  ) =>
  <E, R>(layer: Layer.Layer<I, E, R>): Layer.Layer<I, never, R> =>
    layer.pipe(
      Layer.catchCause((cause) => {
        const failure = Effect.failCause(failuresAsDefects(cause));
        const standIn = unavailable(failure);
        buildFailures.set(standIn, failure);
        return Layer.succeed(tag, standIn);
      })
    );
