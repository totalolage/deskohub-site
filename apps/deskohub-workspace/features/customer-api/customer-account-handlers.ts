import "server-only";

import {
  CurrentCustomerSession,
  type CustomerAccountState,
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
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { updateCurrentCustomerProfile } from "@/features/account/backend/customer-profile-saving";
import { CustomerAccountLayers } from "./customer-account-layers";
import { answerCustomerApiFailure } from "./customer-api-failure";
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
    const profileSaving = Layer.mergeAll(
      authentication,
      services.resolver,
      services.profile,
      services.referrals,
      services.signupIntents
    ).pipe(Layer.provideMerge(releases.referralRelease));

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
        // PLACEHOLDER(#983 account endpoints): each handler below answers
        // unavailable until the account endpoints clone replaces it with
        // the real operation and its four colocated tests.
        .handle("completeProfile", () => notServedYet)
        .handle("uploadAvatar", yield* customerAvatarUploadHandler)
        .handle("removeAvatar", () => notServedYet)
        .handle("listPasskeys", () => notServedYet)
        .handle("listAssistantConnections", () => notServedYet)
        .handle("getMarketingPreferences", () => notServedYet)
        .handle("saveMarketingPreferences", () => notServedYet)
        .handle("getReferrals", () => notServedYet)
        .handle("acknowledgeSignupReferral", () => notServedYet)
        .handle("requestDeletion", () => notServedYet)
    );
  })
);

/** PLACEHOLDER(#983 account endpoints): an endpoint not served yet. */
const notServedYet = Effect.fail(new CustomerServiceUnavailable());

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
