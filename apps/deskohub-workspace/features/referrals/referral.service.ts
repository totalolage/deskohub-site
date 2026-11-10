import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Match, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { promotionCodes } from "@/db/schema/discounts";
import { referralAttributions, referralCodes } from "@/db/schema/referrals";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { isAccountActive } from "@/features/account/backend/customer-account-activity";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
  type LinkedCustomerAccount,
} from "@/features/account/customer-account";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";
import {
  canonicalPromotionCodeSchema,
  type PromotionCodeId,
} from "@/features/discounts/persistence-contracts";
import { generatePromotionCode } from "@/features/discounts/promotion-code";
import type { DiscountCandidate } from "@/features/discounts/provider";
import type { Locale } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { Money } from "@/shared/money/money";
import { parseReferralCode, type ReferralCode } from "./client";
import {
  type CheckoutReferralEvaluation,
  type ReferralAcceptance,
  ReferralAccountCheckUnavailable,
  type ReferralAccountOutage,
  type ReferralAccountSummary,
  ReferralAuthenticationUnavailable,
  type ReferralCodeKind,
  ReferralError,
  type ReferralOutage,
} from "./contracts";
import {
  makeReferralInvitationCandidate,
  makeReferralReferrerCandidate,
} from "./referral-benefits";
import { ReferralReleaseGate } from "./referral-release-gate";
import { makeReferralStandingReads } from "./referral-standing";
import {
  evaluateReferral,
  type InvitationReferral,
  type InvitationWindow,
  type ReferralEvaluation,
  type ReferralVerdict,
  type ReferrerByInvitee,
} from "./referral-verdict";

/**
 * Each operation fails with a `ReferralError` for a verdict or a withheld
 * program, and with a `ReferralOutage` when the referral store or Dotypos
 * could not be read, which says nothing about the code or the customer. The
 * signed-in account's operations also fail with
 * `ReferralAuthenticationUnavailable` when its session could not be read, and
 * the summary with `ReferralAccountCheckUnavailable` when its account lock or
 * deletion state could not be read; `account_unavailable` means the account
 * itself is gone, awaits deletion, or is no longer linked to that customer.
 */
