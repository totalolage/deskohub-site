import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { customerAccountLinks } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { promotionCodes } from "@/db/schema/discounts";
import {
  referralAttributions,
  referralCodes,
  referralInvitationClaims,
} from "@/db/schema/referrals";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { requireAccountActivity } from "@/features/account/backend/customer-account-activity";
import {
  CustomerAccountLinkRepository,
  customerAccountLockKey,
} from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import type { LinkedCustomerAccount } from "@/features/account/customer-account";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { generatePromotionCode } from "@/features/discounts/promotion-code";
import type { DiscountCandidate } from "@/features/discounts/provider";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  referralAdvisoryLockStatement,
  referralFirstBookingLockKey,
  referralGraphAdvisoryLockKey,
} from "./advisory-locks";
import { evaluateReferralAttribution } from "./attribution";
import { parseReferralCode, type ReferralCode } from "./client";
import {
  type ReferralAcceptance,
  type ReferralAccountSummary,
  type ReferralCodeKind,
  ReferralError,
} from "./contracts";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "./discount-identifiers";
import {
  countEligibleReferralInvitees,
  hasPreviousPaidBooking,
  hasPriorConfirmedDotyposBooking,
  type ReferralHistoryEvidence,
} from "./eligibility";
import {
  calculateReferrerDiscountAmount,
  formatReferrerDiscountPercentage,
} from "./referrer-discount";

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
  readonly resolveInvitationCandidate: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
  }) => Effect.Effect<DiscountCandidate | undefined, ReferralError>;
  readonly resolveReferrerCandidate: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
    readonly remainingSubtotal: WorkspaceMoney;
  }) => Effect.Effect<DiscountCandidate | undefined, ReferralError>;
}

const fail = (
  reason: ConstructorParameters<typeof ReferralError>[0]["reason"]
) => new ReferralError({ reason });

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

const isReservationCancelled = (input: {
  readonly dotyposStatus: string;
  readonly reservationState?: string;
}) =>
  input.dotyposStatus === "CANCELLED" ||
  input.reservationState === "cancelled" ||
  input.reservationState === "hold_expired";

export class ReferralService extends Context.Service<
  ReferralService,
  IReferralService
