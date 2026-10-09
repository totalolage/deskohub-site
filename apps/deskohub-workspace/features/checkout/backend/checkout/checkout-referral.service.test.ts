import "@/shared/polyfills/temporal";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuote,
} from "@/features/checkout/reservation-quote-cowork";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import {
  buildOfficeReservationQuote,
  type OfficeReservationQuote,
} from "@/features/checkout/reservation-quote-office";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import type {
  AppliedDiscount,
  DiscountQuote,
} from "@/features/discounts/contracts";
import { discountIdSchema } from "@/features/discounts/contracts";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { ReferralService } from "@/features/referrals";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "@/features/referrals/discount-identifiers";
import { calculateReferrerDiscountAmount } from "@/features/referrals/referrer-discount";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { type Instant, instantStringSchema } from "@/shared/utils/temporal";
import {
  CheckoutPricingService,
  type PaymentPriceAffirmation,
  type PaymentPriceAffirmationInput,
} from "./checkout-pricing.service";
import {
  type CheckoutReferralResult,
  CheckoutReferralService,
} from "./checkout-referral.service";
import { PayableReservationService } from "./payable-reservation.service";

mock.module("server-only", () => ({}));

const {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
  getSignedPayStateCheckoutSummary,
} = await import("./pay-state");

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const customerAccountId = customerAccountIdSchema.make(
  "checkout-referral-service-test-account"
);
const dotyposCustomerId = dotyposCustomerIdSchema.make(
  "checkout-referral-service-test-customer"
);
const coworkProduct: WorkspaceProductIdentity = {
  kind: "cowork",
  tier: "reserved-desk",
};
const referrerDotyposCustomerId = dotyposCustomerIdSchema.make(
  "checkout-referral-service-test-referrer"
);
const promotionCodeId = promotionCodeIdSchema.make(
  "checkout-referral-service-test-code"
);
const invitationDiscountId = getReferralInvitationDiscountId(dotyposCustomerId);
const referrerDiscountId = getReferralReferrerDiscountId(dotyposCustomerId);
const ordinaryDiscountId = discountIdSchema.make(
  "checkout-referral-service-test-ordinary-code"
);
const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");

const reservation = Schema.decodeUnknownSync(
  normalizedCoworkReservationOrderSchema
)({
  kind: "cowork",
  entryTier: "reserved-desk",
  date: "2099-06-20",
  coffee: true,
  monitorOption: "2x27-qhd",
  name: "Referral Checkout Test",
  email: "referral-checkout-test@example.test",
  phone: "+420 777 000 000",
});

const meetingRoomReservation = normalizedMeetingRoomReservationOrderSchema.make(
  {
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-06-20",
    startsAt: "2099-06-20T08:00:00Z",
    endsAt: "2099-06-20T12:00:00Z",
    name: "Referral Checkout Test",
    email: "referral-checkout-test@example.test",
    phone: "+420 777 000 000",
  }
);

const officeReservation = normalizedOfficeReservationOrderSchema.make({
  kind: "office",
  startsOn: "2099-06-20",
  endsOn: "2099-06-20",
  seats: 3,
  name: "Referral Checkout Test",
  email: "referral-checkout-test@example.test",
  phone: "+420 777 000 000",
});

const buildMeetingRoomQuote = (
  reservation: typeof meetingRoomReservation,
  discountQuote?: DiscountQuote
) =>
  Effect.gen(function* () {
    const quote = yield* getMeetingRoomReservationQuote(
      reservation,
      discountQuote === undefined ? {} : { discountQuote }
    );
    return {
      ...quote,
      fingerprint: getReservationQuoteFingerprint(reservation, quote),
    };
  });

const makeDiscountQuote = (
  product: WorkspaceProductIdentity,
  baseSubtotal: ReturnType<typeof money>,
  discounts: readonly AppliedDiscount[]
): DiscountQuote => {
  const totalDiscount = discounts.reduce(
    (value, discount) => value + discount.amount.value,
    0
  );
  return {
    product,
    discountableSubtotal: baseSubtotal,
    discounts,
    totalDiscount: money(totalDiscount),
    discountedSubtotal: money(baseSubtotal.value - totalDiscount),
  };
};