export interface IReferralService {
  readonly getAccountSummary: (input: {
    readonly customerAccountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<
    ReferralAccountSummary,
    ReferralError | ReferralAccountOutage
  >;
  readonly acceptReferral: (input: {
    readonly code: unknown;
    readonly customerAccountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<
    ReferralAcceptance,
    ReferralError | ReferralAccountOutage
  >;
  readonly lookupCodeKind: (input: {
    readonly code: unknown;
  }) => Effect.Effect<ReferralCodeKind, DatabaseQueryError>;
  /**
   * Read-only check that a code can currently refer a new customer: an
   * enabled referral code inside its validity window whose owner has an
   * active linked account. Never issues a code or writes attribution.
   */
  readonly findAvailableCode: (input: {
    readonly code: unknown;
  }) => Effect.Effect<
    ReferralCode | undefined,
    ReferralError | DatabaseQueryError
  >;
  /**
   * Read-only check that a checkout may carry `code` for the booked customer:
   * an active referral code whose owner's account is active, no
   * self-referral or cycle, no different existing referrer, no prior paid
   * booking, and no invitation held by another payment. The attribution is
   * recorded only when the order carrying it is paid.
   */
  readonly evaluateCheckoutReferral: (input: {
    readonly code: unknown;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<
    CheckoutReferralEvaluation,
    ReferralError | ReferralOutage
  >;
  /**
   * Whether the customer's one referral is settled: an attribution exists or
   * a paid booking has closed the first-booking window. A remembered shared
   * code is then of no further use.
   */
  readonly hasSettledReferral: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<boolean, ReferralOutage>;
  /**
   * The 15% invitation for the customer's first paid booking, from an
   * existing attribution or, failing that, from the checkout's still-eligible
   * `referralCode`.
   */
  readonly resolveInvitationCandidate: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
    readonly referralCode?: CanonicalPromotionCode;
  }) => Effect.Effect<DiscountCandidate | undefined, ReferralOutage>;
  readonly resolveReferrerCandidate: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
    readonly remainingSubtotal: Money;
  }) => Effect.Effect<DiscountCandidate | undefined, ReferralOutage>;
}

const fail = (
  reason: ConstructorParameters<typeof ReferralError>[0]["reason"]
) => new ReferralError({ reason });

/**
 * The account section's failure as a verdict on the account or an outage. No
 * session or account, or one that awaits deletion, is `account_unavailable`;
 * a lock or account read that failed says nothing about the account.
 */
const accountSectionFailure = (
  error: CustomerAccountAccessError
): ReferralError | ReferralAccountCheckUnavailable =>
  Match.value(error.reason).pipe(
    Match.when(
      Match.is(
        "unauthenticated",
        "link-required",
        "unverified-email",
        "not-configured"
      ),
      () => fail("account_unavailable")
    ),
    Match.when(
      "unavailable",
      () =>
        new ReferralAccountCheckUnavailable(
          error.cause ? { code: error.cause.code } : {}
        )
    ),
    Match.exhaustive
  );

/** A stored account link's ID; a malformed one is a defect, not a referral outcome. */
const decodeLinkedAccountId = (accountId: string) =>
  Schema.decodeEffect(customerAccountIdSchema)(accountId).pipe(Effect.orDie);

// biome-ignore lint/plugin: Referral code APIs accept untrusted values and decode them at this boundary.
const normalizeCode = (value: unknown): ReferralCode | undefined => {
  if (!Schema.is(Schema.String)(value)) return undefined;
  const normalized = value
    .trim()
    .replace(/[a-z]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 32)
    );
  return parseReferralCode(normalized);
};

const isReferralCodeActive = (
  referral: {
    readonly enabled: boolean;
    readonly validFrom: Temporal.Instant | null;
    readonly validUntil: Temporal.Instant | null;
  },
  now: Temporal.Instant
) =>
  referral.enabled &&
  (referral.validFrom === null ||
    Temporal.Instant.compare(now, referral.validFrom) >= 0) &&
  (referral.validUntil === null ||
    Temporal.Instant.compare(now, referral.validUntil) < 0);

/**
 * How a context reads the facts a referral evaluation may ask for. Its
 * failures are the context's own and pass through as is.
 */
type ReferralFactReads<E> = {
  readonly attribution: Effect.Effect<InvitationReferral | undefined, E>;
  readonly invitationWindow: Effect.Effect<InvitationWindow, E>;
  readonly referrerByInvitee: Effect.Effect<ReferrerByInvitee, E>;
};

/**
 * Reads the fact the evaluation asks for, one at a time, and resumes it until
 * it decides. Holds no rule: the evaluation decides what to read next.
 */
const decideReferral = <E>(
  evaluation: ReferralEvaluation,
  reads: ReferralFactReads<E>
): Effect.Effect<ReferralVerdict, E> =>
  Match.value(evaluation).pipe(
    Match.discriminatorsExhaustive("kind")({
      decided: ({ verdict }) => Effect.succeed(verdict),
      needs_attribution: ({ resume }) =>
        Effect.flatMap(reads.attribution, (attribution) =>
          decideReferral(resume(attribution), reads)
        ),
      needs_invitation_window: ({ resume }) =>
        Effect.flatMap(reads.invitationWindow, (invitationWindow) =>
          decideReferral(resume(invitationWindow), reads)
        ),
      needs_referrer_by_invitee: ({ resume }) =>
        Effect.flatMap(reads.referrerByInvitee, (referrerByInvitee) =>
          decideReferral(resume(referrerByInvitee), reads)
        ),
    })
  );

export class ReferralService extends Context.Service<
  ReferralService,
  IReferralService
>()("@deskohub-workspace/referrals/ReferralService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
      const standing = yield* makeReferralStandingReads;
      const authentication = yield* CustomerAuthentication;
      const accountLinks = yield* CustomerAccountLinkRepository;
      const sections = yield* CustomerAccountSections;
      const releaseGate = yield* ReferralReleaseGate;

      /** The account exists and awaits no deletion. */
      const requireActiveAccount = (accountId: CustomerAccountId) =>
        accountLinks
          .findActivityState(accountId)
          .pipe(
            Effect.flatMap((activity) =>
              isAccountActive(activity)
                ? Effect.void
                : Effect.fail(fail("account_unavailable"))
            )
          );

      /** The account is active and still linked to the same customer. */
      const requireCurrentLink = Effect.fnUntraced(function* (
        identity: LinkedCustomerAccount
      ) {
        yield* requireActiveAccount(identity.accountId);
        const customerId = yield* accountLinks.find(identity.accountId);
        if (customerId !== identity.dotyposCustomerId) {
          return yield* fail("account_unavailable");
        }
      });

      /**
       * The signed-in session is the given account, linked to the given
       * customer. A session that couldn't be read is an outage, and a failed
       * database read passes through; neither is a verdict on the account.
       */
      const requireCurrentIdentity = Effect.fn(
        "ReferralService.requireCurrentIdentity"
      )(function* (input: {
        readonly customerAccountId: CustomerAccountId;
        readonly dotyposCustomerId: DotyposCustomerId;
      }) {
        const session = yield* authentication.currentUser.pipe(
          Effect.mapError((error) =>
            error.reason === "unavailable"
              ? new ReferralAuthenticationUnavailable(
                  error.diagnostic ? { diagnostic: error.diagnostic } : {}
                )
              : fail("account_unavailable")
          )
        );
        if (
          !session ||
          session.deletionRequested ||
          session.accountId !== input.customerAccountId
        ) {
          return yield* fail("account_unavailable");
        }
        const customerId = yield* accountLinks.find(session.accountId);
        if (customerId !== input.dotyposCustomerId) {
          return yield* fail("account_unavailable");
        }
        return {
          accountId: session.accountId,
          dotyposCustomerId: customerId,
        } satisfies LinkedCustomerAccount;
      });

      /**
       * Runs `effect` in the account's section, which rechecks under the lock
       * that the account exists and awaits no deletion. A gone or deleting
       * account is `account_unavailable`; a lock or deletion state that
       * couldn't be read is an outage. The work's own failures are referral
       * outcomes, so only the section's access error is mapped.
       */
      const withActiveCurrentAccount = <
        A,
        E extends ReferralError | ReferralAccountOutage,
        R,
      >(
        identity: LinkedCustomerAccount,
        effect: Effect.Effect<A, E, R>
      ) =>
        sections
          .withActiveAccount(identity.accountId, effect, { recheck: "active" })
          .pipe(
            Effect.mapError((error) =>
              error instanceof CustomerAccountAccessError
                ? accountSectionFailure(error)
                : error
            )
          );

      const findCodeKind = Effect.fn("ReferralService.findCodeKind")(
        (code: ReferralCode) =>
          db
            .select({ kind: promotionCodes.kind })
            .from(promotionCodes)
            .where(
              eq(promotionCodes.code, canonicalPromotionCodeSchema.make(code))
            )
            .limit(1)
            .pipe(Effect.map((rows) => rows[0]?.kind))
      );

      const findReferralCode = Effect.fn("ReferralService.findReferralCode")(
        (code: ReferralCode) =>
          db
            .select({
              referrerDotyposCustomerId:
                referralCodes.referrerDotyposCustomerId,
            })
            .from(referralCodes)
            .innerJoin(
              promotionCodes,
              eq(promotionCodes.id, referralCodes.promotionCodeId)
            )
            .where(
              and(
                eq(
                  promotionCodes.code,
                  canonicalPromotionCodeSchema.make(code)
                ),
                eq(promotionCodes.kind, "referral")
              )
            )
            .limit(1)
            .pipe(Effect.map((rows) => rows[0]))
      );

      const findAttribution = Effect.fn("ReferralService.findAttribution")(
        (dotyposCustomerId: DotyposCustomerId) =>
          db
            .select({
              referrerDotyposCustomerId:
                referralAttributions.referrerDotyposCustomerId,
              promotionCodeId: referralAttributions.promotionCodeId,
            })
            .from(referralAttributions)
            .where(
              eq(
                referralAttributions.invitedDotyposCustomerId,
                dotyposCustomerId
              )
            )
            .limit(1)
            .pipe(
              Effect.map(
                ([attribution]): InvitationReferral | undefined => attribution
              )
            )
      );

      /**
       * Enabled, currently valid referral code whose owner has a linked
       * account without pending deletion, with that account.
       */
      const findActiveReferralTarget = Effect.fn(
        "ReferralService.findActiveReferralTarget"
      )((code: ReferralCode) =>
        db
          .select({
            promotionCodeId: referralCodes.promotionCodeId,
            referrerDotyposCustomerId: referralCodes.referrerDotyposCustomerId,
            referrerAccountId: customerAccounts.id,
            enabled: promotionCodes.enabled,
            validFrom: promotionCodes.validFrom,
            validUntil: promotionCodes.validUntil,
          })
          .from(referralCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, referralCodes.promotionCodeId)
          )
          .innerJoin(
            customerAccounts,
            eq(
              customerAccounts.dotyposCustomerId,
              referralCodes.referrerDotyposCustomerId
            )
          )
          .innerJoin(authUser, eq(authUser.id, customerAccounts.id))
          .where(
            and(
              eq(promotionCodes.code, canonicalPromotionCodeSchema.make(code)),
              eq(promotionCodes.kind, "referral"),
              isNull(authUser.deletionRequestedAt)
            )
          )
          .limit(1)
          .pipe(
            Effect.map(([referral]) =>
              referral && isReferralCodeActive(referral, Temporal.Now.instant())
                ? {
                    promotionCodeId: referral.promotionCodeId,
                    referrerDotyposCustomerId:
                      referral.referrerDotyposCustomerId,
                    referrerAccountId: referral.referrerAccountId,
                  }
                : undefined
            )
          )
      );

