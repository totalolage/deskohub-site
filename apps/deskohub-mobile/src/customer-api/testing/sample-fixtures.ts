import { testEmailAddress } from "@deskohub/test-email";
import {
  type AccountPasskey,
  CustomerAccountId,
  type CustomerAccountState,
  type CustomerAgentConnection,
  type CustomerMarketingPreferences,
  type CustomerOrderState,
  type CustomerProfile,
  type CustomerReservationAccess,
  type CustomerReservationHistory,
  CustomerReservationOrderId,
  type ReferralAccountOverview,
  ReferralCode,
} from "@deskohub/workspace-customer-api";

/**
 * Synthetic Workspace data for tests and the dev-only sample-data mode. Every
 * name, address, code and identifier here is made up; emails use the test
 * domain that never delivers mail. Screen clones extend these fixtures for
 * their own states.
 */

import type { SampleAccountKind } from "../sample-data-mode";

export type { SampleAccountKind };

export interface SampleOrder {
  readonly state: CustomerOrderState;
  readonly access?: CustomerReservationAccess;
  /** The issued invoice PDF; absent until issued. */
  readonly invoice?: Uint8Array;
}

export interface FakeWorkspaceData {
  readonly accountId: CustomerAccountId;
  readonly account: CustomerAccountState;
  readonly history: CustomerReservationHistory;
  readonly orders: ReadonlyMap<string, SampleOrder>;
  readonly passkeys: ReadonlyArray<AccountPasskey>;
  readonly assistants: ReadonlyArray<CustomerAgentConnection>;
  readonly marketing: CustomerMarketingPreferences;
  readonly referrals: ReferralAccountOverview;
}

export const sampleAccountId = CustomerAccountId.make("sample-account-1");
export const sampleEmail = testEmailAddress("alex.sample");

export const sampleProfile: CustomerProfile = {
  firstName: "Alex",
  lastName: "Sample",
  phone: "+420 600 000 000",
  billing: {
    kind: "business",
    companyName: "Sample Studio s.r.o.",
    companyId: "00000000",
    vatId: "CZ00000000",
    addressLine1: "Example Street 1",
    addressLine2: null,
    city: "Sampletown",
    zip: "000 00",
    country: "CZ",
  },
};

/** The code a completion-required sample customer was invited with. */
export const sampleInvitationCode = ReferralCode.make("SAMPLE-FRIEND");

export const sampleOrderIds = {
  fulfilled: CustomerReservationOrderId.make("sample-order-fulfilled"),
  pending: CustomerReservationOrderId.make("sample-order-pending"),
  awaitingFulfillment: CustomerReservationOrderId.make("sample-order-waiting"),
  past: CustomerReservationOrderId.make("sample-order-past"),
  cancelled: CustomerReservationOrderId.make("sample-order-cancelled"),
  // Status and access screen states; reachable by deep link
  // (deskohub://reservations/<id>), not listed in the history.
  upcoming: CustomerReservationOrderId.make("sample-order-upcoming"),
  accessUnavailable: CustomerReservationOrderId.make(
    "sample-order-access-unavailable"
  ),
  awaitingDelivery: CustomerReservationOrderId.make(
    "sample-order-awaiting-delivery"
  ),
  fulfillmentDelayed: CustomerReservationOrderId.make(
    "sample-order-fulfillment-delayed"
  ),
  paymentFailed: CustomerReservationOrderId.make("sample-order-payment-failed"),
  expired: CustomerReservationOrderId.make("sample-order-expired"),
  latePaymentReview: CustomerReservationOrderId.make(
    "sample-order-late-payment-review"
  ),
} as const;

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const at = (now: Date, offset: number) =>
  new Date(now.getTime() + offset).toISOString();

/** A small, valid one-page PDF that reads "Sample invoice". */
export const sampleInvoicePdf = (): Uint8Array =>
  new TextEncoder().encode(
    [
      "%PDF-1.4",
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
      "4 0 obj<</Length 44>>stream",
      "BT /F1 18 Tf 40 70 Td (Sample invoice) Tj ET",
      "endstream endobj",
      "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
      "trailer<</Root 1 0 R>>",
      "%%EOF",
      "",
    ].join("\n")
  );