const makeInvitation = (subtotalBefore: ReturnType<typeof money>) => {
  const amount = Number(
    (BigInt(subtotalBefore.value) * 1_500n + 5_000n) / 10_000n
  );
  return {
    discount: {
      id: invitationDiscountId,
      label: "Invitation discount 15%",
      adjustment: { kind: "percentage" as const, basisPoints: 1_500 },
    },
    subtotalBefore,
    amount: money(amount),
    subtotalAfter: money(subtotalBefore.value - amount),
  } satisfies AppliedDiscount;
};

const makeReferrer = (subtotalBefore: ReturnType<typeof money>) => {
  const amount = calculateReferrerDiscountAmount({
    eligibleInviteeCount: 1,
    remainingSubtotal: subtotalBefore,
  });
  return {
    discount: {
      id: referrerDiscountId,
      label: "Referral discount (1 eligible people)",
      adjustment: { kind: "fixed" as const, amount },
    },
    subtotalBefore,
    amount,
    subtotalAfter: money(subtotalBefore.value - amount.value),
  } satisfies AppliedDiscount;
};

const makeOrdinaryDiscount = (input: {
  readonly subtotalBefore: ReturnType<typeof money>;
  readonly amount: number;
}): AppliedDiscount => ({
  discount: {
    id: ordinaryDiscountId,
    label: "SUMMER10",
    adjustment: { kind: "fixed", amount: money(input.amount) },
  },
  subtotalBefore: input.subtotalBefore,
  amount: money(input.amount),
  subtotalAfter: money(input.subtotalBefore.value - input.amount),
});

const getCandidate = (application: AppliedDiscount): DiscountCandidate => {
  if (application.discount.id === invitationDiscountId) {
    return {
      discount: application.discount,
      provenance: {
        providerNamespace: "referral-invitation",
        providerReference: promotionCodeId,
        details: {
          referralInvitation: {
            invitedDotyposCustomerId: dotyposCustomerId,
            referrerDotyposCustomerId,
            promotionCodeId,
          },
        },
      },
    };
  }
  if (application.discount.id === referrerDiscountId) {
    return {
      discount: application.discount,
      provenance: {
        providerNamespace: "referral-referrer",
        providerReference: dotyposCustomerId,
        details: {
          referralReferrer: {
            referrerDotyposCustomerId: dotyposCustomerId,
            eligibleInviteeCount: 1,
            discountPercentage: "5",
          },
        },
      },
    };
  }
  return {
    discount: application.discount,
    provenance: {
      providerNamespace: "discount-code",
      providerReference: "ordinary-code-id",
    },
  };
};

const makeCommitment = (
  product: WorkspaceProductIdentity,
  applications: readonly AppliedDiscount[]
) =>
  makeDiscountCommitment({
    product,
    applications: applications.map((application) => ({
      application,
      candidate: getCandidate(application),
    })),
  });

type TestPayStateInput = {
  readonly bookedAt: Instant;
} & (
  | {
      readonly reservation: typeof reservation;
      readonly quote: CoworkReservationQuote;
    }
  | {
      readonly reservation: typeof meetingRoomReservation;
      readonly quote: MeetingRoomReservationQuote;
    }
  | {
      readonly reservation: typeof officeReservation;
      readonly quote: OfficeReservationQuote;
    }
);

const tokenFor = (input: TestPayStateInput) =>
  Effect.runSync(
    Effect.gen(function* () {
      const state = yield* buildSignedPayState({
        locale: "en-US",
        ...input,
        orderId: workspaceReservationIdSchema.make(
          "checkout-referral-service-test-reservation"
        ),
        checkoutSessionId: "checkout-referral-service-test-session",
        ttlMilliseconds: 10 * 60 * 1000,
      });
      return yield* sealPayState(state);
    })
  );

const tokenForOrder = (input: TestPayStateInput, orderId: string) =>
  Effect.runSync(
    Effect.gen(function* () {
      const state = yield* buildSignedPayState({
        locale: "en-US",
        ...input,
        orderId: workspaceReservationIdSchema.make(orderId),
        checkoutSessionId: "checkout-referral-service-test-session",
        ttlMilliseconds: 10 * 60 * 1000,
      });
      return yield* sealPayState(state);
    })
  );

