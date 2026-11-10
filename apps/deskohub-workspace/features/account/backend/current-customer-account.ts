import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Cause, Context, Effect, Layer, Option } from "effect";
import { ReviewAccounts } from "@/features/review-accounts";
import {
  catchRecoverableCause,
  failuresAsDefects,
  isRecoverableCause,
} from "@/shared/backend/workspace-effect";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  type CustomerAccountSupportReason,
  customerAccountUnavailable,
  isCustomerAccountSupportRequired,
  isCustomerProfileMissing,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountLinkResolution,
  requireVerifiedIdentity,
  resolveHeldCustomerAccountLink,
} from "./customer-account-resolver.service";
import { CustomerAccountSections } from "./customer-account-sections";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

/**
 * What the app-directory review marker read found for a signed-in account:
 * no marker, or a read that failed, which callers treat as their own policy
 * says.
 */
type ReviewMarker = "absent" | "unreadable";

/** The facts every standing past the session and review marker carries. */
type SignedInFacts = {
  readonly session: CustomerAccountSession;
  readonly reviewMarker: ReviewMarker;
};

/**
 * The current session's customer account, as facts. Each caller maps it to
 * its own outcome; the module decides no labels.
 *
 * - `signed-out`: no session, or the session ended while resolution waited
 *   for the account lock.
 * - `unverified`: the session's login email isn't verified (pre-lock read).
 * - `deletion-pending`: the session's account awaits deletion (pre-lock
 *   read). It carries the review
 *   marker, `present` included, because the account page decides its
 *   sign-in methods from it.
 * - `review`: an app-directory review account, which never links.
 * - `unlinked` (peek only): no stored Dotypos link; Dotypos wasn't asked.
 * - `profile-missing` (resolve only): no Dotypos customer has the email.
 * - `support-required` (resolve only): the email's Dotypos customers can't be
 *   linked safely.
 * - `linked`: the account's Dotypos customer. `autoLinked` is true only when
 *   this resolution claimed an existing exact-email customer.
 * - `unavailable`: the session is known, but the link, lock, or Dotypos step
 *   failed, or the recheck under the lock refused the session as unverified
 *   (`unverified-email`) or awaiting deletion (`link-required` with
 *   `deletion-requested`); `failure` says which.
 */
export type CustomerAccountStanding =
  | { readonly kind: "signed-out" }
  | { readonly kind: "unverified" }
  | {
      readonly kind: "deletion-pending";
      readonly session: CustomerAccountSession;
      readonly reviewMarker: ReviewMarker | "present";
    }
  | { readonly kind: "review"; readonly session: CustomerAccountSession }
  | ({ readonly kind: "unlinked" } & SignedInFacts)
  | ({ readonly kind: "profile-missing" } & SignedInFacts)
  | ({
      readonly kind: "support-required";
      readonly reason: CustomerAccountSupportReason;
    } & SignedInFacts)
  | ({
      readonly kind: "linked";
      readonly account: LinkedCustomerAccount;
      readonly autoLinked: boolean;
    } & SignedInFacts)
  | ({
      readonly kind: "unavailable";
      readonly failure: CustomerAccountAccessError;
    } & SignedInFacts);

type PeekedStanding = Exclude<
  CustomerAccountStanding,
  { readonly kind: "profile-missing" | "support-required" }
>;

type ResolvedStanding = Exclude<
  CustomerAccountStanding,
  { readonly kind: "unlinked" }
>;

interface ICurrentCustomerAccount {
  /**
   * The standing from the stored link only: it never claims, reactivates, or
   * asks Dotypos. Fails only when the session can't be read.
   */
  readonly peek: Effect.Effect<PeekedStanding, CustomerAccountAccessError>;
  /**
   * The standing after resolving an active, non-review account's link in
   * its account section (`recheck: "session"`): an existing link wins, then
   * one usable exact-email Dotypos customer is reactivated if expired and
   * claimed. It writes nothing else, no signup referral included. Inside a
   * section that already holds the account it runs under that hold. A step
   * that dies reads as `unavailable` (`account-link.lock`); interruption and
   * Next.js control flow propagate. Fails only when the session can't be
   * read.
   */
  readonly resolve: Effect.Effect<ResolvedStanding, CustomerAccountAccessError>;
  /**
   * The verified session of an account not awaiting deletion. No session
   * fails `unauthenticated`, an unverified email `unverified-email`, and a
   * deletion marker `link-required` with `deletion-requested`.
   */
  readonly requireActive: Effect.Effect<
    CustomerAccountSession,
    CustomerAccountAccessError
  >;
}

