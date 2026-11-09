import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  MailCheck,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import {
  type CheckoutStatusKind,
  checkoutStatusKinds,
} from "@/features/checkout/checkout-status-kind";
import { type Locale, m } from "@/features/i18n";
import { getCheckoutStatusCopy } from "./checkout-status-copy";

type Message = (
  inputs: Record<string, never>,
  options: { readonly locale: Locale }
) => string;

const expectedCopy = {
  not_found: {
    title: m.checkoutStatusNotFoundTitle,
    lead: m.checkoutStatusNotFoundLead,
    tone: "unknown",
    Icon: HelpCircle,
  },
  created: {
    title: m.checkoutStatusCreatedTitle,
    lead: m.checkoutStatusCreatedLead,
    tone: "pending",
    Icon: Clock3,
  },
  pending: {
    title: m.checkoutStatusPendingTitle,
    lead: m.checkoutStatusPendingLead,
    tone: "pending",
    Icon: Clock3,
  },
  payment_pending_delayed: {
    title: m.checkoutStatusPaymentPendingDelayedTitle,
    lead: m.checkoutStatusPaymentPendingDelayedLead,
    tone: "warning",
    Icon: Clock3,
  },
  paid_waiting_fulfillment: {
    title: m.checkoutStatusPaidWaitingFulfillmentTitle,
    lead: m.checkoutStatusPaidWaitingFulfillmentLead,
    tone: "pending",
    Icon: MailCheck,
  },
  paid_fulfillment_delayed: {
    title: m.checkoutStatusPaidFulfillmentDelayedTitle,
    lead: m.checkoutStatusPaidFulfillmentDelayedLead,
    tone: "warning",
    Icon: AlertTriangle,
  },
  paid_awaiting_delivery: {
    title: m.checkoutStatusPaidAwaitingDeliveryTitle,
    lead: m.checkoutStatusPaidAwaitingDeliveryLeadWithoutEmail,
    recipientLead: m.checkoutStatusPaidAwaitingDeliveryLead,
    tone: "success",
    Icon: MailCheck,
  },
  paid_delivery_delayed: {
    title: m.checkoutStatusPaidDeliveryDelayedTitle,
    lead: m.checkoutStatusPaidDeliveryDelayedLeadWithoutEmail,
    recipientLead: m.checkoutStatusPaidDeliveryDelayedLead,
    tone: "warning",
    Icon: AlertTriangle,
  },
  fulfilled: {
    title: m.checkoutStatusFulfilledTitle,
    lead: m.checkoutStatusFulfilledLead,
    tone: "success",
    Icon: CheckCircle2,
  },
  fulfillment_failed: {
    title: m.checkoutStatusFulfillmentFailedTitle,
    lead: m.checkoutStatusFulfillmentFailedLeadWithoutEmail,
    recipientLead: m.checkoutStatusFulfillmentFailedLead,
    tone: "warning",
    Icon: AlertTriangle,
  },
  payment_failed: {
    title: m.checkoutStatusPaymentFailedTitle,
    lead: m.checkoutStatusPaymentFailedLead,
    tone: "failed",
    Icon: XCircle,
  },
  cancelled: {
    title: m.checkoutStatusCancelledTitle,
    lead: m.checkoutStatusCancelledLead,
    tone: "warning",
    Icon: XCircle,
  },
  expired: {
    title: m.checkoutStatusExpiredTitle,
    lead: m.checkoutStatusExpiredLead,
    tone: "warning",
    Icon: Clock3,
  },
  late_payment_checking: {
    title: m.checkoutStatusLatePaymentCheckingTitle,
    lead: m.checkoutStatusLatePaymentCheckingLead,
    tone: "pending",
    Icon: Clock3,
  },
  late_payment_refund: {
    title: m.checkoutStatusLatePaymentRefundTitle,
    lead: m.checkoutStatusLatePaymentRefundLead,
    tone: "warning",
    Icon: RotateCcw,
  },
  late_payment_review: {
    title: m.checkoutStatusLatePaymentReviewTitle,
    lead: m.checkoutStatusLatePaymentReviewLead,
    tone: "warning",
    Icon: AlertTriangle,
  },
} satisfies Record<
  CheckoutStatusKind,
  {
    readonly title: Message;
    readonly lead: Message;
    readonly recipientLead?: Message;
    readonly tone: string;
    readonly Icon: typeof CheckCircle2;
  }
