import { expect, test } from "bun:test";
import { Effect } from "effect";
import { m } from "@/features/i18n";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { WorkspaceE2EError } from "../errors";
import {
  assertDiscountApplications,
  type DiscountApplicationRow,
  type ReferralInvitationPaymentRecord,
} from "../integrations/database";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState } from "../types";
import {
  assertReferralSomeoneElsePayment,
  getReferralSomeoneElseDiscounts,
  planReferralSomeoneElsePaymentCase,
  referralSomeoneElsePaymentCaseId,
} from "./referral-someone-else-payment";

const config: WorkspaceE2EConfig = {
  baseUrl: "https://workspace.example.test",
  bypassSecret: undefined,
  expectedHost: "workspace.example.test",
  timeouts: workspaceE2ETimeouts,
};

const invitationLabel = "Referral invitation discount";

const paidRecord = (
  overrides: Partial<ReferralInvitationPaymentRecord> = {}
): ReferralInvitationPaymentRecord => ({
  activePaymentAttemptId: "attempt-2",
  applications: [
    {
      adjustment: { basisPoints: 1500, kind: "percentage" },
      id: "application-2",
      label: invitationLabel,
      paymentAttemptId: "attempt-2",
    },
  ],
  attributions: [{ referrerDotyposCustomerId: "referrer" }],
  claims: [
    // A sandbox restart leaves the first attempt's claim released.
    {
      applicationId: "application-1",
      paymentAttemptId: "attempt-1",
      state: "released",
    },
    {
      applicationId: "application-2",
      paymentAttemptId: "attempt-2",
      state: "redeemed",
    },
  ],
  dotyposCustomerId: "booked-customer",
  paymentState: "paid",
  ...overrides,
});

const expected = {
  bookedCustomerId: "booked-customer",
  invitationLabel,
  referrerCustomerId: "referrer",
};

const discountRow = (
  row: Pick<
    DiscountApplicationRow,
    | "adjustment"
    | "applied_amount_value"
    | "label"
    | "sequence"
    | "subtotal_before_value"
  > &
    Partial<Pick<DiscountApplicationRow, "countdown_starts_at" | "expires_at">>
): DiscountApplicationRow => ({
  applied_amount_currency: "CZK",
  applied_amount_exponent: 2,
  countdown_starts_at: null,
  expires_at: null,
  redeemed_at: null,
  redemption_state: null,
  subtotal_after_currency: "CZK",
  subtotal_after_exponent: 2,
  subtotal_after_value: row.subtotal_before_value - row.applied_amount_value,
  subtotal_before_currency: "CZK",
  subtotal_before_exponent: 2,
  subtotal_before_value: row.subtotal_before_value,
  ...row,
});

test("expects the Calendar sale before the invitation on the paid order", () => {
  // CZK 290 Open Space, less the 20% E2E Calendar sale, less the 15%
  // invitation on what remains: the CZK 197.20 the booked customer pays.
  const rows = [
    discountRow({
      adjustment: { kind: "percentage", basisPoints: 2000 },
      applied_amount_value: 5_800,
      countdown_starts_at: new Date("2099-07-24T00:00:00.000Z"),
      expires_at: new Date("2099-07-25T00:00:00.000Z"),
      label: "E2E Calendar sale",
      sequence: 0,
      subtotal_before_value: 29_000,
    }),
    discountRow({
      adjustment: { kind: "percentage", basisPoints: 1500 },
      applied_amount_value: 3_480,
      label: m.checkoutSummaryItemReferralInvitationDiscount(
        {},
        { locale: "en-US" }
      ),
      sequence: 1,
      subtotal_before_value: 23_200,
    }),
  ];

  expect(() =>
    assertDiscountApplications(
      rows,
      getReferralSomeoneElseDiscounts("en-US"),
      "CZK"
    )
  ).not.toThrow();
  expect(() =>
    assertDiscountApplications(
      rows.slice(1).map((row) => ({ ...row, sequence: 0 })),
      getReferralSomeoneElseDiscounts("en-US"),
      "CZK"
    )
  ).toThrow("expected 2 discount applications");
});

test("accepts a paid order attributed to the seeded referrer", () => {
  expect(() =>
    assertReferralSomeoneElsePayment(paidRecord(), expected)
  ).not.toThrow();
});

test.each([
  [
    "the order is unpaid",
    paidRecord({ paymentState: "pending" }),
    "referral order is not paid",
  ],
  [
    "the order changed its booked customer",
    paidRecord({ dotyposCustomerId: "someone-else" }),
    "referral order changed its booked customer",
  ],
  [
    "another referrer is attributed",
    paidRecord({ attributions: [{ referrerDotyposCustomerId: "other" }] }),
    "booked customer is not attributed to the seeded referrer",
  ],
  [
    "no claim is active",
    paidRecord({
      claims: [
        {
          applicationId: "application-2",
          paymentAttemptId: "attempt-2",
          state: "released",
        },
      ],
    }),
    "booked customer needs exactly one active referral invitation claim",
  ],
  [
    "the claim is still reserved",
    paidRecord({
      claims: [
        {
          applicationId: "application-2",
          paymentAttemptId: "attempt-2",
          state: "reserved",
        },
      ],
    }),
    "referral invitation claim not redeemed",
  ],
  [
    "the claim belongs to another attempt",
    paidRecord({
      claims: [
        {
          applicationId: "application-1",
          paymentAttemptId: "attempt-1",
          state: "redeemed",
        },
      ],
    }),
    "referral invitation claim is not on the paid attempt",
  ],
  [
    "the claim's application is missing",
    paidRecord({ applications: [] }),
    "referral invitation claim has no application on the paid attempt",
  ],
  [
    "the application is not 15%",
    paidRecord({
      applications: [
        {
          adjustment: { basisPoints: 1000, kind: "percentage" },
          id: "application-2",
          label: invitationLabel,
          paymentAttemptId: "attempt-2",
        },
      ],
    }),
    "referral invitation application is not 15%",
  ],
] as const)(
  "rejects a someone-else referral payment when %s",
  (_description, record, message) => {
    expect(() => assertReferralSomeoneElsePayment(record, expected)).toThrow(
      message
    );
  }
);

test("plans the someone-else referral payment on its own date and requires binding", async () => {
  const flowStates: CheckoutFlowState[] = [
    { data: makeCoworkCheckoutData(config.baseUrl, "2099-08-01") },
    { data: makeCoworkCheckoutData(config.baseUrl, "2099-08-02") },
  ];
  const planned = await Effect.runPromise(
    planReferralSomeoneElsePaymentCase({
      allocation: {
        fromOffsetDays: 0,
        shardCount: 1,
        shardIndex: 0,
        toOffsetDays: 0,
      },
      availableBasicDates: ["2099-08-01", "2099-08-02", "2099-08-03"],
      config,
      flowStates,
    })
  );

  expect(planned.id).toBe(referralSomeoneElsePaymentCaseId);
  expect(planned.checkoutStates.map(({ data }) => data.date)).toEqual([
    "2099-08-03",
  ]);
  expect(flowStates.at(-1)).toBe(planned.checkoutStates[0]);
  // The unbound case fails with its binding error before it could reach a
  // browser.
  const error = await Effect.runPromise(
    Effect.flip(
      planned.execute({
        run: undefined as never,
        runStep: (step) => step.execute,
        session: "session",
      }) as Effect.Effect<void, unknown>
    )
  );
  expect(error).toBeInstanceOf(WorkspaceE2EError);
  expect(error).toMatchObject({
    operation: "bind someone-else referral payment case",
  });
});