const sampleHistory = (now: Date): CustomerReservationHistory => ({
  current: [
    {
      id: "sample-reservation-1",
      orderId: sampleOrderIds.fulfilled,
      product: { kind: "cowork", tier: "plus" },
      startsAt: at(now, -1 * hour),
      endsAt: at(now, 7 * hour),
      seats: 1,
      status: "confirmed",
    },
    {
      id: "sample-reservation-2",
      orderId: sampleOrderIds.pending,
      product: { kind: "meeting-room" },
      startsAt: at(now, 2 * day),
      endsAt: at(now, 2 * day + 2 * hour),
      setupStartsAt: at(now, 2 * day - 0.5 * hour),
      seats: 6,
      status: "pending",
      party: { kind: "booked-by", authorName: "Sam Example" },
    },
    {
      id: "sample-reservation-3",
      orderId: sampleOrderIds.awaitingFulfillment,
      product: { kind: "office" },
      startsAt: at(now, 5 * day),
      endsAt: at(now, 12 * day),
      seats: 3,
      status: "requires-attention",
    },
  ],
  past: [
    {
      id: "sample-reservation-4",
      orderId: sampleOrderIds.past,
      product: { kind: "cowork", tier: "basic" },
      startsAt: at(now, -10 * day),
      endsAt: at(now, -10 * day + 8 * hour),
      seats: 1,
      status: "confirmed",
      party: { kind: "booked-for", customerName: "Jordan Example" },
    },
    {
      id: "sample-reservation-5",
      orderId: sampleOrderIds.cancelled,
      product: { kind: "meeting-room" },
      startsAt: at(now, -20 * day),
      endsAt: at(now, -20 * day + 1 * hour),
      seats: 4,
      status: "cancelled",
    },
    // Booked outside the website (no order to open) and its seat count
    // couldn't be read.
    {
      id: "sample-reservation-7",
      product: { kind: "cowork", tier: "open-space" },
      startsAt: at(now, -30 * day),
      endsAt: at(now, -30 * day + 8 * hour),
      seats: null,
      status: "confirmed",
    },
  ],
  unavailable: [
    {
      id: "sample-reservation-6",
      product: { kind: "other" },
      startsAt: null,
      endsAt: null,
      seats: null,
      status: "confirmed",
    },
  ],
});

