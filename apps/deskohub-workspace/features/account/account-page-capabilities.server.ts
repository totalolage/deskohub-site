import "server-only";

import { type Context, Effect, Layer } from "effect";
import { AccountFeatureFlagService } from "@/features/account/backend/account-feature-flag.service";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import { ReferralService } from "@/features/referrals";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import type { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import { failuresAsDefects } from "@/shared/backend/workspace-effect";

/** Everything the account page reads while it loads. */
export type AccountPageCapabilities =
  | CustomerAuthentication
  | CustomerAccountResolver
  | CustomerProfileService
  | CustomerReservationHistoryService
  | CustomerAvatarService
  | CustomerPasskeys
  | CustomerAgentConnections
  | ReviewAccounts
  | ReferralService
  | ReferralSignupIntentRepository
  | ReferralFeatureFlagService
  | RememberedReferral
  | AccountFeatureFlagService;

/**
 * The layers the account page's capabilities come from. Each may fail to
 * build as its live layer can: on Dotypos or Cloudinary configuration, or
 * while loading a server module.
 */
export type AccountPageLayers = {
  readonly authentication: Layer.Layer<CustomerAuthentication>;
  readonly resolver: Layer.Layer<
    CustomerAccountResolver,
    Layer.Error<typeof CustomerAccountResolver.Live>
  >;
  readonly profile: Layer.Layer<
    CustomerProfileService,
    Layer.Error<typeof CustomerProfileService.Live>
  >;
  readonly history: Layer.Layer<
    CustomerReservationHistoryService,
    Layer.Error<typeof CustomerReservationHistoryService.Live>
  >;
  readonly avatar: Layer.Layer<
    CustomerAvatarService,
    Layer.Error<typeof CustomerAvatarService.Live>
  >;
  readonly passkeys: Layer.Layer<CustomerPasskeys>;
  readonly assistants: Layer.Layer<CustomerAgentConnections>;
  readonly reviewAccounts: Layer.Layer<ReviewAccounts>;
  readonly referrals: Layer.Layer<
    ReferralService,
    Layer.Error<typeof ReferralService.Live>,
    ReferralFeatureFlagService
  >;
  readonly signupIntents: Layer.Layer<ReferralSignupIntentRepository>;
  readonly referralRelease: Layer.Layer<ReferralFeatureFlagService>;
  readonly rememberedReferral: Layer.Layer<
    RememberedReferral,
    Layer.Error<typeof CustomerAccountContactService.Live>,
    ReferralService | ReferralFeatureFlagService
  >;
  readonly featureFlags: Layer.Layer<AccountFeatureFlagService>;
};

export const liveAccountPageLayers: AccountPageLayers = {
  authentication: CustomerAuthentication.Default,
  resolver: CustomerAccountResolver.Live,
  profile: CustomerProfileService.Live,
  history: CustomerReservationHistoryService.Live,
  avatar: CustomerAvatarService.Live,
  passkeys: CustomerPasskeys.Default,
  assistants: CustomerAgentConnections.Default,
  reviewAccounts: ReviewAccounts.Live,
  referrals: ReferralService.Live,
  signupIntents: ReferralSignupIntentRepository.Live,
  referralRelease: ReferralFeatureFlagRequest,
  rememberedReferral: RememberedReferral.Cookies.pipe(
    Layer.provide(CustomerAccountContactService.Live)
  ),
  featureFlags: AccountFeatureFlagService.Live,
};

/**
 * The account page's capabilities, built once at its edge. A capability whose
 * layer fails to build is replaced by one whose every operation dies with
 * that failure, so only the sections that use it degrade, through their own
 * recovery, and a section the page skips is unaffected. The authentication
 * that every state needs stays as it is.
 */
export const accountPageCapabilities = (
  layers: AccountPageLayers
): Layer.Layer<AccountPageCapabilities> => {
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
  return Layer.mergeAll(
    layers.authentication,
    layers.resolver.pipe(
      unavailableUntilUsed(CustomerAccountResolver, (failure) => ({
        resolve: failure,
        resolveLink: failure,
      }))
    ),
    layers.profile.pipe(
      unavailableUntilUsed(CustomerProfileService, (failure) => ({
        load: () => failure,
        update: () => failure,
        create: () => failure,
        createUnderHeldLock: () => failure,
      }))
    ),
    layers.history.pipe(
      unavailableUntilUsed(CustomerReservationHistoryService, (failure) => ({
        load: () => failure,
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
    layers.reviewAccounts.pipe(
      unavailableUntilUsed(ReviewAccounts, (failure) => ({
        isReviewAccount: () => failure,
        register: () => failure,
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
    layers.featureFlags.pipe(
      unavailableUntilUsed(AccountFeatureFlagService, (failure) => ({
        isSignInCodeEnabled: failure,
        isPasskeyEnabled: failure,
        isAvatarEnabled: failure,
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
const unavailableUntilUsed =
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
