import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { promotionCodes } from "@/db/schema/discounts";
import { referralAttributions, referralCodes } from "@/db/schema/referrals";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { requireAccountActivity } from "@/features/account/backend/customer-account-activity";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import type { LinkedCustomerAccount } from "@/features/account/customer-account";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
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
import { evaluateReferralAttribution } from "./attribution";
import { parseReferralCode, type ReferralCode } from "./client";
import {
  type CheckoutReferralEvaluation,
  type ReferralAcceptance,
  type ReferralAccountSummary,
  type ReferralCodeKind,
  ReferralError,
} from "./contracts";
import {
  makeReferralInvitationCandidate,
  makeReferralReferrerCandidate,
} from "./referral-benefits";
import { ReferralReleaseGate } from "./referral-release-gate";
import { makeReferralStandingReads } from "./referral-standing";

export interface IReferralService {
  readonly getAccountSummary: (input: {
    readonly customerAccountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<ReferralAccountSummary, ReferralError>;
  readonly acceptReferral: (input: {
    readonly code: unknown;
    readonly customerAccountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<ReferralAcceptance, ReferralError>;
  readonly lookupCodeKind: (input: {
    readonly code: unknown;
  }) => Effect.Effect<ReferralCodeKind, ReferralError>;
  /**
   * Read-only check that a code can currently refer a new customer: an
   * enabled referral code inside its validity window whose owner has an
   * active linked account. Never issues a code or writes attribution.
   */
  readonly findAvailableCode: (input: {
    readonly code: unknown;
  }) => Effect.Effect<ReferralCode | undefined, ReferralError>;
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
  }) => Effect.Effect<CheckoutReferralEvaluation, ReferralError>;
  /**
   * Whether the customer's one referral is settled: an attribution exists or
   * a paid booking has closed the first-booking window. A remembered shared
   * code is then of no further use.
   */
  readonly hasSettledReferral: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<boolean, ReferralError>;
  /**
   * The 15% invitation for the customer's first paid booking, from an
   * existing attribution or, failing that, from the checkout's still-eligible
   * `referralCode`.
   */
  readonly resolveInvitationCandidate: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
    readonly referralCode?: CanonicalPromotionCode;
  }) => Effect.Effect<DiscountCandidate | undefined, ReferralError>;
  readonly resolveReferrerCandidate: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
    readonly remainingSubtotal: Money;
  }) => Effect.Effect<DiscountCandidate | undefined, ReferralError>;
}

const fail = (
  reason: ConstructorParameters<typeof ReferralError>[0]["reason"]
) => new ReferralError({ reason });

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