const sampleOrders = (now: Date): ReadonlyMap<string, SampleOrder> =>
  new Map<string, SampleOrder>([
    [
      sampleOrderIds.fulfilled,
      {
        state: {
          orderId: sampleOrderIds.fulfilled,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, -1 * hour),
          endsAt: at(now, 7 * hour),
          total: { value: 45000, exponent: 2, currency: "CZK" },
        },
        access: {
          code: "000000",
          accessStartsAt: at(now, -1.5 * hour),
          accessEndsAt: at(now, 7.5 * hour),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.pending,
      {
        state: {
          orderId: sampleOrderIds.pending,
          kind: "meeting-room",
          status: "pending",
          paymentStatus: "pending",
          fulfillmentStatus: "not_started",
          startsAt: at(now, 2 * day),
          endsAt: at(now, 2 * day + 2 * hour),
          setupStartsAt: at(now, 2 * day - 0.5 * hour),
          total: { value: 120000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    [
      sampleOrderIds.awaitingFulfillment,
      {
        state: {
          orderId: sampleOrderIds.awaitingFulfillment,
          kind: "office",
          status: "paid_waiting_fulfillment",
          paymentStatus: "paid",
          fulfillmentStatus: "processing",
          startsAt: at(now, 5 * day),
          endsAt: at(now, 12 * day),
          total: { value: 980000, exponent: 2, currency: "CZK" },
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.past,
      {
        state: {
          orderId: sampleOrderIds.past,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, -10 * day),
          endsAt: at(now, -10 * day + 8 * hour),
          total: { value: 30000, exponent: 2, currency: "CZK" },
        },
        access: {
          code: "111111",
          accessStartsAt: at(now, -10 * day - 0.5 * hour),
          accessEndsAt: at(now, -10 * day + 8.5 * hour),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.cancelled,
      {
        state: {
          orderId: sampleOrderIds.cancelled,
          kind: "meeting-room",
          status: "cancelled",
          paymentStatus: "cancelled",
          fulfillmentStatus: "not_started",
        },
      },
    ],
    [
      sampleOrderIds.upcoming,
      {
        state: {
          orderId: sampleOrderIds.upcoming,
          kind: "meeting-room",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, 3 * day),
          endsAt: at(now, 3 * day + 3 * hour),
          setupStartsAt: at(now, 3 * day - 0.5 * hour),
          total: { value: 180000, exponent: 2, currency: "CZK" },
        },
        access: {
          code: "222222",
          accessStartsAt: at(now, 3 * day - 0.5 * hour),
          accessEndsAt: at(now, 3 * day + 3.5 * hour),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.accessUnavailable,
      {
        state: {
          orderId: sampleOrderIds.accessUnavailable,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, 1 * day),
          endsAt: at(now, 1 * day + 8 * hour),
          total: { value: 45000, exponent: 2, currency: "CZK" },
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.awaitingDelivery,
      {
        state: {
          orderId: sampleOrderIds.awaitingDelivery,
          kind: "office",
          status: "paid_awaiting_delivery",
          paymentStatus: "paid",
          fulfillmentStatus: "awaiting_delivery",
          startsAt: at(now, 7 * day),
          endsAt: at(now, 14 * day),
          total: { value: 980000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    [
      sampleOrderIds.fulfillmentDelayed,
      {
        state: {
          orderId: sampleOrderIds.fulfillmentDelayed,
          kind: "cowork",
          status: "paid_fulfillment_delayed",
          paymentStatus: "paid",
          fulfillmentStatus: "processing",
          startsAt: at(now, 4 * day),
          endsAt: at(now, 4 * day + 8 * hour),
          total: { value: 45000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    [
      sampleOrderIds.paymentFailed,
      {
        state: {
          orderId: sampleOrderIds.paymentFailed,
          kind: "meeting-room",
          status: "payment_failed",
          paymentStatus: "failed",
          fulfillmentStatus: "not_started",
          startsAt: at(now, 6 * day),
          endsAt: at(now, 6 * day + 2 * hour),
          total: { value: 120000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    [
      sampleOrderIds.expired,
      {
        state: {
          orderId: sampleOrderIds.expired,
          kind: "cowork",
          status: "expired",
          paymentStatus: "expired",
          fulfillmentStatus: "not_started",
        },
      },
    ],
    [
      sampleOrderIds.latePaymentReview,
      {
        state: {
          orderId: sampleOrderIds.latePaymentReview,
          kind: "meeting-room",
          status: "late_payment_review",
          paymentStatus: "paid",
          fulfillmentStatus: "not_started",
          startsAt: at(now, 2 * day),
          endsAt: at(now, 2 * day + 2 * hour),
          total: { value: 120000, exponent: 2, currency: "CZK" },
        },
      },
    ],
  ]);

const samplePasskeys = (now: Date): ReadonlyArray<AccountPasskey> => [
  {
    id: "sample-passkey-1",
    name: "Sample phone",
    provider: "Google Password Manager",
    createdAt: at(now, -30 * day),
  },
  { id: "sample-passkey-2", createdAt: at(now, -3 * day) },
];

const sampleAssistants = (
  now: Date
): ReadonlyArray<CustomerAgentConnection> => [
  {
    id: "sample-consent-1",
    name: "Sample Assistant",
    host: "assistant.example.com",
    scopes: ["reservations:read", "booking:write"],
    administration: false,
    connectedAt: at(now, -7 * day),
  },
  {
    id: "sample-consent-2",
    host: "agent.example.org",
    scopes: ["reservations:read"],
    administration: true,
    connectedAt: at(now, -1 * day),
  },
];

const sampleReferrals: ReferralAccountOverview = {
  summary: {
    code: ReferralCode.make("SAMPLE-ALEX"),
    inviteeCount: 3,
    eligibleInviteeCount: 2,
    discount: "10",
    savings: [{ value: 15000, exponent: 2, currency: "CZK" }],
  },
  shareUrl: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
};

const sampleAccount = (
  kind: SampleAccountKind,
  now: Date
): CustomerAccountState => {
  const sessionSettings = {
    email: sampleEmail,
    passkeys: {
      accountId: sampleAccountId,
      passkeys: [...samplePasskeys(now)],
    },
    assistants: [...sampleAssistants(now)],
    // No saved language: the app follows the device language.
    locale: null,
  };
  switch (kind) {
    case "linked":
      return {
        kind,
        ...sessionSettings,
        deletion: "offered",
        profile: sampleProfile,
        avatar: { kind: "available", avatar: null },
        referralsEnabled: true,
        referrals: sampleReferrals,
      };
    case "completion-required":
      return {
        kind,
        ...sessionSettings,
        deletion: "offered",
        referralsEnabled: true,
        referralCode: sampleInvitationCode,
      };
    case "support-required":
    case "authenticated-unavailable":
      return { kind, ...sessionSettings, deletion: "offered" };
    case "review-account":
      return { kind, ...sessionSettings, deletion: "withheld" };
    case "deletion-pending":
      return {
        kind,
        email: sampleEmail,
        passkeys: sessionSettings.passkeys,
        locale: sessionSettings.locale,
        deletion: "pending",
      };
  }
};

// A review account's history and holds are review-sandbox samples.
const asReviewSandbox = (
  history: CustomerReservationHistory,
  orders: ReadonlyMap<string, SampleOrder>
) => ({
  history: {
    current: history.current.map((row) => ({
      ...row,
      reviewSandbox: true as const,
    })),
    past: history.past.map((row) => ({ ...row, reviewSandbox: true as const })),
    unavailable: history.unavailable,
  },
  orders: new Map(
    [...orders].map(([orderId, order]) => [
      orderId,
      { ...order, state: { ...order.state, reviewSandbox: true as const } },
    ])
  ),
});

/** A complete synthetic Workspace for one account in the given state. */
export const sampleWorkspaceData = (
  kind: SampleAccountKind,
  now: Date = new Date()
): FakeWorkspaceData => ({
  accountId: sampleAccountId,
  account: sampleAccount(kind, now),
  ...(kind === "review-account"
    ? asReviewSandbox(sampleHistory(now), sampleOrders(now))
    : { history: sampleHistory(now), orders: sampleOrders(now) }),
  passkeys: samplePasskeys(now),
  assistants: sampleAssistants(now),
  marketing: { status: "active", context: "sample-marketing-context-1" },
  referrals: sampleReferrals,
});