/** The reads behind a standing; the module's internal seam. */
type StandingReads = {
  readonly currentUser: Effect.Effect<
    CustomerAccountSession | null,
    CustomerAccountAccessError
  >;
  readonly isReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<boolean, unknown>;
  readonly findLink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, CustomerAccountAccessError>;
  /** Resolves the link in the account's section with the session recheck. */
  readonly resolveLink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<CustomerAccountLinkResolution, CustomerAccountAccessError>;
};

/** The standing once session, deletion, and review marker are known. */
type SessionStanding =
  | Exclude<
      CustomerAccountStanding,
      { readonly kind: "unlinked" | "profile-missing" | "support-required" }
    >
  | ({ readonly kind: "active" } & SignedInFacts);

const signedOut = { kind: "signed-out" } as const;
const unverified = { kind: "unverified" } as const;

const makeCurrentCustomerAccount = (
  reads: StandingReads
): ICurrentCustomerAccount => {
  /**
   * The marker read degrades: any failure, including a capability that
   * couldn't be built, reads as `unreadable` under a fixed code.
   */
  const readReviewMarker = (accountId: CustomerAccountId) =>
    reads.isReviewAccount(accountId).pipe(
      Effect.map((review): "present" | "absent" =>
        review ? "present" : "absent"
      ),
      catchRecoverableCause(() =>
        Effect.logWarning("Account review marker unavailable").pipe(
          Effect.annotateLogs({ code: "account.review.unavailable" }),
          Effect.as("unreadable" as const)
        )
      )
    );

  const sessionStanding: Effect.Effect<
    SessionStanding,
    CustomerAccountAccessError
  > = Effect.gen(function* () {
    const session = yield* reads.currentUser.pipe(
      Effect.catchIf(
        (error) => error.reason === "unverified-email",
        () => Effect.succeed(unverified)
      )
    );
    if (session === null) return signedOut;
    if ("kind" in session) return session;
    const marker = yield* readReviewMarker(session.accountId);
    if (session.deletionRequested) {
      return { kind: "deletion-pending", session, reviewMarker: marker };
    }
    if (marker === "present") return { kind: "review", session };
    return { kind: "active", session, reviewMarker: marker };
  });

  const peek = sessionStanding.pipe(
    Effect.flatMap((standing): Effect.Effect<PeekedStanding> => {
      if (standing.kind !== "active") return Effect.succeed(standing);
      const facts = {
        session: standing.session,
        reviewMarker: standing.reviewMarker,
      };
      return reads.findLink(standing.session.accountId).pipe(
        Effect.map(
          (dotyposCustomerId): PeekedStanding =>
            dotyposCustomerId
              ? {
                  kind: "linked",
                  account: {
                    accountId: standing.session.accountId,
                    dotyposCustomerId,
                  },
                  autoLinked: false,
                  ...facts,
                }
              : { kind: "unlinked", ...facts }
        ),
        Effect.catch((failure) =>
          Effect.succeed({ kind: "unavailable", failure, ...facts } as const)
        )
      );
    }),
    Effect.withSpan("CurrentCustomerAccount.peek")
  );

  /** A resolution failure as the standing it reports. */
  const resolutionFailure = (
    failure: CustomerAccountAccessError,
    facts: SignedInFacts
  ): ResolvedStanding => {
    if (isCustomerProfileMissing(failure)) {
      return { kind: "profile-missing", ...facts };
    }
    if (isCustomerAccountSupportRequired(failure)) {
      return { kind: "support-required", reason: failure.linkReason, ...facts };
    }
    // The section's recheck under the lock found the session gone.
    if (failure.reason === "unauthenticated") return signedOut;
    // Everything else, including a recheck that found the email unverified
    // or a deletion marker, stays a fact on `unavailable`: callers map those
    // residual refusals differently on purpose.
    return { kind: "unavailable", failure, ...facts };
  };

  const resolve = sessionStanding.pipe(
    Effect.flatMap((standing): Effect.Effect<ResolvedStanding> => {
      if (standing.kind !== "active") return Effect.succeed(standing);
      const facts = {
        session: standing.session,
        reviewMarker: standing.reviewMarker,
      };
      return reads.resolveLink(standing.session.accountId).pipe(
        Effect.map(
          (resolution): ResolvedStanding => ({
            kind: "linked",
            account: resolution.account,
            autoLinked: resolution.autoLinked,
            ...facts,
          })
        ),
        // Interruption and Next.js control flow win over a failure beside
        // them; a step that died reads as the unavailable lock.
        Effect.catchCause((cause) => {
          if (!isRecoverableCause(cause)) {
            return Effect.failCause(failuresAsDefects(cause));
          }
          return Option.match(Cause.findErrorOption(cause), {
            onSome: (failure) =>
              Effect.succeed(resolutionFailure(failure, facts)),
            onNone: () =>
              Effect.logError("Account resolution died", { cause }).pipe(
                Effect.as(
                  resolutionFailure(
                    customerAccountUnavailable("account-link.lock"),
                    facts
                  )
                )
              ),
          });
        })
      );
    }),
    Effect.withSpan("CurrentCustomerAccount.resolve")
  );

  const requireActive = reads.currentUser.pipe(
    Effect.flatMap(requireVerifiedIdentity),
    Effect.withSpan("CurrentCustomerAccount.requireActive")
  );

  return { peek, resolve, requireActive };
};

