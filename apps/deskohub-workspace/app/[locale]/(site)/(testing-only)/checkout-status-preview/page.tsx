import { testEmailAddress } from "@deskohub/test-email";
import { Option, Schema } from "effect";
import { connection } from "next/server";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

type CheckoutStatusPreviewPageProps = {
  searchParams: Promise<SearchParamsRecord>;
};

const previewStates = [
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_fulfillment_delayed",
  "paid_awaiting_delivery",
  "paid_delivery_delayed",
  "fulfillment_failed",
] as const;

const decodePreviewSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    state: Schema.optional(Schema.Literals(previewStates)),
    email: Schema.optional(Schema.Literals(["shown", "hidden"])),
  })
);

/** Renders checkout statuses that need a stored order with synthetic data. */
export default async function CheckoutStatusPreviewPage({
  searchParams,
}: CheckoutStatusPreviewPageProps) {
  await connection();
  const { state, email } = Option.getOrElse(
    decodePreviewSearchParams(await searchParams),
    () => ({ state: undefined, email: undefined })
  );

  const previewState = state ?? "paid_awaiting_delivery";
  const status: CheckoutStatusViewModel = {
    kind: "cowork",
    orderId: workspaceReservationIdSchema.make("checkout-status-preview"),
    returnOutcome: "success",
    status: previewState,
    paymentStatus:
      previewState === "pending" || previewState === "payment_pending_delayed"
        ? "pending"
        : "paid",
    fulfillmentStatus: (
      {
        pending: "not_started",
        payment_pending_delayed: "not_started",
        paid_waiting_fulfillment: "processing",
        paid_fulfillment_delayed: "processing",
        paid_awaiting_delivery: "awaiting_delivery",
        paid_delivery_delayed: "awaiting_delivery",
        fulfillment_failed: "failed",
      } as const
    )[previewState],
    supportContactPrefill: {
      name: "Ada Lovelace",
      ...(email !== "hidden" && { email: testEmailAddress("ada") }),
    },
    summary: {
      kind: "cowork",
      entryTier: "open-space",
      coffee: false,
      reservedFrom: Temporal.Instant.from("2026-08-12T22:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-08-13T15:00:00Z"),
      price: { value: 21_750, exponent: 2, currency: "CZK" },
    },
  };

  return runWithRequestLocale((locale) => (
    <CheckoutStatusPage locale={locale} status={status} />
  ));
}
