import type { Customer } from "@deskohub/dotypos/generated/types.gen";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { WorkspaceReservation } from "@/db/schema/workspace-reservations";
import { createWorkspaceReservationCustomerEmailPreviewHtml } from "@/features/checkout/backend/workspace-reservation-email.service";
import { isLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export const metadata: Metadata = {
  title: "Workspace reservation email preview",
  robots: {
    index: false,
    follow: false,
  },
};

type WorkspaceReservationEmailPreviewPageProps = {
  params: Promise<{ locale: string }>;
};

const mockDate = new Date("2026-06-12T09:00:00.000+02:00");

const createMockReservation = (locale: string): WorkspaceReservation => ({
  id: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
  reservationIntentKey: "preview-reservation-intent",
  correlationId: "preview-correlation-id",
  dotyposCustomerId: "987654321",
  dotyposReservationId: "123456789",
  customerAccessCode: "4829",
  reservationState: "confirmed",
  paymentState: "paid",
  fulfillmentState: "fulfilled",
  activePaymentAttemptId: "preview-payment-attempt",
  productTier: "profi",
  productCoffee: true,
  productMonitorOption: "2x27-qhd",
  locale,
  reservationHoldExpiresAt: null,
  reservationHoldExpiredAt: null,
  reservationCreatedAt: mockDate,
  reservationConfirmedAt: mockDate,
  reservationCancelledAt: null,
  paidAt: mockDate,
  fulfilledAt: mockDate,
  fulfillmentFailedAt: null,
  failureCode: null,
  fulfillmentFailureCode: null,
  createdAt: mockDate,
  updatedAt: mockDate,
});

const mockCustomer: Customer = {
  id: "987654321",
  _cloudId: "preview-cloud",
  firstName: "Jana",
  lastName: "Novakova",
  companyName: null,
  email: "jana.novakova@example.com",
  phone: "+420 777 123 456",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

export default async function WorkspaceReservationEmailPreviewPage({
  params,
}: WorkspaceReservationEmailPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const html = await runWithRequestLocale(locale, () =>
    createWorkspaceReservationCustomerEmailPreviewHtml({
      reservation: createMockReservation(locale),
      customer: mockCustomer,
      tableName: "12",
    })
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white/76 p-4 shadow-2xl shadow-navy-blue/12 ring-1 ring-navy-blue/8">
        <div className="mb-4 rounded-2xl bg-navy-blue px-5 py-4 text-white">
          <p className="font-semibold text-sm uppercase tracking-[0.18em]">
            Temporary email preview
          </p>
          <p className="mt-1 text-white/80 text-sm">
            This page renders the real customer reservation email with mock
            data.
          </p>
        </div>
        <iframe
          className="h-[920px] w-full rounded-2xl bg-white"
          sandbox=""
          srcDoc={html}
          title="Workspace reservation email preview"
        />
      </div>
    </main>
  );
}