      /** Every recorded referral, as each invited customer's referrer. */
      const loadReferrerByInvitee = Effect.suspend(() =>
        db
          .select({
            invitedDotyposCustomerId:
              referralAttributions.invitedDotyposCustomerId,
            referrerDotyposCustomerId:
              referralAttributions.referrerDotyposCustomerId,
          })
          .from(referralAttributions)
      ).pipe(
        Effect.map(
          (rows): ReferrerByInvitee =>
            new Map(
              rows.map((row) => [
                row.invitedDotyposCustomerId,
                row.referrerDotyposCustomerId,
              ])
            )
        ),
        Effect.withSpan("ReferralService.loadReferrerByInvitee")
      );

      /**
       * A checkout's facts, read without locks because the payment admission
       * and paid transition recheck them before the invitation is used. Only
       * an active invitation claim holds the invitation: the checkout's own
       * booking may be the pending one.
       */
      const checkoutReferralFactReads = (
        dotyposCustomerId: DotyposCustomerId
      ): ReferralFactReads<ReferralOutage> => ({
        attribution: findAttribution(dotyposCustomerId),
        invitationWindow: standing.findInvitationWindow(dotyposCustomerId),
        referrerByInvitee: loadReferrerByInvitee,
      });

      const decideCheckoutReferral = Effect.fnUntraced(function* (input: {
        readonly code: ReferralCode;
        readonly dotyposCustomerId: DotyposCustomerId;
        readonly reads: ReferralFactReads<ReferralOutage>;
      }) {
        const target = yield* findActiveReferralTarget(input.code);
        return yield* decideReferral(
          evaluateReferral({
            invitedDotyposCustomerId: input.dotyposCustomerId,
            target,
          }),
          input.reads
        );
      });

