import { describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import {
  MobileShopBrowseCatalogSource,
  MobileShopCatalogPolicy,
  MobileShopCatalogSource,
} from "./backend/catalog-source.service";
import { MobileShopCustomerAccess } from "./backend/customer-access.service";
import { MobileShopPaidFulfillmentService } from "./backend/paid-fulfillment.service";
import { MobileShopPaymentService } from "./backend/payment.service";
import { MobileShopPurchaseRepository } from "./backend/purchase.repository";
import {
  mobileShopOrderSummarySchema,
  mobileShopPurchaseIdSchema,
} from "./contracts";
import {
  getCurrentMobileShopDay,
  MobileShopEntitlementService,
} from "./eligibility";
import {
  createMobileShopHistoryPage,
  MobileShopService,
} from "./mobile-shop.service";

describe("mobile shop purchase history", () => {
  test("returns a cursor when more purchases remain", () => {
    const orders = Array.from({ length: 21 }, (_, index) => ({
      id: `purchase-${String(21 - index).padStart(2, "0")}`,
      createdAt: `2026-08-${String(31 - index).padStart(2, "0")}T12:00:00Z`,
    }));

    expect(createMobileShopHistoryPage(orders, 20)).toEqual({
      orders: orders.slice(0, 20),
      nextCursor: JSON.stringify([orders[19]?.createdAt, orders[19]?.id]),
    });
  });
});

const customerId = DotyposCustomerIdSchema.make("customer-1");
const orderId = mobileShopPurchaseIdSchema.make("purchase-1");
const ownedOrder = Schema.decodeUnknownSync(mobileShopOrderSummarySchema)({
  id: orderId,
  publicReference: "DW-TEST",
  createdAt: "2026-08-11T12:00:00Z",
  paymentState: "pending",
  receiptState: "not_started",
  locale: "en-US",
  taxRegime: {
    kind: "not-vat-payer",
    version: "test",
    effectiveFrom: "2026-08-11",
  },
  total: { value: 3900, exponent: 2, currency: "CZK" },
  items: [],
});

const runPayment = (input: {
  readonly resumePayment: ReturnType<typeof mock>;
  readonly evaluate: ReturnType<typeof mock>;
}) => {
  const startPayment = mock(() => Effect.die("must not start payment"));
  const findOwned = mock(() => Effect.succeed(ownedOrder));
  const layer = MobileShopService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(MobileShopCustomerAccess, {
          resolve: mock(() =>
            Effect.succeed({
              customerLink: { kind: "linked" as const, customerId },
            })
          ),
        }),
        Layer.mock(MobileShopEntitlementService, {
          evaluate: input.evaluate,
        }),
        Layer.mock(MobileShopCatalogSource, {
          loadAll: Effect.die("catalog must not load"),
        }),
        Layer.mock(MobileShopBrowseCatalogSource, {
          loadAll: Effect.die("browse catalog must not load"),
        }),
        Layer.mock(MobileShopCatalogPolicy, {
          current: Effect.die("catalog policy must not load"),
        }),
        Layer.mock(MobileShopPurchaseRepository, { findOwned }),
        Layer.mock(MobileShopPaymentService, {
          resumePayment: input.resumePayment,
          startPayment,
          reconcilePayment: mock(() => Effect.void),
        }),
        Layer.mock(MobileShopPaidFulfillmentService, {
          fulfillPaidPurchase: mock(() => Effect.void),
        })
      )
    )
  );

  return {
    result: Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MobileShopService;
        return yield* service.payment({
          request: new Request("https://workspace.example.test/payment"),
          orderId,
        });
      }).pipe(Effect.provide(layer))
    ),
    findOwned,
    startPayment,
  };
};

describe("mobile shop payment access", () => {
  test("resumes an owned active payment after reservation access ends", async () => {
    const evaluate = mock(() => Effect.die("must not evaluate entitlement"));
    const resumePayment = mock(() =>
      Effect.succeed({
        orderId,
        hostedPageUrl: "https://payments.example.test/hosted",
      })
    );
    const harness = runPayment({ evaluate, resumePayment });

    await expect(harness.result).resolves.toEqual({
      orderId,
      hostedPageUrl: "https://payments.example.test/hosted",
    });
    expect(harness.findOwned).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();
    expect(harness.startPayment).not.toHaveBeenCalled();
  });

  test("requires current reservation access before starting a new payment", async () => {
    const evaluate = mock(() =>
      Effect.succeed({
        kind: "locked" as const,
        reason: "no_active_reservation" as const,
        day: getCurrentMobileShopDay(
          Temporal.Instant.from("2026-08-12T12:00:00Z")
        ),
      })
    );
    const resumePayment = mock(() => Effect.succeed(null));
    const harness = runPayment({ evaluate, resumePayment });

    await expect(harness.result).rejects.toMatchObject({
      code: "no_active_reservation",
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(harness.startPayment).not.toHaveBeenCalled();
  });
});