type InvitationReferral = {
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: PromotionCodeId;
};

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
      const accountResolver = yield* CustomerAccountResolver;
      const accountLinks = yield* CustomerAccountLinkRepository;
      const releaseGate = yield* ReferralReleaseGate;

      const requireCurrentIdentity = Effect.fn(
        "ReferralService.requireCurrentIdentity"
      )(
        (input: {
          readonly customerAccountId: CustomerAccountId;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) =>
          accountResolver.resolve.pipe(
            Effect.mapError(() => fail("account_unavailable")),
            Effect.flatMap((identity) =>
              identity.accountId === input.customerAccountId &&
              identity.dotyposCustomerId === input.dotyposCustomerId
                ? Effect.succeed(identity)
                : Effect.fail(fail("account_unavailable"))
            )
          )
      );

      const withActiveCurrentAccount = <A, E, R>(
        identity: LinkedCustomerAccount,
        effect: Effect.Effect<A, E, R>
      ) =>
        accountLinks.withAccountLock(
          identity.accountId,
          Effect.gen(function* () {
            yield* requireAccountActivity(
              accountLinks,
              identity.accountId
            ).pipe(Effect.mapError(() => fail("account_unavailable")));
            return yield* effect;
          })
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
              promotionCodeId: referralCodes.promotionCodeId,
              referrerDotyposCustomerId:
                referralCodes.referrerDotyposCustomerId,
              enabled: promotionCodes.enabled,
              validFrom: promotionCodes.validFrom,
              validUntil: promotionCodes.validUntil,
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
            .pipe(Effect.map(([attribution]) => attribution))
      );

      /**
       * Enabled, currently valid referral code whose owner has a linked
       * account without pending deletion.
       */
      const findActiveReferralTarget = Effect.fn(
        "ReferralService.findActiveReferralTarget"
      )((code: ReferralCode) =>
        db
          .select({
            promotionCodeId: referralCodes.promotionCodeId,
            referrerDotyposCustomerId: referralCodes.referrerDotyposCustomerId,
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
                  }
                : undefined
            )
          )
      );

      /**
       * Read-only counterpart of `acceptReferral` for a checkout: the same
       * rules, evaluated without locks because the payment admission and
       * paid transition recheck them before the invitation is used.
       */
      const evaluateReferralForCustomer = Effect.fn(
        "ReferralService.evaluateReferralForCustomer"
      )(function* (input: {
        readonly code: ReferralCode;
        readonly dotyposCustomerId: DotyposCustomerId;
        readonly attribution: InvitationReferral | undefined;
      }) {
        const target = yield* findActiveReferralTarget(input.code);
        if (!target) return yield* fail("unavailable");
        if (target.referrerDotyposCustomerId === input.dotyposCustomerId) {
          return yield* fail("self_referral");
        }
        if (input.attribution) {
          return input.attribution.referrerDotyposCustomerId ===
            target.referrerDotyposCustomerId
            ? ({ kind: "attributed", referral: input.attribution } as const)
            : yield* fail("already_attributed");
        }

        const window = yield* standing.findInvitationWindow(
          input.dotyposCustomerId
        );
        if (window === "closed") return yield* fail("ineligible");
        if (window === "claimed") return yield* fail("pending_payment");

        const graph = yield* db
          .select({
            invitedDotyposCustomerId:
              referralAttributions.invitedDotyposCustomerId,
            referrerDotyposCustomerId:
              referralAttributions.referrerDotyposCustomerId,
          })
          .from(referralAttributions);
        const decision = evaluateReferralAttribution({
          invitedCustomerId: input.dotyposCustomerId,
          referrerCustomerId: target.referrerDotyposCustomerId,
          existingReferrerByInvitee: new Map(
            graph.map((row) => [
              row.invitedDotyposCustomerId,
              row.referrerDotyposCustomerId,
            ])
          ),
        });
        if (decision.kind === "cycle") return yield* fail("cycle");
        if (decision.kind !== "accepted") return yield* fail("unavailable");
        return { kind: "eligible", referral: target } as const;
      });

      const evaluateCheckoutReferral = Effect.fn(
        "ReferralService.evaluateCheckoutReferral"
      )(
        (input: {
          readonly code: unknown;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) => {
          const code = normalizeCode(input.code);
          if (!code) return Effect.fail(fail("invalid_code"));
          return findAttribution(input.dotyposCustomerId).pipe(
            Effect.flatMap((attribution) =>
              evaluateReferralForCustomer({
                code,
                dotyposCustomerId: input.dotyposCustomerId,
                attribution,
              })
            ),
            Effect.map(
              (evaluation): CheckoutReferralEvaluation =>
                evaluation.kind === "attributed"
                  ? { kind: "already_accepted" }
                  : { kind: "eligible", code }
            ),
            Effect.mapError((error) =>
              error instanceof ReferralError ? error : fail("unavailable")
            )
          );
        }
      );

      const resolveInvitationCandidate = Effect.fn(
        "ReferralService.resolveInvitationCandidate"
      )(
        function* (input: {
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
          const evaluation = yield* evaluateReferralForCustomer({
            code,
            dotyposCustomerId: input.dotyposCustomerId,
            attribution,
          }).pipe(Effect.catchTag("ReferralError", () => Effect.undefined));
          return evaluation
            ? makeReferralInvitationCandidate({
                ...input,
                referral: evaluation.referral,
              })
            : undefined;
        },
        Effect.mapError(() => fail("unavailable"))
      );

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
              makeReferralReferrerCandidate({ ...input, eligibleInviteeCount })
            ),
            Effect.mapError(() => fail("unavailable"))
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
            ),
            Effect.mapError(() => fail("unavailable"))
          );
        }
      );

      const findAvailableCode = Effect.fn("ReferralService.findAvailableCode")(
        (input: { readonly code: unknown }) => {
          const code = normalizeCode(input.code);
          if (!code) return Effect.undefined;
          return findActiveReferralTarget(code).pipe(
            Effect.map((target) => (target ? code : undefined)),
            Effect.mapError(() => fail("unavailable"))
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
            ),
            Effect.mapError((error) =>
              error instanceof ReferralError ? error : fail("unavailable")
            )
          )
      );

      /** The invitee's account is still active and linked to the same customer. */
      const requireCurrentInviteeLink = Effect.fnUntraced(function* (
        identity: LinkedCustomerAccount
      ) {
        const [inviteeActivity] = yield* db
          .select({
            deletionRequestedAt: authUser.deletionRequestedAt,
          })
          .from(authUser)
          .where(eq(authUser.id, identity.accountId))
          .limit(1)
          .pipe(Effect.mapError(() => fail("account_unavailable")));
        if (!inviteeActivity || inviteeActivity.deletionRequestedAt !== null) {
          return yield* fail("account_unavailable");
        }
        const [currentLink] = yield* db
          .select({
            dotyposCustomerId: customerAccounts.dotyposCustomerId,
          })
          .from(customerAccounts)
          .where(eq(customerAccounts.id, identity.accountId))
          .limit(1)
          .pipe(Effect.mapError(() => fail("account_unavailable")));
        if (currentLink?.dotyposCustomerId !== identity.dotyposCustomerId) {
          return yield* fail("account_unavailable");
        }
      });

      /** The code, read again under the locks, still belongs to the same active referrer. */
      const requireCurrentReferral = Effect.fnUntraced(function* (
        code: ReferralCode,
        referrerDotyposCustomerId: DotyposCustomerId
      ) {
        const referral = yield* findReferralCode(code).pipe(
          Effect.mapError(() => fail("unavailable"))
        );
        if (
          !referral ||
          referral.referrerDotyposCustomerId !== referrerDotyposCustomerId ||
          !isReferralCodeActive(referral, Temporal.Now.instant())
        ) {
          return yield* fail("unavailable");
        }
        return referral;
      });

      /**
       * The referrer still has an account without pending deletion, and it is
       * the one whose lock this acceptance took.
       */
      const requireCurrentReferrerAccount = Effect.fnUntraced(function* (
        referrerDotyposCustomerId: DotyposCustomerId,
        lockedReferrerAccountId: CustomerAccountId | undefined
      ) {
        const [owner] = yield* db
          .select({ accountId: customerAccounts.id })
          .from(customerAccounts)
          .innerJoin(authUser, eq(authUser.id, customerAccounts.id))
          .where(
            and(
              eq(customerAccounts.dotyposCustomerId, referrerDotyposCustomerId),
              isNull(authUser.deletionRequestedAt)
            )
          )
          .limit(1)
          .pipe(Effect.mapError(() => fail("unavailable")));
        if (!owner || !lockedReferrerAccountId) {
          return yield* fail("unavailable");
        }
        const currentReferrerAccountId = yield* decodeLinkedAccountId(
          owner.accountId
        );
        if (currentReferrerAccountId !== lockedReferrerAccountId) {
          return yield* fail("unavailable");
        }
      });

      /**
       * An invitee already attributed to this referrer has accepted; one
       * attributed to another referrer can't change.
       */
      const findExistingAcceptance = Effect.fnUntraced(function* (
        identity: LinkedCustomerAccount,
        referral: InvitationReferral
      ) {
        const [existingAttribution] = yield* db
          .select({
            referrerDotyposCustomerId:
              referralAttributions.referrerDotyposCustomerId,
          })
          .from(referralAttributions)
          .where(
            eq(
              referralAttributions.invitedDotyposCustomerId,
              identity.dotyposCustomerId
            )
          )
          .limit(1)
          .pipe(Effect.mapError(() => fail("unavailable")));
        if (!existingAttribution) return undefined;
        return existingAttribution.referrerDotyposCustomerId ===
          referral.referrerDotyposCustomerId
          ? ({ kind: "already_accepted" } as const)
          : yield* fail("already_attributed");
      });

      /** The invitee has no paid booking and no payment in progress. */
      const requireOpenInvitation = Effect.fnUntraced(function* (
        identity: LinkedCustomerAccount
      ) {
        const history = yield* standing
          .loadCustomerHistoryInTurn(identity.dotyposCustomerId)
          .pipe(Effect.mapError(() => fail("unavailable")));
        if (history.hasPreviousPaidBooking) {
          return yield* fail("ineligible");
        }
        const [pendingAttempt] = yield* db
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            and(
              eq(
                workspaceReservations.dotyposCustomerId,
                identity.dotyposCustomerId
              ),
              eq(workspaceReservations.paymentState, "pending")
            )
          )
          .limit(1)
          .pipe(Effect.mapError(() => fail("unavailable")));
        // The invitation stays open until that payment settles; a reserved
        // invitation claim always comes with such a pending reservation.
        if (pendingAttempt) {
          return yield* fail("pending_payment");
        }
      });

      /** Records the attribution unless the referral graph rejects it. */
      const recordAttribution = Effect.fnUntraced(function* (
        identity: LinkedCustomerAccount,
        referral: InvitationReferral
      ) {
        const existingRows = yield* db
          .select({
            invitedDotyposCustomerId:
              referralAttributions.invitedDotyposCustomerId,
            referrerDotyposCustomerId:
              referralAttributions.referrerDotyposCustomerId,
          })
          .from(referralAttributions)
          .pipe(Effect.mapError(() => fail("unavailable")));
        const existing = new Map(
          existingRows.map((row) => [
            row.invitedDotyposCustomerId,
            row.referrerDotyposCustomerId,
          ])
        );
        const decision = evaluateReferralAttribution({
          invitedCustomerId: identity.dotyposCustomerId,
          referrerCustomerId: referral.referrerDotyposCustomerId,
          existingReferrerByInvitee: existing,
        });
        if (decision.kind === "already_attributed") {
          return yield* fail("already_attributed");
        }
        if (decision.kind === "cycle") {
          return yield* fail("cycle");
        }

        yield* db
          .insert(referralAttributions)
          .values({
            invitedDotyposCustomerId: identity.dotyposCustomerId,
            referrerDotyposCustomerId: referral.referrerDotyposCustomerId,
            promotionCodeId: referral.promotionCodeId,
          })
          .pipe(Effect.mapError(() => fail("unavailable")));
        return { kind: "accepted" } as const;
      });

      const acceptReferral = Effect.fn("ReferralService.acceptReferral")(
        (input: {
          readonly code: unknown;
          readonly customerAccountId: CustomerAccountId;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) => {
          const code = normalizeCode(input.code);
          if (!code) return Effect.fail(fail("invalid_code"));

          return requireCurrentIdentity(input).pipe(
            Effect.flatMap(
              Effect.fn("ReferralService.acceptWithIdentity")(
                function* (identity) {
                  const referralTarget = yield* findReferralCode(code).pipe(
                    Effect.mapError(() => fail("unavailable"))
                  );
                  if (!referralTarget) return yield* fail("unavailable");

                  const [ownerLink] = yield* db
                    .select({ accountId: customerAccounts.id })
                    .from(customerAccounts)
                    .where(
                      eq(
                        customerAccounts.dotyposCustomerId,
                        referralTarget.referrerDotyposCustomerId
                      )
                    )
                    .limit(1)
                    .pipe(Effect.mapError(() => fail("unavailable")));
                  const referrerAccountId = ownerLink
                    ? yield* decodeLinkedAccountId(ownerLink.accountId)
                    : undefined;
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

                        yield* requireCurrentInviteeLink(identity);
                        const referral = yield* requireCurrentReferral(
                          code,
                          referralTarget.referrerDotyposCustomerId
                        );
                        if (
                          identity.dotyposCustomerId ===
                          referral.referrerDotyposCustomerId
                        ) {
                          return yield* fail("self_referral");
                        }
                        yield* requireCurrentReferrerAccount(
                          referral.referrerDotyposCustomerId,
                          referrerAccountId
                        );

                        const accepted = yield* findExistingAcceptance(
                          identity,
                          referral
                        );
                        if (accepted) return accepted;
                        yield* requireOpenInvitation(identity);
                        return yield* recordAttribution(identity, referral);
                      })
                    )
                  );
                }
              )
            ),
            Effect.mapError((error) =>
              error instanceof ReferralError ? error : fail("unavailable")
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
          ),
          Effect.mapError(() => fail("unavailable"))
        )
      );

      // While the program is withheld, no code is a referral code and nothing
      // prices a referral. Reads and writes that could otherwise conclude
      // something about a code or customer fail as `disabled` instead, so no
      // caller mistakes a withheld program for an unusable code.
      const whenReleased =
        <Input, A, E, R>(
          operation: (input: Input) => Effect.Effect<A, E, R>,
          withheld: Effect.Effect<A, E>
        ) =>
        (input: Input) =>
          releaseGate.isOpen.pipe(
            Effect.flatMap((released) =>
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
        CustomerAccountResolver.Live,
        CustomerAccountLinkRepository.Live
      )
    )
  );
}