      const evaluateCheckoutReferral = Effect.fn(
        "ReferralService.evaluateCheckoutReferral"
      )(function* (input: {
        readonly code: unknown;
        readonly dotyposCustomerId: DotyposCustomerId;
      }) {
        const code = normalizeCode(input.code);
        if (!code) return yield* fail("invalid_code");
        const verdict = yield* decideCheckoutReferral({
          code,
          dotyposCustomerId: input.dotyposCustomerId,
          reads: checkoutReferralFactReads(input.dotyposCustomerId),
        });
        return yield* Match.value(verdict).pipe(
          Match.discriminatorsExhaustive("kind")({
            eligible: () =>
              Effect.succeed<CheckoutReferralEvaluation>({
                kind: "eligible",
                code,
              }),
            already_accepted: () =>
              Effect.succeed<CheckoutReferralEvaluation>({
                kind: "already_accepted",
              }),
            rejected: ({ reason }) => Effect.fail(fail(reason)),
          })
        );
      });

      const resolveInvitationCandidate = Effect.fn(
        "ReferralService.resolveInvitationCandidate"
      )(function* (input: {
        readonly dotyposCustomerId: DotyposCustomerId;
        readonly locale: Locale;
        readonly referralCode?: CanonicalPromotionCode;
      }) {
        const attribution = yield* findAttribution(input.dotyposCustomerId);
        if (attribution) {
          const window = yield* standing.findInvitationWindow(
            input.dotyposCustomerId
          );
          return window === "open"
            ? makeReferralInvitationCandidate({
                ...input,
                referral: attribution,
              })
            : undefined;
        }

        const code = normalizeCode(input.referralCode);
        if (!code) return undefined;
        // A carried code that is no longer usable simply stops pricing.
        const verdict = yield* decideCheckoutReferral({
          code,
          dotyposCustomerId: input.dotyposCustomerId,
          // The attribution was read above: the customer has none.
          reads: {
            ...checkoutReferralFactReads(input.dotyposCustomerId),
            attribution: Effect.succeed(attribution),
          },
        });
        return Match.value(verdict).pipe(
          Match.discriminatorsExhaustive("kind")({
            eligible: ({ referral }) =>
              makeReferralInvitationCandidate({ ...input, referral }),
            already_accepted: () => undefined,
            rejected: () => undefined,
          })
        );
      });

