import LocalizedCheckoutStatusPage from "@/app/[locale]/(minimal-header)/reservation/status/[orderId]/page";
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
      <LocalizedCheckoutStatusPage
        params={params}
        searchParams={Promise.resolve({})}
      />
    </ReservationDetailsModal>
  ));
}