>;

const locales = ["cs-CZ", "en-US"] as const satisfies readonly Locale[];
const reservationKinds = ["cowork", "meeting-room", "office"] as const;
const recipient = testEmailAddress("ada");

const reservationStatus = (
  status: Exclude<CheckoutStatusKind, "not_found">,
  kind: (typeof reservationKinds)[number],
  email?: string
) =>
  ({
    kind,
    orderId: "reservation-status-copy",
    returnOutcome: "success",
    status,
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    ...(email && { supportContactPrefill: { name: "Ada", email } }),
  }) as CheckoutStatusViewModel;

const reservationStatuses = checkoutStatusKinds.filter(
  (status) => status !== "not_found"
);

describe("getCheckoutStatusCopy", () => {
  test("covers every status kind", () => {
    expect(Object.keys(expectedCopy).sort()).toEqual(
      [...checkoutStatusKinds].sort()
    );
  });

  describe.each(locales)("in %s", (locale) => {
    test("presents an unknown order with its own copy", () => {
      const expected = expectedCopy.not_found;
      const copy = getCheckoutStatusCopy(
        {
          orderId: "reservation-status-copy",
          returnOutcome: "unknown",
          status: "not_found",
        } as CheckoutStatusViewModel,
        locale
      );

      expect(copy).toEqual({
        title: expected.title({}, { locale }),
        lead: expected.lead({}, { locale }),
        tone: expected.tone,
        Icon: expected.Icon,
      });
    });

    describe.each(reservationKinds)("for a %s reservation", (kind) => {
      test.each(reservationStatuses)(
        "selects the %s title, tone, and icon",
        (status) => {
          const expected = expectedCopy[status];
          for (const email of [undefined, recipient]) {
            const copy = getCheckoutStatusCopy(
              reservationStatus(status, kind, email),
              locale
            );

            expect(copy.title).toBe(expected.title({}, { locale }));
            expect(copy.tone).toBe(expected.tone);
            expect(copy.Icon).toBe(expected.Icon);
          }
        }
      );

      test.each(reservationStatuses)(
        "keeps the %s lead without a known recipient",
        (status) => {
          const expected = expectedCopy[status];

          expect(
            getCheckoutStatusCopy(reservationStatus(status, kind), locale).lead
          ).toBe(expected.lead({}, { locale }));
        }
      );

      test.each(reservationStatuses)(
        "names the known recipient only in a %s lead that promises the confirmation email",
        (status) => {
          const expected = expectedCopy[status];
          const recipientLead =
            "recipientLead" in expected ? expected.recipientLead : undefined;
          const lead = getCheckoutStatusCopy(
            reservationStatus(status, kind, recipient),
            locale
          ).lead;

          if (!recipientLead) {
            expect(lead).toBe(expected.lead({}, { locale }));
            return;
          }
          const [before, after] = recipientLead({}, { locale }).split(
            "<email/>"
          );
          expect(renderToStaticMarkup(lead)).toBe(
            renderToStaticMarkup(
              <>
                {before}
                <strong className="break-words font-semibold text-navy-blue">
                  {recipient}
                </strong>
                {after}
              </>
            )
          );
        }
      );
    });
  });

  test("falls back to the lead without a recipient for an empty address", () => {
    const lead = getCheckoutStatusCopy(
      {
        ...reservationStatus("fulfillment_failed", "cowork"),
        supportContactPrefill: { name: "Ada", email: "" },
      } as CheckoutStatusViewModel,
      "en-US"
    ).lead;

    expect(lead).toBe(
      m.checkoutStatusFulfillmentFailedLeadWithoutEmail({}, { locale: "en-US" })
    );
  });
});
