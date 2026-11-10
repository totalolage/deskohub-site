import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type CreateCustomerCheckout,
  customerReferralCodeHeader,
  type SubmitCustomerCheckout,
} from "@deskohub/workspace-customer-api";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import {
  CheckoutError,
  CheckoutService,
  openPayState,
  PayStateAuthorNotFoundError,
  PayStateIssueError,
  PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import {
  sealSyntheticPayStateToken,
  syntheticChangedKeys,
  syntheticPayStateOrderId,
} from "@/features/checkout/backend/checkout/signed-pay-state.test-utils";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
} from "@/features/discounts/errors";
import { getPaymentSubmitLegalDocuments } from "@/features/legal/payment-submit-evidence";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import {
  type CustomerApiCall,
  customerApiRequest,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";
import type { CustomerBookingCheckoutLayerSet } from "./customer-booking-checkout-layers";
import { CustomerCheckoutOperations } from "./customer-checkout-operations.service";
import { CustomerReferralUpdates } from "./customer-referral-updates";

type Operations = CustomerCheckoutOperations["Service"];
type PreparationInput = Parameters<Operations["preparePayState"]>[0];

const workspaceDateFromToday = (days: number) =>
  getCurrentWorkspaceDate().add({ days }).toString();

const readyToken = await sealSyntheticPayStateToken();
const reviewToken = await sealSyntheticPayStateToken({
  changedKeys: syntheticChangedKeys,
});

/** Sealing a fresh checkout state failed: the keys can't seal. */
const unsignablePayState = new PayStateIssueError({
  cause: new PayStateTokenError({
    code: "missing-secret",
    message: "no sealing key",
  }),
});

const openTestPayState = (token: string) =>
  openPayState(token).pipe(Effect.provide(TestSealedStateKeys));

/**
 * Checkout operations over the test key ring: tokens open, and the session's
 * account booked every order, unless `overrides` say otherwise.
 */
const operationsWith = (overrides: Partial<Operations> = {}) =>
  Layer.mock(CustomerCheckoutOperations, {
    readPayState: openTestPayState,
    requireAuthor: ({ payStateToken }) => openTestPayState(payStateToken),
    ...overrides,
  });

const emptyInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
  tables: Effect.succeed([]),
  listActiveReservationsOverlapping: () => Effect.succeed([]),
  listLimitations: () => Effect.succeed([]),
});

/** The one Dotypos table an office booking assigns. */
const officeInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
  tables: Effect.succeed([
    {
      _cloudId: "cloud",
      id: "office",
      name: "Office",
      display: true,
      enabled: true,
      seats: "8",
      tags: ["reservation:office"],
    },
  ]),
  listActiveReservationsOverlapping: () => Effect.succeed([]),
  listLimitations: () => Effect.succeed([]),
});

const checkoutWith = (
  layers: Partial<CustomerBookingCheckoutLayerSet>
): Partial<CustomerBookingCheckoutLayerSet> => ({
  inventory: emptyInventory,
  ...layers,
});

const prepared = (
  result: Effect.Success<ReturnType<Operations["preparePayState"]>>
) => Effect.succeed(result);

const readyHold = {
  status: "ready" as const,
  orderId: syntheticPayStateOrderId,
  redirectUrl: "/en-US/checkout/pay?payState=ready",
  expiresAt: "2099-07-01T10:13:00.000Z",
  payStateToken: readyToken,
};

const createBody = (
  overrides: Partial<typeof CreateCustomerCheckout.Encoded> = {}
): typeof CreateCustomerCheckout.Encoded => ({
  locale: "en-US",
  checkoutSessionId: "checkout-session-id",
  checkoutAttemptId: "checkout-attempt-id",
  advertisedPriceToken: "advertised-price-token",
  selection: {
    family: "cowork",
    tier: "open-space",
    coffee: true,
    date: workspaceDateFromToday(1),
  },
  bookingFor: "self",
  contact: {
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777000111",
  },
  billing: { purpose: "personal", invoice: "none" },
  ...overrides,
});