const makeServiceLayer = (input: {
  readonly affirmation: PaymentPriceAffirmation;
  readonly acceptReferral: () => Effect.Effect<{
    readonly kind: "accepted" | "already_accepted";
  }>;
  readonly payableReservationCustomerId?: typeof dotyposCustomerId;
  readonly onPricingAffirmation?: (input: PaymentPriceAffirmationInput) => void;
}) => {
  const dependencies = Layer.mergeAll(
    Layer.succeed(CustomerAccountResolver, {
      resolve: Effect.succeed({
        accountId: customerAccountId,
        dotyposCustomerId,
      }),
    }),
    Layer.mock(ReferralService, {
      lookupCodeKind: () => Effect.succeed({ kind: "referral" as const }),
      acceptReferral: input.acceptReferral,
    }),
    Layer.mock(CheckoutPricingService, {
      affirmForPayment: (affirmationInput) =>
        Effect.sync(() => {
          input.onPricingAffirmation?.(affirmationInput);
          return input.affirmation;
        }),
    }),
    Layer.mock(PayableReservationService, {
      requireCurrent: () =>
        Effect.succeed({
          dotyposCustomerId:
            input.payableReservationCustomerId ?? dotyposCustomerId,
        } as WorkspaceReservation),
    })
  );
  return CheckoutReferralService.Default.pipe(Layer.provide(dependencies));
};

const runAcceptCode = (
  layer: ReturnType<typeof makeServiceLayer>,
  payStateToken: string
) =>
  Effect.gen(function* () {
    const service = yield* CheckoutReferralService;
    return yield* service.acceptCode({
      code: "RFL12345",
      payStateToken,
      locale: "en-US",
    });
  }).pipe(Effect.provide(layer));

const expectAcceptedThenIdempotentRetry = async (input: {
  readonly payStateToken: string;
  readonly affirmation: PaymentPriceAffirmation;
  readonly family: "cowork" | "meeting-room" | "office";
}) => {
  let acceptanceCount = 0;
  const affirmationInputs: PaymentPriceAffirmationInput[] = [];
  const layer = makeServiceLayer({
    affirmation: input.affirmation,
    onPricingAffirmation: (affirmationInput) =>
      affirmationInputs.push(affirmationInput),
    acceptReferral: () =>
      Effect.sync(() => {
        acceptanceCount += 1;
        return {
          kind:
            acceptanceCount === 1
              ? ("accepted" as const)
              : ("already_accepted" as const),
        };
      }),
  });

  const checkFreshUrl = async (
    result: CheckoutReferralResult,
    expectedStatus: "accepted" | "already_accepted"
  ) => {
    expect(result.status).toBe(expectedStatus);
    if (!result.freshPayUrl) throw new Error("Expected refreshed Pay URL");
    const token = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    if (!token) throw new Error("Expected refreshed Pay-state token");
    const state = Effect.runSync(openPayState(token));
    expect(state.changedKeys).toBeUndefined();
    expect(state.submittedCode).toBeUndefined();
    expect(state.reservation.kind).toBe(input.family);
    expect(state.bookedAt).toBe(payStateBookedAt);
    expect(getSignedPayStateCheckoutSummary(state).total).toEqual(
      input.affirmation.quote.payment.expectedPrice
    );
    expect(
      state.quote.payment.discounts.some(
        ({ discount }) => discount.id === invitationDiscountId
      )
    ).toBe(true);
  };

  const firstResult = await Effect.runPromise(
    runAcceptCode(layer, input.payStateToken)
  );
  expect(affirmationInputs[0]?.bookedAt).toEqual(
    Temporal.Instant.from(payStateBookedAt)
  );
  await checkFreshUrl(firstResult, "accepted");

  const retryResult = await Effect.runPromise(
    runAcceptCode(layer, input.payStateToken)
  );
  expect(affirmationInputs[1]?.bookedAt).toEqual(
    Temporal.Instant.from(payStateBookedAt)
  );
  await checkFreshUrl(retryResult, "already_accepted");
  expect(affirmationInputs).toHaveLength(2);
  expect(acceptanceCount).toBe(2);
};

