import "server-only";

import {
  type AccountPasskey,
  CurrentCustomerSession,
  type CustomerAccountState,
  type CustomerAgentConnection,
  CustomerMarketingPreferencesRejected,
  CustomerServiceUnavailable,
  type CustomerSession,
  CustomerSessionRequired,
  customerReferralCodeHeader,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { loadAccountState } from "@/features/account/backend/account-state";
import { accountStateCapabilitiesForRun } from "@/features/account/backend/account-state-capabilities";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { requestCurrentAccountDeletion } from "@/features/account/backend/current-account-deletion";
import { listCurrentCustomerPasskeys } from "@/features/account/backend/current-customer-passkeys";
import { currentReferralOverview } from "@/features/account/backend/current-referral-overview";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { removeCurrentCustomerAvatar } from "@/features/account/backend/customer-avatar-mutations";
import {
  completeCurrentCustomerProfile,
  updateCurrentCustomerProfile,
} from "@/features/account/backend/customer-profile-saving";
import { acknowledgeCurrentSignupReferral } from "@/features/account/backend/signup-referral";
import type { CustomerAgentConnection as AgentConnectionRecord } from "@/features/account/customer-agent-connections";
import type { AccountPasskey as AccountPasskeyRecord } from "@/features/account/passkeys";
import {
  MarketingPreferences,
  MarketingPreferencesMutationError,
} from "@/features/legal/backend/marketing-preferences.service";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { CustomerAccountLayers } from "./customer-account-layers";
import {
  answerCustomerApiFailure,
  answerSessionApiFailure,
  answerUnavailable,
} from "./customer-api-failure";
import { customerAvatarUploadHandler } from "./customer-avatar-upload";

/**
 * The account group's handlers. Each endpoint builds its operation's Layers
 * per request from `CustomerAccountLayers` and answers every failure with
 * the contract's fixed public errors.
 */
export const CustomerAccountApiHandlers = HttpApiBuilder.group(
  WorkspaceCustomerApi,
  "account",
  Effect.fn(function* (handlers) {
    const { services, releases } = yield* CustomerAccountLayers;
    // The authentication the session middleware read the request through.
    const authentication = Layer.succeed(
      CustomerAuthentication,
      yield* CustomerAuthentication
    );

    /**
     * What a profile save reads: the session, its account's Dotypos
     * customer and profile, and, for an account that isn't linked yet, the
     * referral program its creation consults.
     */
    const profileServices = Layer.mergeAll(
      authentication,
      services.resolver,
      services.profile,
      services.referrals,
      services.signupIntents
    );
    const profileSaving = profileServices.pipe(
      Layer.provideMerge(releases.referralRelease)
    );

    /**
     * What a profile completion reads beyond a save: the referral code the
     * client remembers, which this request only reads, and the session's
     * customer for its order bookers.
     */
    const profileCompletion = (rememberedCode: string | undefined) =>
      RememberedReferral.fromClient(rememberedCode).pipe(
        Layer.provideMerge(Layer.mergeAll(profileServices, services.contacts)),
        Layer.provideMerge(releases.referralRelease)
      );

    /** Marketing preferences under the signed-in account's authority. */
    const marketingPreferences = Layer.mergeAll(
      services.marketingPreferences,
      services.resolver,
      services.consentLedger
    );

    return (
      handlers
        .handle("getAccount", ({ headers }) =>
          loadAccountState.pipe(
            Effect.provide(
              accountStateCapabilitiesForRun(
                { referralCode: headers[customerReferralCodeHeader] },
                { ...services, authentication },
                releases
              )
            ),
            Effect.flatMap(answerAccountState)
          )
        )
        .handle("updateProfile", ({ payload }) =>
          updateCurrentCustomerProfile(payload).pipe(
            Effect.provide(profileSaving),
            answerCustomerApiFailure("customerApi.updateProfile")
          )
        )
        .handle("completeProfile", ({ headers, payload }) =>
          completeCurrentCustomerProfile(payload).pipe(
            Effect.provide(
              profileCompletion(headers[customerReferralCodeHeader])
            ),
            answerCustomerApiFailure("customerApi.completeProfile")
          )
        )
        .handle("uploadAvatar", yield* customerAvatarUploadHandler)
        .handle("removeAvatar", () =>
          removeCurrentCustomerAvatar().pipe(
            Effect.provide(
              Layer.mergeAll(
                authentication,
                services.resolver,
                services.avatar,
                releases.avatarRelease
              )
            ),
            answerCustomerApiFailure("customerApi.removeAvatar"),
            Effect.flatMap(({ status }) =>
              Match.value(status).pipe(
                Match.when("removed", () => Effect.void),
                // The image provider couldn't confirm it; removing again is
                // safe.
                Match.when("retryable", () =>
                  answerUnavailable("customerApi.removeAvatar", {
                    outcome: status,
                  })
                ),
                Match.exhaustive
              )
            )
          )
        )
        .handle("listPasskeys", () =>
          listCurrentCustomerPasskeys.pipe(
            Effect.provide(
              Layer.mergeAll(
                authentication,
                services.passkeys,
                releases.passkeyRelease
              )
            ),
            answerSessionApiFailure("customerApi.listPasskeys"),
            Effect.map((passkeys) => passkeys.map(answerPasskey))
          )
        )
        .handle("listAssistantConnections", () =>
          Effect.flatMap(
            CustomerAgentConnections,
            (assistants) => assistants.list
          ).pipe(
            Effect.provide(Layer.mergeAll(authentication, services.assistants)),
            answerSessionApiFailure("customerApi.listAssistantConnections"),
            Effect.map((connections) => connections.map(answerAgentConnection))
          )
        )
        .handle("getMarketingPreferences", () =>
          Effect.flatMap(
            MarketingPreferences,
            (preferences) => preferences.read
          ).pipe(
            Effect.provide(marketingPreferences),
            failWithMarketingAccountFailure,
            answerCustomerApiFailure("customerApi.getMarketingPreferences"),
            Effect.flatMap(answerMarketingPreferences)
          )
        )
        .handle(
          "saveMarketingPreferences",
          ({ payload: { context, granted, locale } }) =>
            Effect.flatMap(MarketingPreferences, (preferences) =>
              preferences.save({ source: "account", context, granted, locale })
            ).pipe(
              Effect.provide(marketingPreferences),
              failWithMarketingAccountFailure,
              answerCustomerApiFailure("customerApi.saveMarketingPreferences"),
              Effect.flatMap(answerMarketingPreferencesSave)
            )
        )
        .handle("getReferrals", () =>
          currentReferralOverview().pipe(
            Effect.provide(
              Layer.mergeAll(
                authentication,
                services.resolver,
                services.referrals
              ).pipe(Layer.provideMerge(releases.referralRelease))
            ),
            answerCustomerApiFailure("customerApi.getReferrals")
          )
        )
        .handle("acknowledgeSignupReferral", () =>
          acknowledgeCurrentSignupReferral().pipe(
            Effect.provide(
              Layer.mergeAll(
                authentication,
                services.resolver,
                services.signupIntents,
                releases.referralRelease
              )
            ),
            answerCustomerApiFailure("customerApi.acknowledgeSignupReferral"),
            Effect.asVoid
          )
        )
        // Every deletion outcome is a result the client words, as the
        // account page's action returns it.
        .handle("requestDeletion", () =>
          requestCurrentAccountDeletion.pipe(
            Effect.provide(
              Layer.mergeAll(authentication, services.accountDeletion)
            )
          )
        )
    );
  })
);

/** A passkey as the contract carries it, without unknown fields. */
const answerPasskey = ({
  name,
  provider,
  ...passkey
}: AccountPasskeyRecord): AccountPasskey => ({
  ...passkey,
  ...(name !== undefined && { name }),
  ...(provider !== undefined && { provider }),
});

/** An assistant connection as the contract carries it, without unknown fields. */
const answerAgentConnection = ({
  name,
  host,
  ...connection
}: AgentConnectionRecord): CustomerAgentConnection => ({
  ...connection,
  ...(name !== undefined && { name }),
  ...(host !== undefined && { host }),
});

/**
 * A marketing preferences failure as the account failure behind it, when the
 * signed-in account couldn't be resolved, so an account without a usable
 * Dotypos profile is told so instead of unavailable.
 */
const failWithMarketingAccountFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.mapError(effect, (failure) =>
    failure instanceof MarketingPreferencesMutationError
      ? (failure.account ?? failure)
      : failure
  );

/**
 * The signed-in account's marketing consent. The API presents no e-mail-link
 * credentials, so a link state can't arise, and the account-scoped read fails
 * rather than answer the unavailable state; each would answer unavailable.
 */
const answerMarketingPreferences = (state: MarketingPreferencesState) =>
  Match.value(state).pipe(
    Match.when(
      { status: Match.is("absent", "active", "withdrawn") },
      ({ status, context }) => Effect.succeed({ status, context })
    ),
    Match.orElse(({ status }) =>
      answerUnavailable("customerApi.getMarketingPreferences", { status })
    )
  );

type MarketingPreferencesSave = Effect.Success<
  ReturnType<MarketingPreferences["Service"]["save"]>
>;

/**
 * A saved choice, or a consent that changed since the client read it. The
 * link-only rejections can't arise without e-mail-link credentials, so they
 * are unavailable.
 */
const answerMarketingPreferencesSave = (save: MarketingPreferencesSave) =>
  Match.value(save).pipe(
    Match.when({ status: "saved" }, () => Effect.void),
    Match.when({ status: "rejected", reason: "stale-context" }, () =>
      Effect.fail(
        new CustomerMarketingPreferencesRejected({ reason: "stale-context" })
      )
    ),
    Match.when({ status: "rejected" }, ({ reason }) =>
      answerUnavailable("customerApi.saveMarketingPreferences", { reason })
    ),
    Match.exhaustive
  );

type LoadedAccountState = Effect.Success<typeof loadAccountState>;

/**
 * The signed-in account state the contract carries. The account state reads
 * the session again, so a session that ended since the middleware read it
 * asks to sign in again, and one that can't be read is unavailable.
 */
const answerAccountState = (state: LoadedAccountState) =>
  Effect.flatMap(CurrentCustomerSession, (session) =>
    Match.value(state).pipe(
      Match.discriminatorsExhaustive("kind")({
        unavailable: () => Effect.fail(new CustomerServiceUnavailable()),
        unauthenticated: () => Effect.fail(new CustomerSessionRequired()),
        "authenticated-unavailable": (state) => signedIn(session, state),
        "completion-required": (state) => signedIn(session, state),
        // The contract omits an absent overview rather than sending null.
        linked: ({ referrals, ...state }) =>
          signedIn(session, { ...state, ...(referrals && { referrals }) }),
        "support-required": (state) => signedIn(session, state),
        "review-account": (state) => signedIn(session, state),
        "deletion-pending": (state) => signedIn(session, state),
      })
    )
  );

type SignedInAccountState = Exclude<
  LoadedAccountState,
  { readonly kind: "unavailable" | "unauthenticated" }
>;

/**
 * A signed-in state as the contract carries it. Passkeys are keyed by the
 * session's account, the one the state was read for.
 */
const signedIn = (
  session: CustomerSession,
  { passkeys, ...state }: SignedInAccountState
) =>
  Effect.succeed<CustomerAccountState>({
    ...state,
    ...(passkeys && {
      passkeys: { accountId: session.accountId, passkeys: passkeys.passkeys },
    }),
  });