const createCheckout = (
  body: typeof CreateCustomerCheckout.Encoded = createBody(),
  headers?: CustomerApiCall["headers"]
): CustomerApiCall => ({
  method: "POST",
  path: "/booking/checkouts",
  body,
  ...(headers && { headers }),
});

/** Records each preparation's input, then answers `result`. */
const recordingPreparation = (
  result: Effect.Success<ReturnType<Operations["preparePayState"]>>
) => {
  const inputs: PreparationInput[] = [];
  return {
    inputs,
    preparePayState: (input: PreparationInput) =>
      Effect.sync(() => {
        inputs.push(input);
        return result;
      }),
  };
};

const expectedReadyCheckout = {
  status: "ready",
  orderId: syntheticPayStateOrderId,
  payStateToken: readyToken,
  expiresAt: expect.any(String),
  summary: expect.objectContaining({ sections: expect.any(Array) }),
  earlyPerformanceConsent: {
    required: expect.any(Boolean),
    requiredFrom: expect.any(String),
  },
};

describe("createCheckout", () => {
  testCustomerEndpointGuards(createCheckout());

  test("holds the selection for the account and answers its checkout", async () => {
    const preparation = recordingPreparation(readyHold);
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith(preparation),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedReadyCheckout);
    expect(preparation.inputs).toHaveLength(1);
    expect(preparation.inputs[0]).toMatchObject({
      locale: "en-US",
      checkoutSessionId: "checkout-session-id",
      checkoutAttemptId: "checkout-attempt-id",
      advertisedPriceToken: "advertised-price-token",
      customer: "account",
      reservation: {
        kind: "cowork",
        name: "Ada Lovelace",
        email: testEmailAddress("ada"),
        phone: "+420777000111",
        billing: { purpose: "personal", invoice: "none" },
      },
    });
    expect(preparation.inputs[0]).not.toHaveProperty("marketingConsent");
  });

  test("books someone else as the submitted contact, not as the account", async () => {
    const preparation = recordingPreparation(readyHold);
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith(preparation),
      }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(createBody({ bookingFor: "someone-else" }))
      )
    );

    expect(response.status).toBe(200);
    expect(preparation.inputs[0]).not.toHaveProperty("customer");
  });

  test("labels a marketing consent grant with the app's channel", async () => {
    const preparation = recordingPreparation(readyHold);
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith(preparation),
      }),
    });

    await api.handle(
      customerApiRequest(createCheckout(createBody({ marketingConsent: true })))
    );

    expect(preparation.inputs[0]).toMatchObject({
      marketingConsent: true,
      marketingConsentSource: "customer_app",
    });
  });

  test("answers a changed price as a price review to accept", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          preparePayState: () =>
            prepared({
              ...readyHold,
              status: "pricing_changed",
              affectedProductKeys: ["product:cowork:basic"],
              payStateToken: reviewToken,
            }),
        }),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...expectedReadyCheckout,
      status: "price_review",
      payStateToken: reviewToken,
      priceReview: { changedKeys: syntheticChangedKeys },
    });
  });

  test("reports the invited customer's referral benefit", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          preparePayState: () =>
            prepared({ ...readyHold, referralApplied: true }),
        }),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(await response.json()).toMatchObject({ referralApplied: true });
  });

  test("answers a review account's hold as payment disabled, without a checkout", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          preparePayState: () =>
            prepared({
              status: "ready",
              orderId: syntheticPayStateOrderId,
              redirectUrl: "/en-US/review/payment-disabled",
              expiresAt: "2099-07-01T10:13:00.000Z",
              reviewSandbox: true,
            }),
        }),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "payment_disabled",
      orderId: syntheticPayStateOrderId,
    });
  });

  test.each([
    ["de-DE", "0151 23456789"],
    ["uk-UA", "050 123 4567"],
    ["de-DE", "+420777000111"],
  ] as const)(
    "prepares a %s booking's contact phone %s for its own locale",
    async (locale, phone) => {
      const preparation = recordingPreparation(readyHold);
      const api = makeCustomerApiTestServer({
        bookingCheckout: checkoutWith({
          operations: operationsWith(preparation),
        }),
      });

      const response = await api.handle(
        customerApiRequest(
          createCheckout(
            createBody({
              locale,
              bookingFor: "someone-else",
              contact: {
                name: "Ada Lovelace",
                email: testEmailAddress("ada"),
                phone,
              },
            })
          )
        )
      );

      expect(response.status).toBe(200);
      expect(preparation.inputs[0]).toMatchObject({
        locale,
        reservation: { phone },
      });
    }
  );

  test("refuses a national phone of another region than the booking's locale", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({ operations: operationsWith() }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(
          createBody({
            locale: "cs-CZ",
            bookingFor: "someone-else",
            contact: {
              name: "Ada Lovelace",
              email: testEmailAddress("ada"),
              phone: "0151 23456789",
            },
          })
        )
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutDetailsInvalid",
      field: "contact.phone",
    });
  });

  test("names the contact field the booking form refuses", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({ operations: operationsWith() }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(
          createBody({
            contact: {
              name: "Ada",
              email: "not-an-email",
              phone: "+420777000111",
            },
          })
        )
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutDetailsInvalid",
      field: "contact.email",
    });
  });

  test.each([
    [
      "a conflicting submission",
      () => prepared({ status: "error", message: "conflict" }),
      409,
      { _tag: "CustomerSelectionUnavailable", reason: "checkout_conflict" },
    ],
    [
      "a table taken since the quote",
      () =>
        Effect.fail(
          new WorkspaceTableUnavailableError({
            date: "2099-08-04",
            requiredTags: [],
          })
        ),
      409,
      { _tag: "CustomerSelectionUnavailable", reason: "availability_changed" },
    ],
    [
      "an unknown Calendar discount",
      () =>
        Effect.fail(
          new DiscountAffirmationUnavailableError({
            message: "unknown discount",
            discountIds: [],
          })
        ),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a checkout state the server can't seal",
      () =>
        Effect.fail(
          new PayStateTokenError({ code: "invalid-token", message: "invalid" })
        ),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a discount provider failure",
      () =>
        Effect.fail(new DiscountProviderError({ message: "provider down" })),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, preparePayState, status, body) => {
      const api = makeCustomerApiTestServer({
        bookingCheckout: checkoutWith({
          operations: operationsWith({ preparePayState }),
        }),
      });

      const response = await api.handle(customerApiRequest(createCheckout()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("decides each release gate once for the selection, the hold and the referral it remembers", async () => {
    const evaluations = { referral: 0, office: 0 };
    const counted = (gate: keyof typeof evaluations) =>
      Effect.sync(() => {
        evaluations[gate] += 1;
        return true;
      }).pipe(Effect.cached);
    const acceptedCode = canonicalPromotionCodeSchema.make("RFLTYPED1");
    const preparingOperations = Layer.effect(
      CustomerCheckoutOperations,
      Effect.gen(function* () {
        const referral = yield* ReferralReleaseGate;
        const office = yield* OfficeReleaseGate;
        const { remembered } = yield* CustomerReferralUpdates;
        return CustomerCheckoutOperations.of({
          ...(yield* Effect.provide(
            CustomerCheckoutOperations,
            operationsWith()
          )),
          preparePayState: () =>
            Effect.all([referral.isOpen, office.isOpen, office.isOpen]).pipe(
              Effect.andThen(
                RememberedReferral.pipe(
                  Effect.flatMap((rememberedReferral) =>
                    rememberedReferral.remember(acceptedCode)
                  ),
                  Effect.provide(
                    remembered.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          ReferralServiceMock({}),
                          Layer.mock(CustomerAccountContactService, {}),
                          Layer.succeed(ReferralReleaseGate, referral)
                        )
                      )
                    )
                  ),
                  Effect.orDie
                )
              ),
              Effect.as(readyHold)
            ),
        });
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        inventory: officeInventory,
        operations: preparingOperations,
        releases: {
          referral: Layer.unwrap(
            counted("referral").pipe(
              Effect.map(ReferralReleaseGate.fromEvaluation)
            )
          ),
          office: Layer.unwrap(
            counted("office").pipe(Effect.map(OfficeReleaseGate.fromEvaluation))
          ),
        },
      }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(
          createBody({
            selection: {
              family: "office",
              seats: 2,
              date: workspaceDateFromToday(1),
            },
          })
        )
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rememberReferralCode: "RFLTYPED1",
    });
    expect(evaluations).toEqual({ referral: 1, office: 1 });
  });
});

