import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { makeGoodsAccountingDocumentSnapshotInputForTest } from "@/features/accounting/invoice.test-utils";
import { OrderPaymentSessionService } from "@/features/checkout/backend/payment";
import {
  GoodsOrderRepository,
  reconstructGoodsPaymentQuote,
} from "./goods-order.repository";
import { GoodsPaymentService } from "./goods-payment.service";

const fixture = makeGoodsAccountingDocumentSnapshotInputForTest();
const createdAt = Temporal.Instant.from("2026-08-11T23:30:00Z");
const lines = fixture.lines.map((line, index) => ({
  ...line,
  id: `line-${index}` as never,
  unitPriceValue: line.undiscountedTotalValue / line.quantity,
  createdAt,
}));
const application = fixture.displayedQuote.lines[0]!.discounts[0]!;
const applications = [
  {
    id: "application-1" as never,
    orderId: fixture.order.id,
    paymentAttemptId: null,
    workspaceReservationId: null,
    sequence: 0,
    publicDiscountId: application.discount.id,
    label: application.discount.label,
    adjustment: application.discount.adjustment,
    productIdentity: fixture.displayedQuote.lines[0]!.product,
    subtotalBeforeValue: application.subtotalBefore.value,
    subtotalBeforeExponent: application.subtotalBefore.exponent,
    subtotalBeforeCurrency: application.subtotalBefore.currency,
    appliedAmountValue: application.amount.value,
    appliedAmountExponent: application.amount.exponent,
    appliedAmountCurrency: application.amount.currency,
    subtotalAfterValue: application.subtotalAfter.value,
    subtotalAfterExponent: application.subtotalAfter.exponent,
    subtotalAfterCurrency: application.subtotalAfter.currency,
    expiresAt: null,
    countdownStartsAt: null,
    provenance: { kind: "customer" },
    createdAt,
  },
];

const runPayment = async (
  result:
    | { readonly status: "redirect"; readonly redirectUrl: string }
    | { readonly status: "in_progress" }
    | { readonly status: "paid" }
    | {
        readonly status: "outstanding_order";
        readonly orderId: typeof fixture.order.id;
      },
  customer = fixture.customer
) => {
  const startOrResume = mock(() => {
    if (result.status === "redirect" || result.status === "in_progress") {
      return Effect.succeed(
        result.status === "redirect"
          ? {
              ...result,
              attempt: { id: "attempt-1" } as never,
            }
          : result
      );
    }
    if (result.status === "outstanding_order") return Effect.succeed(result);
    return Effect.succeed({
      status: "paid" as const,
      attempt: { id: "attempt-1" } as never,
      changed: true,
    });
  });
  const layer = GoodsPaymentService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(GoodsOrderRepository, {
          getPaymentFacts: () =>
            Effect.succeed({
              order: fixture.order,
              lines,
              displayedQuote: fixture.displayedQuote,
            }),
        }),
        Layer.mock(DotyposService, {
          getCustomer: () => Effect.succeed(customer),
        }),
        Layer.mock(OrderPaymentSessionService, { startOrResume })
      )
    )
  );
  const actual = await Effect.gen(function* () {
    const payments = yield* GoodsPaymentService;
    return yield* payments.startOrResume({
      customerId: fixture.order.dotyposCustomerId,
      orderId: fixture.order.id,
      locale: fixture.locale,
      billing: fixture.billing,
    });
  }).pipe(Effect.provide(layer), Effect.runPromise);
  return { actual, startOrResume };
};

describe("GoodsPaymentService", () => {
  test("reconstructs the displayed discount chains from immutable order evidence", async () => {
    const quote = await reconstructGoodsPaymentQuote({
      orderId: fixture.order.id,
      lines,
      applications,
    }).pipe(Effect.runPromise);

    expect(quote).toEqual(fixture.displayedQuote);
  });

  test("rejects a stored discount chain that no longer starts at its order line", async () => {
    await expect(
      reconstructGoodsPaymentQuote({
        orderId: fixture.order.id,
        lines,
        applications: applications.map((row) => ({
          ...row,
          subtotalBeforeValue: row.subtotalBeforeValue + 1,
          subtotalAfterValue: row.subtotalAfterValue + 1,
        })),
      }).pipe(Effect.runPromise)
    ).rejects.toMatchObject({ _tag: "GoodsOrderStoredDataError" });
  });

  test("loads payment evidence without consulting mutable carts or catalogs", async () => {
    const source = await Bun.file(
      new URL("./goods-order.repository.ts", import.meta.url)
    ).text();
    const start = source.indexOf(
      "const getGoodsOrderPaymentFacts = Effect.fn("
    );
    const end = source.indexOf(
      "export const reconstructGoodsPaymentQuote",
      start
    );
    const paymentFacts = source.slice(start, end);

    expect(paymentFacts).toContain("orderLines");
    expect(paymentFacts).toContain("discountApplications");
    expect(paymentFacts).not.toContain("goodsCarts");
    expect(paymentFacts).not.toContain("goodsCartItems");
    expect(paymentFacts).not.toContain("GoodsCatalog");
  });

  test("builds the frozen snapshot and maps reusable and zero-total sessions", async () => {
    const reusable = await runPayment({
      status: "redirect",
      redirectUrl: "https://provider.example/pay",
    });
    expect(reusable.actual).toEqual({
      status: "redirect",
      redirectUrl: "https://provider.example/pay",
    });
    expect(reusable.startOrResume).toHaveBeenCalledTimes(1);
    expect(reusable.startOrResume.mock.calls[0]?.[0]).toMatchObject({
      orderId: fixture.order.id,
      amount: fixture.displayedQuote.discountedSubtotal,
      evidence: { mode: "order_evidence_committed" },
      accountingSnapshot: {
        orderId: fixture.order.id,
        lines: [
          {
            description: "Sparkling water",
            discounts: [{ amount: { value: 2500 } }],
          },
          { description: "Sandwich", discounts: [] },
        ],
      },
    });

    const paid = await runPayment({ status: "paid" });
    expect(paid.actual).toEqual({ status: "paid" });
  });

  test("requires server-side customer details before creating a session", async () => {
    const scenario = await runPayment(
      { status: "in_progress" },
      { ...fixture.customer, email: null }
    );

    expect(scenario.actual).toEqual({
      status: "billing_details_required",
    });
    expect(scenario.startOrResume).not.toHaveBeenCalled();
  });

  test("preserves the atomically selected oldest outstanding order", async () => {
    const scenario = await runPayment({
      status: "outstanding_order",
      orderId: fixture.order.id,
    });
    expect(scenario.actual).toEqual({
      status: "outstanding_order",
      orderId: fixture.order.id,
    });
  });
});
