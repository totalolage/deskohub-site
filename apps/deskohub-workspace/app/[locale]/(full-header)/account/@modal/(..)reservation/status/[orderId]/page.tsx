import { CheckoutStatusRoute } from "@/features/checkout/components/checkout-status-route";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationDetailsModal } from "@/features/reservation/components/reservation-details-modal";

type ReservationStatusModalPageProps = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export default function ReservationStatusModalPage({
  params,
}: ReservationStatusModalPageProps) {
  return runWithRequestLocale((locale) => (
    <ReservationDetailsModal locale={locale}>
      <CheckoutStatusRoute
        params={params}
        searchParams={Promise.resolve({})}
        presentation="modal"
      />
    </ReservationDetailsModal>
  ));
}