describe("CheckoutReferralService", () => {
  test("accepts then idempotently retries an old token with a fresh invitation quote", async () => {
    const undiscountedQuote = Effect.runSync(
      buildCoworkReservationQuote(reservation)
    );
    const productSubtotal = undiscountedQuote.items[0]!.amount;
    const previousReferrer = makeReferrer(productSubtotal);
    const previousQuote = Effect.runSync(
      buildCoworkReservationQuote(reservation, {
        discountQuote: makeDiscountQuote(coworkProduct, productSubtotal, [
          previousReferrer,
        ]),
      })
    );
    const invitation = makeInvitation(productSubtotal);
    const currentReferrer = makeReferrer(invitation.subtotalAfter);
    const freshApplications = [invitation, currentReferrer] as const;
    const freshQuote = Effect.runSync(
      buildCoworkReservationQuote(reservation, {
        discountQuote: makeDiscountQuote(
          coworkProduct,
          productSubtotal,
          freshApplications
        ),
      })
    );
    await expectAcceptedThenIdempotentRetry({
      payStateToken: tokenFor({
        reservation,
        quote: previousQuote,
        bookedAt: payStateBookedAt,
      }),
      affirmation: {
        kind: "cowork",
        reservation,
        quote: freshQuote,
        commitment: makeCommitment(coworkProduct, freshApplications),
      },
      family: "cowork",
    });
  });

  test("puts the validated signed order ID on the fresh Pay path", async () => {
    const quote = Effect.runSync(buildCoworkReservationQuote(reservation));
    const signedOrderId = `signed-referral-order-${crypto.randomUUID()}`;
    const layer = makeServiceLayer({
      affirmation: {
        kind: "cowork",
        reservation,
        quote,
        commitment: makeCommitment(coworkProduct, []),
      },
      acceptReferral: () => Effect.succeed({ kind: "accepted" as const }),
    });
    const payStateToken = tokenForOrder(
      { reservation, quote, bookedAt: payStateBookedAt },
      signedOrderId
    );
    const originalState = Effect.runSync(openPayState(payStateToken));
    const result = await Effect.runPromise(runAcceptCode(layer, payStateToken));

    expect(result.status).toBe("accepted");
    if (!result.freshPayUrl) throw new Error("Expected refreshed Pay URL");
    const freshUrl = new URL(result.freshPayUrl, "https://deskohub.test");
    expect(freshUrl.searchParams.get("orderId")).toBe(originalState.orderId);
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    if (!freshToken) throw new Error("Expected fresh signed Pay state");
    const freshState = Effect.runSync(openPayState(freshToken));
    expect(freshState.orderId).toBe(originalState.orderId);
    expect(freshState.changedKeys).toBeUndefined();
    expect(freshState.reservation.kind).toBe("cowork");
    expect(freshUrl.searchParams.has("referralApplied")).toBe(false);
  });

  test("accepts and retries referral pricing from a meeting-room signed state", async () => {
    const product: WorkspaceProductIdentity = {
      kind: "meeting-room",
      duration: meetingRoomReservation.duration,
    };
    const undiscountedQuote = Effect.runSync(
      buildMeetingRoomQuote(meetingRoomReservation)
    );
    const productSubtotal = undiscountedQuote.items[0]!.amount;
    const previousReferrer = makeReferrer(productSubtotal);
    const previousQuote = Effect.runSync(
      buildMeetingRoomQuote(
        meetingRoomReservation,
        makeDiscountQuote(product, productSubtotal, [previousReferrer])
      )
    );
    const invitation = makeInvitation(productSubtotal);
    const currentReferrer = makeReferrer(invitation.subtotalAfter);
    const freshApplications = [invitation, currentReferrer] as const;
    const freshQuote = Effect.runSync(
      buildMeetingRoomQuote(
        meetingRoomReservation,
        makeDiscountQuote(product, productSubtotal, freshApplications)
      )
    );

    await expectAcceptedThenIdempotentRetry({
      payStateToken: tokenFor({
        reservation: meetingRoomReservation,
        quote: previousQuote,
        bookedAt: payStateBookedAt,
      }),
      affirmation: {
        kind: "meeting-room",
        reservation: meetingRoomReservation,
        quote: freshQuote,
        commitment: makeCommitment(product, freshApplications),
      },
      family: "meeting-room",
    });
  });

  test("accepts and retries referral pricing from an office signed state", async () => {
    const undiscountedQuote = Effect.runSync(
      buildOfficeReservationQuote(officeReservation)
    );
    const productSubtotal = undiscountedQuote.items[0]!.amount;
    const product: WorkspaceProductIdentity = {
      kind: "office",
      dayCount: undiscountedQuote.items[0]!.dayCount,
      seats: undiscountedQuote.items[0]!.seats,
    };
    const previousReferrer = makeReferrer(productSubtotal);
    const previousQuote = Effect.runSync(
      buildOfficeReservationQuote(officeReservation, {
        discountQuote: makeDiscountQuote(product, productSubtotal, [
          previousReferrer,
        ]),
      })
    );
    const invitation = makeInvitation(productSubtotal);
    const currentReferrer = makeReferrer(invitation.subtotalAfter);
    const freshApplications = [invitation, currentReferrer] as const;
    const freshQuote = Effect.runSync(
      buildOfficeReservationQuote(officeReservation, {
        discountQuote: makeDiscountQuote(
          product,
          productSubtotal,
          freshApplications
        ),
      })
    );

    await expectAcceptedThenIdempotentRetry({
      payStateToken: tokenFor({
        reservation: officeReservation,
        quote: previousQuote,
        bookedAt: payStateBookedAt,
      }),
      affirmation: {
        kind: "office",
        reservation: officeReservation,
        quote: freshQuote,
        commitment: makeCommitment(product, freshApplications),
      },
      family: "office",
    });
  });

  test("keeps pricing_changed when an ordinary discount changes during acceptance", async () => {
    const undiscountedQuote = Effect.runSync(
      buildCoworkReservationQuote(reservation)
    );
    const productSubtotal = undiscountedQuote.items[0]!.amount;
    const previousCode = makeOrdinaryDiscount({
      subtotalBefore: productSubtotal,
      amount: 1_000,
    });
    const previousReferrer = makeReferrer(previousCode.subtotalAfter);
    const previousQuote = Effect.runSync(
      buildCoworkReservationQuote(reservation, {
        discountQuote: makeDiscountQuote(coworkProduct, productSubtotal, [
          previousCode,
          previousReferrer,
        ]),
      })
    );

    const currentCode = makeOrdinaryDiscount({
      subtotalBefore: productSubtotal,
      amount: 1_200,
    });
    const invitation = makeInvitation(currentCode.subtotalAfter);
    const currentReferrer = makeReferrer(invitation.subtotalAfter);
    const freshApplications = [
      currentCode,
      invitation,
      currentReferrer,
    ] as const;
    const freshQuote = Effect.runSync(
      buildCoworkReservationQuote(reservation, {
        discountQuote: makeDiscountQuote(
          coworkProduct,
          productSubtotal,
          freshApplications
        ),
      })
    );
    const layer = makeServiceLayer({
      affirmation: {
        kind: "cowork",
        reservation,
        quote: freshQuote,
        commitment: makeCommitment(coworkProduct, freshApplications),
      },
      acceptReferral: () => Effect.succeed({ kind: "accepted" as const }),
    });

    const result = await Effect.runPromise(
      runAcceptCode(
        layer,
        tokenFor({
          reservation,
          quote: previousQuote,
          bookedAt: payStateBookedAt,
        })
      )
    );
    expect(result.status).toBe("pricing_changed");
    expect("freshPayUrl" in result && result.freshPayUrl).toBeTruthy();
  });

  test("rejects a verified account when the payable reservation belongs to another customer", async () => {
    const quote = Effect.runSync(buildCoworkReservationQuote(reservation));
    let acceptanceCount = 0;
    let pricingAffirmationCount = 0;
    const layer = makeServiceLayer({
      affirmation: {
        kind: "cowork",
        reservation,
        quote,
        commitment: makeCommitment(coworkProduct, []),
      },
      payableReservationCustomerId: referrerDotyposCustomerId,
      acceptReferral: () =>
        Effect.sync(() => {
          acceptanceCount += 1;
          return { kind: "accepted" as const };
        }),
      onPricingAffirmation: () => {
        pricingAffirmationCount += 1;
      },
    });

    const result = await Effect.runPromise(
      runAcceptCode(
        layer,
        tokenFor({ reservation, quote, bookedAt: payStateBookedAt })
      )
    );
    expect(result.status).toBe("unavailable");
    expect(acceptanceCount).toBe(0);
    expect(pricingAffirmationCount).toBe(0);
  });
});