describe("applyCheckoutDiscountCode", () => {
  const applyCode = (
    headers?: CustomerApiCall["headers"]
  ): CustomerApiCall => ({
    method: "POST",
    path: "/booking/checkouts/discount-code",
    body: { locale: "en-US", payStateToken: readyToken, code: "SPRING" },
    ...(headers && { headers }),
  });

  testCustomerEndpointGuards(applyCode());

  test("answers the checkout with the code applied", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () =>
            Effect.succeed({
              status: "applied",
              freshPayUrl: "/en-US/checkout/pay?payState=fresh",
              freshPayStateToken: readyToken,
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...expectedReadyCheckout,
      discountCode: "applied",
    });
  });

  test("tells the client to remember an accepted referral code while referrals are released", async () => {
    const acceptedCode = canonicalPromotionCodeSchema.make("RFLTYPED1");
    const accepting = (released: boolean) =>
      makeCustomerApiTestServer({
        bookingCheckout: {
          releases: {
            referral: ReferralReleaseGate.fromDecision(released),
            office: OfficeReleaseGate.fromDecision(false),
          },
          operations: Layer.effect(
            CustomerCheckoutOperations,
            Effect.gen(function* () {
              const referral = yield* ReferralReleaseGate;
              const { remembered } = yield* CustomerReferralUpdates;
              return CustomerCheckoutOperations.of({
                ...(yield* Effect.provide(
                  CustomerCheckoutOperations,
                  operationsWith()
                )),
                applyDiscountCode: () =>
                  RememberedReferral.pipe(
                    Effect.flatMap((rememberedReferral) =>
                      rememberedReferral.remember(acceptedCode)
                    ),
                    Effect.provide(
                      remembered.pipe(
                        Layer.provide(
                          Layer.mergeAll(
                            ReferralServiceMock({}),
                            Layer.mock(CustomerAccountContactService, {}),
                            Layer.succeed(ReferralReleaseGate, referral)
                          )
                        )
                      )
                    ),
                    Effect.orDie,
                    Effect.as({
                      status: "accepted" as const,
                      freshPayUrl: "/en-US/checkout/pay?payState=fresh",
                      freshPayStateToken: readyToken,
                      expiresAt: "2099-07-01T10:13:00.000Z",
                    })
                  ),
              });
            })
          ),
        },
      });

    const released = await accepting(true).handle(
      customerApiRequest(applyCode())
    );
    const withheld = await accepting(false).handle(
      customerApiRequest(applyCode())
    );

    expect(await released.json()).toMatchObject({
      discountCode: "referral_accepted",
      rememberReferralCode: "RFLTYPED1",
    });
    expect(await withheld.json()).not.toHaveProperty("rememberReferralCode");
  });

  test("answers a changed price as a review, without applying the code", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () =>
            Effect.succeed({
              status: "pricing_changed",
              freshPayUrl: "/en-US/checkout/pay?payState=review",
              freshPayStateToken: reviewToken,
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));
    const body = await response.json();

    expect(body).toMatchObject({ status: "price_review" });
    expect(body).not.toHaveProperty("discountCode");
  });

  test("rejects an unknown code with the replacement checkout it signed", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () =>
            Effect.succeed({
              status: "unavailable",
              reason: "code",
              freshPayUrl: "/en-US/checkout/pay?payState=attempted",
              freshPayStateToken: "attempted-token",
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerDiscountCodeRejected",
      reason: "unavailable",
      payStateToken: "attempted-token",
      expiresAt: "2099-07-01T10:13:00.000Z",
    });
  });

  test("rejects an ineligible code and keeps the client's checkout", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () => Effect.succeed({ status: "ineligible" }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerDiscountCodeRejected",
      reason: "ineligible",
    });
  });

  test.each([
    [
      "a referral check that can't answer",
      { status: "unavailable", reason: "provider" },
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a referral store outage, despite the replacement the referral flow signed",
      {
        status: "unavailable",
        reason: "provider",
        freshPayUrl: "/en-US/checkout/pay?payState=attempted",
        freshPayStateToken: "attempted-token",
        expiresAt: "2099-07-01T10:13:00.000Z",
      },
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "an expired hold",
      { status: "unavailable", reason: "checkout", checkoutReason: "expired" },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "expired" },
    ],
    [
      "a payment already started",
      {
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "payment_in_progress",
      },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "payment_in_progress" },
    ],
    [
      "a price review still pending",
      { status: "unavailable", reason: "price_review_pending" },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "price_review_pending" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, result, status, body) => {
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith({
            applyDiscountCode: () => Effect.succeed(result),
          }),
        },
      });

      const response = await api.handle(customerApiRequest(applyCode()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("answers a replacement checkout the server can't sign as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () => Effect.fail(unsignablePayState),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers another account's checkout as not found, before the code is checked", async () => {
    let applied = 0;
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          requireAuthor: () =>
            Effect.fail(
              new PayStateAuthorNotFoundError({
                orderId: syntheticPayStateOrderId,
              })
            ),
          applyDiscountCode: () =>
            Effect.sync(() => {
              applied += 1;
              return { status: "ineligible" as const };
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ _tag: "CustomerCheckoutNotFound" });
    expect(applied).toBe(0);
  });
});

