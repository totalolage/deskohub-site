import "server-only";

import {
  type AccountPasskey,
  CurrentCustomerSession,
  type CustomerAccountState,
  type CustomerAgentConnection,
  type CustomerAnalyticsConsentSync,
  type CustomerAnalyticsPreference,
  type CustomerAnalyticsPreferenceSaved,
  CustomerMarketingPreferencesRejected,
  CustomerServiceUnavailable,
  type CustomerSession,
  CustomerSessionRequired,
  customerReferralCodeHeader,
  profileCompletionSaveOf,
  profileUpdateSaveOf,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { loadAccountState } from "@/features/account/backend/account-state";
import { accountStateCapabilitiesForRun } from "@/features/account/backend/account-state-capabilities";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { requestCurrentAccountDeletion } from "@/features/account/backend/current-account-deletion";
import { listCurrentCustomerPasskeys } from "@/features/account/backend/current-customer-passkeys";
import { currentReferralOverview } from "@/features/account/backend/current-referral-overview";
import { requireVerifiedIdentity } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { removeCurrentCustomerAvatar } from "@/features/account/backend/customer-avatar-mutations";
import { CustomerLocalePreference } from "@/features/account/backend/customer-locale-preference.service";
import {
  completeCurrentCustomerProfile,
  updateCurrentCustomerProfile,
} from "@/features/account/backend/customer-profile-saving";
import { acknowledgeCurrentSignupReferral } from "@/features/account/backend/signup-referral";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import type { CustomerAgentConnection as AgentConnectionRecord } from "@/features/account/customer-agent-connections";
import type { AccountPasskey as AccountPasskeyRecord } from "@/features/account/passkeys";
import {
  type AccountAnalyticsDecisionForDevice,
  type DeviceAnalyticsChoice,
  syncAppAnalyticsConsent,
} from "@/features/legal/backend/analytics-consent-mirror";
import {
  readAnalyticsPreference,
  saveAnalyticsPreference,
} from "@/features/legal/backend/analytics-consent-preference";
import {
  MarketingPreferences,
  MarketingPreferencesMutationError,
} from "@/features/legal/backend/marketing-preferences.service";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { providePerRequest } from "@/shared/backend/provide-per-request";
import {
  parseInstant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { CustomerAccountLayers } from "./customer-account-layers";
import {
  answerCustomerApiFailure,
  answerSessionApiFailure,
  answerUnavailable,
} from "./customer-api-failure";
import { customerAvatarUploadHandler } from "./customer-avatar-upload";

/**
 * The account group's handlers. Each endpoint builds its operation's Layers
 * from `CustomerAccountLayers` and answers every failure with the
 * contract's fixed public errors. An endpoint whose Layers carry a release
 * gate builds them with `providePerRequest`, so the gate decides for its
 * request alone; the others keep nothing for a request.
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

    /** The analytics consent ledger under the signed-in account's authority. */
    const analyticsConsent = Layer.mergeAll(
      authentication,
      services.analyticsConsentLedger
    );

    return (
      handlers
        .handle("getAccount", ({ headers }) =>
          loadAccountState.pipe(
            providePerRequest(
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
          profileUpdateSaveOf(payload).pipe(
            Effect.flatMap(updateCurrentCustomerProfile),
            providePerRequest(profileSaving),
            answerCustomerApiFailure("customerApi.updateProfile")
          )
        )
        // The session's account saves its own language, as the web language
        // switcher does; it isn't Dotypos data, so no profile is needed.
        .handle("updateLocale", ({ payload: { locale } }) =>
          Effect.flatMap(CurrentCustomerSession, ({ accountId }) =>
            Effect.flatMap(CustomerLocalePreference, (preference) =>
              preference.save(accountId, locale)
            )
          ).pipe(
            Effect.provide(
              services.localePreference.pipe(Layer.provide(authentication))
            ),
            answerCustomerApiFailure("customerApi.updateLocale"),
            Effect.as({ locale })
          )
        )
        .handle("completeProfile", ({ headers, payload }) =>
          profileCompletionSaveOf(payload).pipe(
            Effect.flatMap(completeCurrentCustomerProfile),
            providePerRequest(
              profileCompletion(headers[customerReferralCodeHeader])
            ),
            answerCustomerApiFailure("customerApi.completeProfile")
          )
        )
        .handle("uploadAvatar", yield* customerAvatarUploadHandler)
        .handle("removeAvatar", () =>
          removeCurrentCustomerAvatar().pipe(
            providePerRequest(
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
            providePerRequest(
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
        .handle("syncAnalyticsConsent", ({ payload: { choice, locale } }) =>
          syncAppAnalyticsConsent({
            // A date that names no instant leaves the choice undated, as
            // a consent cookie without a valid timestamp does.
            choice: Option.map(
              Option.fromNullishOr(choice),
              (made): DeviceAnalyticsChoice => ({
                decision: made.analytics ? "grant" : "withdraw",
                locale,
                decidedAt: parseInstant(made.decidedAt),
              })
            ),
          }).pipe(
            Effect.provide(analyticsConsent),
            answerCustomerApiFailure("customerApi.syncAnalyticsConsent"),
            Effect.map(answerAnalyticsConsentSync)
          )
        )
        .handle("getAnalyticsPreference", () =>
          readAnalyticsPreference().pipe(
            Effect.flatMap((state) =>
              state.status === "available"
                ? Effect.succeed<CustomerAnalyticsPreference>({
                    granted: state.granted,
                  })
                : signedOutAnalyticsAccount
            ),
            Effect.provide(analyticsConsent),
            answerCustomerApiFailure("customerApi.getAnalyticsPreference")
          )
        )
        .handle("saveAnalyticsPreference", ({ payload: { granted, locale } }) =>
          saveAnalyticsPreference({ granted, locale }).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => signedOutAnalyticsAccount,
                onSome: ({ decidedAt }) =>
                  Effect.succeed<CustomerAnalyticsPreferenceSaved>({
                    granted,
                    decidedAt: temporalInstantToIsoString(decidedAt),
                  }),
              })
            ),
            Effect.provide(
              Layer.mergeAll(
                analyticsConsent,
                services.analyticsPersonAnonymisation
              )
            ),
            answerCustomerApiFailure("customerApi.saveAnalyticsPreference")
          )
        )
        .handle("getReferrals", () =>
          currentReferralOverview().pipe(
            providePerRequest(
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
            providePerRequest(
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

/**
 * The account's analytics decision the app takes, dated at its instant
 * truncated to the millisecond, so the app's copy never outranks the
 * decision it copies and syncing it back appends nothing.
 */
const answerAnalyticsConsentSync = (
  decision: Option.Option<AccountAnalyticsDecisionForDevice>
): CustomerAnalyticsConsentSync =>
  Option.match(decision, {
    onNone: () => ({ kind: "unchanged" }),
    onSome: ({ decision, decidedAt }) => ({
      kind: decision,
      decidedAt: temporalInstantToIsoString(decidedAt),
    }),
  });

/**
 * Why an analytics consent operation found no signed-in account although
 * the session middleware read one: the session ended since, or the
 * account's deletion is pending, which reading the session again tells
 * apart.
 */
const signedOutAnalyticsAccount = Effect.flatMap(
  CustomerAuthentication,
  ({ currentUser }) => currentUser
).pipe(
  Effect.flatMap(requireVerifiedIdentity),
  Effect.andThen(
    Effect.fail(new CustomerAccountAccessError({ reason: "unauthenticated" }))
  )
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
 * session's account, the one the state was read for, and an account without
 * a saved locale says so with null.
 */
const signedIn = (
  session: CustomerSession,
  { passkeys, localePreference, ...state }: SignedInAccountState
) =>
  Effect.succeed<CustomerAccountState>({
    ...state,
    locale: localePreference ?? null,
    ...(passkeys && {
      passkeys: { accountId: session.accountId, passkeys: passkeys.passkeys },
    }),
  });