      const resolveReferrerCandidate = Effect.fn(
        "ReferralService.resolveReferrerCandidate"
      )(
        (input: {
          readonly dotyposCustomerId: DotyposCustomerId;
          readonly locale: Locale;
          readonly remainingSubtotal: Money;
        }) =>
          standing.eligibleInviteeCount(input.dotyposCustomerId).pipe(
            Effect.map((eligibleInviteeCount) =>
              makeReferralReferrerCandidate({
                ...input,
                eligibleInviteeCount,
              })
            )
          )
      );

      const parseIssuedReferralCode = (code: string) => {
        const referralCode = parseReferralCode(code);
        return referralCode
          ? Effect.succeed(referralCode)
          : Effect.fail(fail("unavailable"));
      };

      /**
       * Adopts the code a concurrent issue stored for the referrer after this
       * attempt's own promotion code lost, discarding that promotion code.
       */
      const adoptConcurrentlyIssuedCode = Effect.fnUntraced(function* (
        referrerDotyposCustomerId: DotyposCustomerId,
        abandonedPromotionCodeId: PromotionCodeId
      ) {
        const [raced] = yield* db
          .select({
            code: promotionCodes.code,
            promotionCodeId: promotionCodes.id,
          })
          .from(referralCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, referralCodes.promotionCodeId)
          )
          .where(
            eq(
              referralCodes.referrerDotyposCustomerId,
              referrerDotyposCustomerId
            )
          )
          .limit(1);
        if (!raced) return undefined;
        yield* db
          .delete(promotionCodes)
          .where(eq(promotionCodes.id, abandonedPromotionCodeId));
        return yield* parseIssuedReferralCode(raced.code);
      });

      /** One issue attempt; undefined when the generated code can't be used. */
      const issueGeneratedReferralCode = Effect.fnUntraced(function* (
        referrerDotyposCustomerId: DotyposCustomerId
      ) {
        const candidate = generatePromotionCode();
        const referralCode = parseReferralCode(candidate);
        if (!referralCode) return undefined;
        const [promotion] = yield* db
          .insert(promotionCodes)
          .values({
            kind: "referral",
            code: canonicalPromotionCodeSchema.make(candidate),
            enabled: true,
          })
          .onConflictDoNothing()
          .returning({ id: promotionCodes.id });
        if (!promotion) return undefined;

        const [created] = yield* db
          .insert(referralCodes)
          .values({
            promotionCodeId: promotion.id,
            referrerDotyposCustomerId,
          })
          .onConflictDoNothing()
          .returning({ promotionCodeId: referralCodes.promotionCodeId });
        if (created) return referralCode;

        return yield* adoptConcurrentlyIssuedCode(
          referrerDotyposCustomerId,
          promotion.id
        );
      });

      const ensureReferralCode = Effect.fn(
        "ReferralService.ensureReferralCode"
      )((referrerDotyposCustomerId: DotyposCustomerId) =>
        transaction(
          Effect.gen(function* () {
            const [existing] = yield* db
              .select({ code: promotionCodes.code })
              .from(referralCodes)
              .innerJoin(
                promotionCodes,
                eq(promotionCodes.id, referralCodes.promotionCodeId)
              )
              .where(
                eq(
                  referralCodes.referrerDotyposCustomerId,
                  referrerDotyposCustomerId
                )
              )
              .limit(1);
            if (existing) return yield* parseIssuedReferralCode(existing.code);

            for (let attempt = 0; attempt < 8; attempt += 1) {
              const issued = yield* issueGeneratedReferralCode(
                referrerDotyposCustomerId
              );
              if (issued) return issued;
            }

            return yield* fail("unavailable");
          })
        )
      );

      const lookupCodeKind = Effect.fn("ReferralService.lookupCodeKind")(
        (input: { readonly code: unknown }) => {
          const code = normalizeCode(input.code);
          if (!code) return Effect.succeed({ kind: "other" } as const);
          return findCodeKind(code).pipe(
            Effect.map((kind) =>
              kind === "referral"
                ? ({ kind: "referral" } as const)
                : ({ kind: "other" } as const)
            )
          );
        }
      );

      const findAvailableCode = Effect.fn("ReferralService.findAvailableCode")(
        (input: { readonly code: unknown }) => {
          const code = normalizeCode(input.code);
          if (!code) return Effect.undefined;
          return findActiveReferralTarget(code).pipe(
            Effect.map((target) => (target ? code : undefined))
          );
        }
      );

      const getAccountSummary = Effect.fn("ReferralService.getAccountSummary")(
        (input: {
          readonly customerAccountId: CustomerAccountId;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) =>
          requireCurrentIdentity(input).pipe(
            Effect.flatMap((identity) =>
              withActiveCurrentAccount(
                identity,
                standing.loadAccountSummary({
                  referrerDotyposCustomerId: identity.dotyposCustomerId,
                  code: ensureReferralCode(identity.dotyposCustomerId),
                })
              )
            )
          )
      );

      /**
       * The code's invitation, read again under the locks. It must still come
       * from the referrer whose account this acceptance locked: a code that
       * changed hands, or an owner who relinked meanwhile, isn't covered by
       * them, and a later attempt decides.
       */
      const findLockedReferralTarget = Effect.fnUntraced(function* (input: {
        readonly code: ReferralCode;
        readonly referrerDotyposCustomerId: DotyposCustomerId;
        readonly referrerAccountId: CustomerAccountId | undefined;
      }) {
        const target = yield* findActiveReferralTarget(input.code);
        if (!target) return undefined;
        const referrerAccountId = yield* decodeLinkedAccountId(
          target.referrerAccountId
        );
        if (
          target.referrerDotyposCustomerId !==
            input.referrerDotyposCustomerId ||
          referrerAccountId !== input.referrerAccountId
        ) {
          return yield* fail("referrer_changed");
        }
        return target;
      });

      /**
       * Under the acceptance's locks, any pending reservation holds the
       * invitation: its payment may still become the first paid booking, and
       * a reserved invitation claim always comes with one. History is read
       * one step at a time, as the transaction requires.
       */
      const findAcceptanceWindow = Effect.fnUntraced(function* (
        dotyposCustomerId: DotyposCustomerId
      ) {
        const history =
          yield* standing.loadCustomerHistoryInTurn(dotyposCustomerId);
        if (history.hasPreviousPaidBooking) return "closed" as const;
        const [pendingReservation] = yield* db
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            and(
              eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId),
              eq(workspaceReservations.paymentState, "pending")
            )
          )
          .limit(1);
        const window: InvitationWindow = pendingReservation ? "held" : "open";
        return window;
      });

      /**
       * Acceptance reads every fact under its locks, inside its transaction,
       * one at a time.
       */
      const decideAcceptedReferral = Effect.fnUntraced(function* (input: {
        readonly code: ReferralCode;
        readonly identity: LinkedCustomerAccount;
        readonly referrerDotyposCustomerId: DotyposCustomerId;
        readonly referrerAccountId: CustomerAccountId | undefined;
      }) {
        const { dotyposCustomerId } = input.identity;
        const target = yield* findLockedReferralTarget(input);
        return yield* decideReferral(
          evaluateReferral({
            invitedDotyposCustomerId: dotyposCustomerId,
            target,
          }),
          {
            attribution: findAttribution(dotyposCustomerId),
            invitationWindow: findAcceptanceWindow(dotyposCustomerId),
            referrerByInvitee: loadReferrerByInvitee,
          }
        );
      });

      /** Records the permanent referral the verdict admitted. */
      const recordAttribution = Effect.fnUntraced(function* (
        identity: LinkedCustomerAccount,
        referral: InvitationReferral
      ) {
        yield* db.insert(referralAttributions).values({
          invitedDotyposCustomerId: identity.dotyposCustomerId,
          referrerDotyposCustomerId: referral.referrerDotyposCustomerId,
          promotionCodeId: referral.promotionCodeId,
        });
        return { kind: "accepted" } as const;
      });

      /** The referrer's linked account, read before the locks only to lock it. */
      const findReferrerAccountId = Effect.fnUntraced(function* (
        referrerDotyposCustomerId: DotyposCustomerId
      ) {
        const [ownerLink] = yield* db
          .select({ accountId: customerAccounts.id })
          .from(customerAccounts)
          .where(
            eq(customerAccounts.dotyposCustomerId, referrerDotyposCustomerId)
          )
          .limit(1);
        return ownerLink
          ? yield* decodeLinkedAccountId(ownerLink.accountId)
          : undefined;
      });

      const acceptReferral = Effect.fn("ReferralService.acceptReferral")(
        function* (input: {
          readonly code: unknown;
          readonly customerAccountId: CustomerAccountId;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) {
          const code = normalizeCode(input.code);
          if (!code) return yield* fail("invalid_code");
          const identity = yield* requireCurrentIdentity(input);

          // Read before the locks only to know which accounts to lock; the
          // verdict reads everything again under them.
          const referralCode = yield* findReferralCode(code);
          if (!referralCode) return yield* fail("unavailable");
          const { referrerDotyposCustomerId } = referralCode;
          const referrerAccountId = yield* findReferrerAccountId(
            referrerDotyposCustomerId
          );
          return yield* advisoryLock.withTransactionPermit(
            transaction(
              Effect.gen(function* () {
                yield* WorkspaceLocks.referralGraph();
                yield* WorkspaceLocks.customerAccounts([
                  identity.accountId,
                  ...(referrerAccountId ? [referrerAccountId] : []),
                ]);
                yield* WorkspaceLocks.referralFirstBooking(
                  identity.dotyposCustomerId
                );

                yield* requireCurrentLink(identity);
                const verdict = yield* decideAcceptedReferral({
                  code,
                  identity,
                  referrerDotyposCustomerId,
                  referrerAccountId,
                });
                return yield* Match.value(verdict).pipe(
                  Match.discriminatorsExhaustive("kind")({
                    eligible: ({ referral }) =>
                      recordAttribution(identity, referral),
                    already_accepted: () =>
                      Effect.succeed({ kind: "already_accepted" } as const),
                    rejected: ({ reason }) => Effect.fail(fail(reason)),
                  })
                );
              })
            )
          );
        }
      );

      const hasSettledReferral = Effect.fn(
        "ReferralService.hasSettledReferral"
      )((input: { readonly dotyposCustomerId: DotyposCustomerId }) =>
        findAttribution(input.dotyposCustomerId).pipe(
          Effect.flatMap((attribution) =>
            attribution
              ? Effect.succeed(true)
              : standing
                  .findInvitationWindow(input.dotyposCustomerId)
                  .pipe(Effect.map((window) => window === "closed"))
          )
        )
      );

      // While the program is withheld, no code is a referral code and nothing
      // prices a referral. Reads and writes that could otherwise conclude
      // something about a code or customer fail as `disabled` instead, so no
      // caller mistakes a withheld program for an unusable code.
      const whenReleased =
        <Input, A, E, R, W = never>(
          operation: (input: Input) => Effect.Effect<A, E, R>,
          withheld: Effect.Effect<A, W>
        ): ((input: Input) => Effect.Effect<A, E | W, R>) =>
        (input: Input) =>
          releaseGate.isOpen.pipe(
            Effect.flatMap(
              (released): Effect.Effect<A, E | W, R> =>
                released ? operation(input) : withheld
            )
          );
      const disabled = Effect.fail(fail("disabled"));

      return {
        getAccountSummary: whenReleased(getAccountSummary, disabled),
        acceptReferral: whenReleased(acceptReferral, disabled),
        lookupCodeKind: whenReleased(
          lookupCodeKind,
          Effect.succeed({ kind: "other" } as const)
        ),
        findAvailableCode: whenReleased(findAvailableCode, disabled),
        evaluateCheckoutReferral: whenReleased(
          evaluateCheckoutReferral,
          disabled
        ),
        hasSettledReferral: whenReleased(
          hasSettledReferral,
          Effect.succeed(false)
        ),
        resolveInvitationCandidate: whenReleased(
          resolveInvitationCandidate,
          Effect.undefined
        ),
        resolveReferrerCandidate: whenReleased(
          resolveReferrerCandidate,
          Effect.undefined
        ),
      } satisfies IReferralService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDatabaseAdvisoryLock.Default,
        WorkspaceDotyposLayer,
        CustomerAuthentication.Default,
        CustomerAccountLinkRepository.Live,
        CustomerAccountSections.Live
      )
    )
  );
}