describe("acceptCheckoutPriceChange", () => {
  const acceptPrice: CustomerApiCall = {
    method: "POST",
    path: "/booking/checkouts/price-acceptance",
    body: { locale: "en-US", payStateToken: reviewToken },
  };

  testCustomerEndpointGuards(acceptPrice);

  test("answers the checkout ready to pay at the new price", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () =>
            Effect.succeed({
              status: "accepted",
              payStateToken: readyToken,
              payUrl: "/en-US/checkout/pay?payState=accepted",
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedReadyCheckout);
  });

  test("answers an expired checkout state as expired", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () =>
            Effect.fail(
              new PayStateTokenError({ code: "expired", message: "expired" })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutUnavailable",
      reason: "expired",
    });
  });

  test("answers an accepted checkout the server can't sign as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () => Effect.fail(unsignablePayState),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers an author check the database can't answer as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          requireAuthor: () =>
            Effect.fail(
              new EffectDrizzleQueryError({
                query: "select 1",
                params: [],
                cause: Cause.die(new Error("database down")),
              })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("submitCheckout", () => {
  const currentDocuments = getPaymentSubmitLegalDocuments("en-US").map(
    ({ key, hash }) => ({ key, hash })
  );
  const submitBody = (
    overrides: Partial<typeof SubmitCustomerCheckout.Encoded> = {}
  ): typeof SubmitCustomerCheckout.Encoded => ({
    locale: "en-US",
    payStateToken: readyToken,
    legalConsent: true,
    acceptedLegalDocuments: currentDocuments,
    ...overrides,
  });
  const submit = (
    body: typeof SubmitCustomerCheckout.Encoded = submitBody(),
    headers?: CustomerApiCall["headers"]
  ): CustomerApiCall => ({
    method: "POST",
    path: "/booking/checkouts/submit",
    body,
    ...(headers && { headers }),
  });

  /** Checkout that answers `result` and records its submissions. */
  const checkoutAnswering = (
    result: () => ReturnType<
      CheckoutService["Service"]["createHostedPaymentCheckout"]
    >
  ) => {
    const submissions = {
      count: 0,
      inputs: [] as Parameters<
        CheckoutService["Service"]["createHostedPaymentCheckout"]
      >[0][],
    };
    return {
      submissions,
      layer: Layer.mock(CheckoutService, {
        createHostedPaymentCheckout: (input) =>
          Effect.suspend(() => {
            submissions.count += 1;
            submissions.inputs.push(input);
            return result();
          }),
      }),
    };
  };

  const paymentRequired = () =>
    checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: "https://payments.nexi.test/hpp/abc",
        statusUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}`,
      })
    );

  testCustomerEndpointGuards(submit());

  test("answers the payment gateway to open and the status screen it returns to", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: "https://payments.nexi.test/hpp/abc",
        statusUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}`,
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "payment_required",
      orderId: syntheticPayStateOrderId,
      paymentUrl: "https://payments.nexi.test/hpp/abc",
      statusUrl: expect.stringMatching(
        new RegExp(
          `^https?://[^/]+/en-US/reservation/status/${syntheticPayStateOrderId}$`
        )
      ),
    });
    expect(checkout.submissions.inputs).toEqual([
      expect.not.objectContaining({ returnTarget: expect.anything() }),
    ]);
  });

  test.each([
    [
      "native-app",
      `deskohub://reservations/${syntheticPayStateOrderId}?after=payment`,
    ],
    [
      "web-app",
      expect.stringMatching(
        new RegExp(
          `^https?://[^/?]+/app/reservations/${syntheticPayStateOrderId}\\?after=payment$`
        )
      ),
    ],
  ] as const)(
    "answers the %s screen a returnTarget names as the status screen",
    async (returnTarget, statusUrl) => {
      const checkout = paymentRequired();
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith(),
          checkout: checkout.layer,
        },
      });

      const response = await api.handle(
        customerApiRequest(submit(submitBody({ returnTarget })))
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "payment_required",
        orderId: syntheticPayStateOrderId,
        paymentUrl: "https://payments.nexi.test/hpp/abc",
        statusUrl,
      });
      expect(checkout.submissions.inputs).toEqual([
        expect.objectContaining({ returnTarget }),
      ]);
    }
  );

  test("answers a paid order of an app checkout with its app screen", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}?outcome=success`,
        paid: true,
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          forgetReferralIfSettled: () => Effect.void,
        }),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(
      customerApiRequest(submit(submitBody({ returnTarget: "native-app" })))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "paid",
      orderId: syntheticPayStateOrderId,
      statusUrl: `deskohub://reservations/${syntheticPayStateOrderId}?after=payment`,
    });
  });

  test("refuses a return target outside the allowlist without submitting", async () => {
    const checkout = paymentRequired();
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    for (const returnTarget of ["https://elsewhere.test/return", "app", ""]) {
      const response = await api.handle(
        customerApiRequest({
          ...submit(),
          body: { ...submitBody(), returnTarget },
        })
      );
      expect(response.status).toBe(400);
    }
    expect(checkout.submissions.count).toBe(0);
  });

  test("answers a paid order with its status screen and a used-up referral code", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}`,
        paid: true,
      })
    );
    const forgotten: unknown[] = [];
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        checkout: checkout.layer,
        operations: Layer.effect(
          CustomerCheckoutOperations,
          Effect.gen(function* () {
            const { remembered } = yield* CustomerReferralUpdates;
            return CustomerCheckoutOperations.of({
              ...(yield* Effect.provide(
                CustomerCheckoutOperations,
                operationsWith()
              )),
              forgetReferralIfSettled: (booker) =>
                RememberedReferral.pipe(
                  Effect.tap(() => Effect.sync(() => forgotten.push(booker))),
                  Effect.flatMap((referral) =>
                    referral.forgetIfSettled(booker)
                  ),
                  Effect.provide(
                    remembered.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          ReferralServiceMock({
                            hasSettledReferral: () => Effect.succeed(true),
                          }),
                          Layer.mock(CustomerAccountContactService, {
                            currentAccount: Effect.succeed({
                              status: "signed-out",
                            }),
                          }),
                          ReferralReleaseGate.fromDecision(true)
                        )
                      )
                    )
                  )
                ),
            });
          })
        ),
      },
    });

    const response = await api.handle(
      customerApiRequest(
        submit(submitBody(), { [customerReferralCodeHeader]: "RFL12345" })
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "paid",
      orderId: syntheticPayStateOrderId,
      statusUrl: expect.stringMatching(
        new RegExp(`/en-US/reservation/status/${syntheticPayStateOrderId}$`)
      ),
      rememberedReferralCodeUsed: true,
    });
    expect(forgotten).toEqual([{ kind: "order", paid: true }]);
  });

  test("answers a price changed at submission as a review", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "pricing_changed",
        changedKeys: syntheticChangedKeys,
        freshSummary: {
          sections: [],
          total: { value: 0, exponent: 2, currency: "CZK" },
        },
        freshPayUrl: "/en-US/checkout/pay?payState=review",
        freshPayStateToken: reviewToken,
        expiresAt: "2099-07-01T10:13:00.000Z",
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(await response.json()).toMatchObject({
      status: "price_review",
      payStateToken: reviewToken,
      priceReview: { changedKeys: syntheticChangedKeys },
    });
  });

  test("asks for the legal consent before submitting", async () => {
    const checkout = checkoutAnswering(() => Effect.die("not submitted"));
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(
      customerApiRequest(submit(submitBody({ legalConsent: false })))
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerConsentRequired",
      consent: "legal",
    });
    expect(checkout.submissions.count).toBe(0);
  });

  test("asks to read the legal documents again when they changed", async () => {
    const checkout = checkoutAnswering(() => Effect.die("not submitted"));
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(
      customerApiRequest(
        submit(
          submitBody({
            acceptedLegalDocuments: currentDocuments.map((document) => ({
              ...document,
              hash: "0".repeat(64),
            })),
          })
        )
      )
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerLegalDocumentsChanged",
    });
    expect(checkout.submissions.count).toBe(0);
  });

  test.each([
    [
      "a missing early-performance request",
      () =>
        Effect.fail(
          new CheckoutError({
            code: "early_performance_consent_required",
            message: "consent required",
          })
        ),
      422,
      { _tag: "CustomerConsentRequired", consent: "early_performance" },
    ],
    [
      "a booked time that has passed",
      () =>
        Effect.fail(
          new CheckoutError({
            code: "cowork_reservation_ended",
            message: "ended",
          })
        ),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "reservation_ended" },
    ],
    [
      "a cowork offer no longer sold",
      () =>
        Effect.fail(
          new CheckoutError({ code: "cowork_offer_replaced", message: "gone" })
        ),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "offer_replaced" },
    ],
    [
      "a table taken since the hold",
      () =>
        Effect.fail(
          new CheckoutError({
            code: "checkout_failed",
            message: "failed",
            cause: new WorkspaceTableUnavailableError({
              date: "2099-08-04",
              requiredTags: [],
            }),
          })
        ),
      409,
      { _tag: "CustomerSelectionUnavailable", reason: "availability_changed" },
    ],
    [
      "a checkout that failed otherwise",
      () =>
        Effect.fail(
          new CheckoutError({ code: "checkout_failed", message: "failed" })
        ),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a payment in progress or a hold no longer payable",
      () => Effect.succeed({ status: "in_progress" as const }),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "not_payable" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, result, status, body) => {
      const checkout = checkoutAnswering(result);
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith(),
          checkout: checkout.layer,
        },
      });

      const response = await api.handle(customerApiRequest(submit()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("answers a checkout service that can't be built as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: Layer.effect(CheckoutService, Effect.die("no Nexi config")),
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers another account's checkout as not found, without submitting", async () => {
    const checkout = checkoutAnswering(() => Effect.die("not submitted"));
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        checkout: checkout.layer,
        operations: operationsWith({
          requireAuthor: () =>
            Effect.fail(
              new PayStateAuthorNotFoundError({
                orderId: syntheticPayStateOrderId,
              })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(response.status).toBe(404);
    expect(checkout.submissions.count).toBe(0);
  });
});