>()("@deskohub-workspace/referrals/ReferralService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
      const dotypos = yield* DotyposService;
      const accountResolver = yield* CustomerAccountResolver;
      const accountLinks = yield* CustomerAccountLinkRepository;

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
        (code: ReferralCode, executor: WorkspaceDatabaseClient = db) =>
          executor
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

      const loadCustomerHistory = Effect.fn(
        "ReferralService.loadCustomerHistory"
      )(
        (
          dotyposCustomerId: DotyposCustomerId,
          executor: WorkspaceDatabaseClient = db
        ) =>
          Effect.all(
            [
              executor
                .select({
                  dotyposReservationId:
                    workspaceReservations.dotyposReservationId,
                  reservationState: workspaceReservations.reservationState,
                  paymentState: workspaceReservations.paymentState,
                })
                .from(workspaceReservations)
                .where(
                  eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId)
                ),
              dotypos.listReservations({
                customerId: dotyposCustomerId,
                order: "startDateDescending",
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.map(([localReservations, dotyposReservations]) => {
              const localById = new Map(
                localReservations.flatMap((reservation) =>
                  reservation.dotyposReservationId
                    ? [[reservation.dotyposReservationId, reservation] as const]
                    : []
                )
              );
              const evidence: ReferralHistoryEvidence[] =
                dotyposReservations.map((reservation) => {
                  const local = reservation.id
                    ? localById.get(reservation.id)
                    : undefined;
                  const localPaymentState = (() => {
                    if (!local) return null;
                    if (local.paymentState === "paid") return "paid";
                    return "unpaid";
                  })();
                  return {
                    dotyposCustomerId,
                    localPaymentState,
                    dotyposStatus: reservation.status,
                    cancelled: isReservationCancelled({
                      dotyposStatus: reservation.status,
                      reservationState: local?.reservationState,
                    }),
                    endsAt: Temporal.Instant.from(reservation.endDate),
                  };
                });
              const hasLocalPaidBooking = localReservations.some(
                ({ paymentState }) => paymentState === "paid"
              );
              return {
                evidence,
                hasPreviousPaidBooking: hasPreviousPaidBooking({
                  hasLocalPaidBooking,
                  hasPriorConfirmedDotyposBooking:
                    hasPriorConfirmedDotyposBooking(evidence),
                }),
              };
            })
          )
      );

      const eligibleInviteeCount = Effect.fn(
        "ReferralService.eligibleInviteeCount"
      )((referrerDotyposCustomerId: DotyposCustomerId) =>
        db
          .select({
            invitedDotyposCustomerId:
              referralAttributions.invitedDotyposCustomerId,
          })
          .from(referralAttributions)
          .where(
            eq(
              referralAttributions.referrerDotyposCustomerId,
              referrerDotyposCustomerId
            )
          )
          .pipe(
            Effect.flatMap((invitees) =>
              Effect.forEach(
                invitees,
                ({ invitedDotyposCustomerId }) =>
                  loadCustomerHistory(invitedDotyposCustomerId),
                { concurrency: 4 }
              )
            ),
            Effect.map((histories) =>
              countEligibleReferralInvitees({
                now: Temporal.Now.instant(),
                referrals: histories.flatMap(({ evidence }) => evidence),
              })
            )
          )
      );

      const resolveInvitationCandidate = Effect.fn(
        "ReferralService.resolveInvitationCandidate"
      )(
        (input: {
          readonly dotyposCustomerId: DotyposCustomerId;
          readonly locale: Locale;
        }) =>
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
                input.dotyposCustomerId
              )
            )
            .limit(1)
            .pipe(
              Effect.flatMap(([attribution]) => {
                if (!attribution) return Effect.succeed(undefined);
                return Effect.all(
                  [
                    loadCustomerHistory(input.dotyposCustomerId),
                    db
                      .select({ state: referralInvitationClaims.state })
                      .from(referralInvitationClaims)
                      .where(
                        and(
                          eq(
                            referralInvitationClaims.invitedDotyposCustomerId,
                            input.dotyposCustomerId
                          ),
                          inArray(referralInvitationClaims.state, [
                            "reserved",
                            "redeemed",
                          ])
                        )
                      )
                      .limit(1),
                  ],
                  { concurrency: "inherit" }
                ).pipe(
                  Effect.map(([history, activeClaims]) => {
                    if (
                      history.hasPreviousPaidBooking ||
                      activeClaims.length > 0
                    ) {
                      return undefined;
                    }
                    const id = getReferralInvitationDiscountId(
                      input.dotyposCustomerId
                    );
                    return {
                      discount: {
                        id,
                        label: m.checkoutSummaryItemReferralInvitationDiscount(
                          {},
                          { locale: input.locale }
                        ),
                        adjustment: {
                          kind: "percentage" as const,
                          basisPoints: 1_500,
                        },
                      },
                      provenance: {
                        providerNamespace: "referral-invitation",
                        providerReference: attribution.promotionCodeId,
                        details: {
                          referralInvitation: {
                            invitedDotyposCustomerId: input.dotyposCustomerId,
                            referrerDotyposCustomerId:
                              attribution.referrerDotyposCustomerId,
                            promotionCodeId: attribution.promotionCodeId,
                          },
                        },
                      },
                      claim: {
                        kind: "referral_invitation" as const,
                        invitedDotyposCustomerId: input.dotyposCustomerId,
                        referrerDotyposCustomerId:
                          attribution.referrerDotyposCustomerId,
                        promotionCodeId: attribution.promotionCodeId,
                      },
                    };
                  })
                );
              }),
              Effect.mapError(() => fail("unavailable"))
            )
      );

      const resolveReferrerCandidate = Effect.fn(
        "ReferralService.resolveReferrerCandidate"
      )(
        (input: {
          readonly dotyposCustomerId: DotyposCustomerId;
          readonly locale: Locale;
          readonly remainingSubtotal: WorkspaceMoney;
        }) =>
          eligibleInviteeCount(input.dotyposCustomerId).pipe(
            Effect.map((count) => {
              if (count === 0) return undefined;
              const amount = calculateReferrerDiscountAmount({
                eligibleInviteeCount: count,
                remainingSubtotal: input.remainingSubtotal,
              });
              if (amount.value === 0) return undefined;
              return {
                discount: {
                  id: getReferralReferrerDiscountId(input.dotyposCustomerId),
                  label: m.checkoutSummaryItemReferralDiscount(
                    { count: count.toString() },
                    { locale: input.locale }
                  ),
                  adjustment: { kind: "fixed" as const, amount },
                },
                provenance: {
                  providerNamespace: "referral-referrer",
                  providerReference: input.dotyposCustomerId,
                  details: {
                    referralReferrer: {
                      referrerDotyposCustomerId: input.dotyposCustomerId,
                      eligibleInviteeCount: count,
                      discountPercentage:
                        formatReferrerDiscountPercentage(count),
                    },
                  },
                },
              };
            }),
            Effect.mapError(() => fail("unavailable"))
          )
      );

      const ensureReferralCode = Effect.fn(
        "ReferralService.ensureReferralCode"
      )((referrerDotyposCustomerId: DotyposCustomerId) =>
        db.transaction(
          Effect.fn(function* (tx) {
            const [existing] = yield* tx
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
            if (existing) {
              const code = parseReferralCode(existing.code);
              if (!code) return yield* Effect.fail(fail("unavailable"));
              return code;
            }

            for (let attempt = 0; attempt < 8; attempt += 1) {
              const candidate = generatePromotionCode();
              const referralCode = parseReferralCode(candidate);
              if (!referralCode) continue;
              const [promotion] = yield* tx
                .insert(promotionCodes)
                .values({
                  kind: "referral",
                  code: canonicalPromotionCodeSchema.make(candidate),
                  enabled: true,
                })
                .onConflictDoNothing()
                .returning({ id: promotionCodes.id });
              if (!promotion) continue;

              const [created] = yield* tx
                .insert(referralCodes)
                .values({
                  promotionCodeId: promotion.id,
                  referrerDotyposCustomerId,
                })
                .onConflictDoNothing()
                .returning({ promotionCodeId: referralCodes.promotionCodeId });
              if (created) return referralCode;

              const [raced] = yield* tx
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
              if (raced) {
                yield* tx
                  .delete(promotionCodes)
                  .where(eq(promotionCodes.id, promotion.id));
                const code = parseReferralCode(raced.code);
                if (!code) return yield* Effect.fail(fail("unavailable"));
                return code;
              }
            }

            return yield* Effect.fail(fail("unavailable"));
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

      const getAccountSummary = Effect.fn("ReferralService.getAccountSummary")(
        (input: {
          readonly customerAccountId: CustomerAccountId;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) =>
          requireCurrentIdentity(input).pipe(
            Effect.flatMap((identity) =>
              withActiveCurrentAccount(
                identity,
                Effect.all(
                  [
                    ensureReferralCode(identity.dotyposCustomerId),
                    eligibleInviteeCount(identity.dotyposCustomerId),
                  ],
                  { concurrency: "inherit" }
                ).pipe(
                  Effect.map(
                    ([code, count]): ReferralAccountSummary => ({
                      code,
                      eligibleInviteeCount: count,
                      discount: formatReferrerDiscountPercentage(count),
                    })
                  )
                )
              )
            ),
            Effect.mapError((error) =>
              error instanceof ReferralError ? error : fail("unavailable")
            )
          )
      );

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
                  if (!referralTarget)
                    return yield* Effect.fail(fail("unavailable"));

                  const [ownerLink] = yield* db
                    .select({
                      accountId: customerAccountLinks.customerAccountId,
                    })
                    .from(customerAccountLinks)
                    .where(
                      eq(
                        customerAccountLinks.dotyposCustomerId,
                        referralTarget.referrerDotyposCustomerId
                      )
                    )
                    .limit(1)
                    .pipe(Effect.mapError(() => fail("unavailable")));
                  const referrerAccountId = ownerLink
                    ? Schema.decodeUnknownSync(customerAccountIdSchema)(
                        ownerLink.accountId
                      )
                    : undefined;
                  const accountIds = [
                    identity.accountId,
                    ...(referrerAccountId ? [referrerAccountId] : []),
                  ].sort();
                  const lockKeys = [
                    referralGraphAdvisoryLockKey,
                    ...accountIds.map(customerAccountLockKey),
                    referralFirstBookingLockKey(identity.dotyposCustomerId),
                  ];

                  return yield* advisoryLock.withTransactionPermit(
                    db.transaction(
                      Effect.fn(function* (tx) {
                        for (const key of lockKeys) {
                          yield* tx.execute(referralAdvisoryLockStatement(key));
                        }

                        const [inviteeActivity] = yield* tx
                          .select({
                            deletionRequestedAt: authUser.deletionRequestedAt,
                          })
                          .from(authUser)
                          .where(eq(authUser.id, identity.accountId))
                          .limit(1)
                          .pipe(
                            Effect.mapError(() => fail("account_unavailable"))
                          );
                        if (
                          !inviteeActivity ||
                          inviteeActivity.deletionRequestedAt !== null
                        ) {
                          return yield* Effect.fail(
                            fail("account_unavailable")
                          );
                        }
                        const [currentLink] = yield* tx
                          .select({
                            dotyposCustomerId:
                              customerAccountLinks.dotyposCustomerId,
                          })
                          .from(customerAccountLinks)
                          .where(
                            eq(
                              customerAccountLinks.customerAccountId,
                              identity.accountId
                            )
                          )
                          .limit(1)
                          .pipe(
                            Effect.mapError(() => fail("account_unavailable"))
                          );
                        if (
                          currentLink?.dotyposCustomerId !==
                          identity.dotyposCustomerId
                        ) {
                          return yield* Effect.fail(
                            fail("account_unavailable")
                          );
                        }

                        const referral = yield* findReferralCode(code, tx).pipe(
                          Effect.mapError(() => fail("unavailable"))
                        );
                        const now = Temporal.Now.instant();
                        if (
                          !referral ||
                          referral.referrerDotyposCustomerId !==
                            referralTarget.referrerDotyposCustomerId ||
                          !referral.enabled ||
                          (referral.validFrom !== null &&
                            Temporal.Instant.compare(now, referral.validFrom) <
                              0) ||
                          (referral.validUntil !== null &&
                            Temporal.Instant.compare(
                              now,
                              referral.validUntil
                            ) >= 0)
                        ) {
                          return yield* Effect.fail(fail("unavailable"));
                        }

                        if (
                          identity.dotyposCustomerId ===
                          referral.referrerDotyposCustomerId
                        ) {
                          return yield* Effect.fail(fail("self_referral"));
                        }

                        const [owner] = yield* tx
                          .select({
                            accountId: customerAccountLinks.customerAccountId,
                          })
                          .from(customerAccountLinks)
                          .innerJoin(
                            authUser,
                            eq(
                              authUser.id,
                              customerAccountLinks.customerAccountId
                            )
                          )
                          .where(
                            and(
                              eq(
                                customerAccountLinks.dotyposCustomerId,
                                referral.referrerDotyposCustomerId
                              ),
                              isNull(authUser.deletionRequestedAt)
                            )
                          )
                          .limit(1)
                          .pipe(Effect.mapError(() => fail("unavailable")));
                        if (!owner || !referrerAccountId) {
                          return yield* Effect.fail(fail("unavailable"));
                        }
                        const currentReferrerAccountId =
                          Schema.decodeUnknownSync(customerAccountIdSchema)(
                            owner.accountId
                          );
                        if (currentReferrerAccountId !== referrerAccountId) {
                          return yield* Effect.fail(fail("unavailable"));
                        }

                        const [existingAttribution] = yield* tx
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
                        if (existingAttribution) {
                          return existingAttribution.referrerDotyposCustomerId ===
                            referral.referrerDotyposCustomerId
                            ? ({ kind: "already_accepted" } as const)
                            : yield* Effect.fail(fail("already_attributed"));
                        }

                        const history = yield* loadCustomerHistory(
                          identity.dotyposCustomerId,
                          tx
                        ).pipe(Effect.mapError(() => fail("unavailable")));
                        if (history.hasPreviousPaidBooking) {
                          return yield* Effect.fail(fail("ineligible"));
                        }
                        const [pendingAttempt] = yield* tx
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
                        if (pendingAttempt) {
                          return yield* Effect.fail(fail("ineligible"));
                        }

                        const existingRows = yield* tx
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
                          referrerCustomerId:
                            referral.referrerDotyposCustomerId,
                          existingReferrerByInvitee: existing,
                        });
                        if (decision.kind === "already_attributed") {
                          return yield* Effect.fail(fail("already_attributed"));
                        }
                        if (decision.kind === "cycle") {
                          return yield* Effect.fail(fail("unavailable"));
                        }

                        yield* tx
                          .insert(referralAttributions)
                          .values({
                            invitedDotyposCustomerId:
                              identity.dotyposCustomerId,
                            referrerDotyposCustomerId:
                              referral.referrerDotyposCustomerId,
                            promotionCodeId: referral.promotionCodeId,
                          })
                          .pipe(Effect.mapError(() => fail("unavailable")));
                        return { kind: "accepted" } as const;
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

      return {
        getAccountSummary,
        acceptReferral,
        lookupCodeKind,
        resolveInvitationCandidate,
        resolveReferrerCandidate,
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