/**
 * The current session's customer account standing: the one place that
 * orders the session read, the review marker, the deletion marker, and link
 * resolution, and maps their failures. Callers keep their own policy as a
 * match over the standing.
 */
export class CurrentCustomerAccount extends Context.Service<
  CurrentCustomerAccount,
  ICurrentCustomerAccount
>()("@deskohub-workspace/account/CurrentCustomerAccount") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const reviewAccounts = yield* ReviewAccounts;
      const links = yield* CustomerAccountLinkRepository;
      const sections = yield* CustomerAccountSections;
      const dotypos = yield* CustomerDotyposAdapter;
      const heldSteps = {
        findLink: links.find,
        isReviewAccount: reviewAccounts.isReviewAccount,
        classify: dotypos.classifyExactEmailCustomers,
        claimLink: links.claim,
        reactivate: dotypos.reactivateCustomer,
      };
      return makeCurrentCustomerAccount({
        currentUser: authentication.currentUser,
        isReviewAccount: reviewAccounts.isReviewAccount,
        findLink: (accountId) =>
          links
            .find(accountId)
            .pipe(
              Effect.mapError(mapCustomerAccountFailure("account-link.read"))
            ),
        resolveLink: (accountId) =>
          sections.withActiveAccount(
            accountId,
            resolveHeldCustomerAccountLink(heldSteps),
            { recheck: "session" }
          ),
      });
    })
  );

  /**
   * The standing when its link capabilities can't be built: the session and
   * review marker still read, and every link step reports `unavailable`
   * (`account-link.lock`), so a page keeps the signed-in sections.
   */
  static LinksUnavailable = Layer.effect(
    this,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const reviewAccounts = yield* ReviewAccounts;
      const unavailable = () =>
        Effect.fail(customerAccountUnavailable("account-link.lock"));
      return makeCurrentCustomerAccount({
        currentUser: authentication.currentUser,
        isReviewAccount: reviewAccounts.isReviewAccount,
        findLink: unavailable,
        resolveLink: unavailable,
      });
    })
  );

  /**
   * The standing reading the session through the `CustomerAuthentication`
   * the caller provides later, such as a customer API request's.
   */
  static ForProvidedAuthentication = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReviewAccounts.Live,
        CustomerAccountLinkRepository.Live,
        CustomerAccountSections.ForProvidedAuthentication,
        CustomerDotyposAdapter.Live
      )
    )
  );

  /**
   * The standing reading the session through this authentication, such as
   * an agent's access token instead of the browser session.
   */
  static withAuthentication = <E, R>(
    authentication: Layer.Layer<CustomerAuthentication, E, R>
  ) => this.ForProvidedAuthentication.pipe(Layer.provide(authentication));

  static Live = this.withAuthentication(CustomerAuthentication.Default);
}
