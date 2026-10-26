import { m } from "@/features/i18n";
import { ReservationAccessRoute } from "@/features/reservation/components/reservation-access-route";
import { privateOrderPage } from "@/features/reservation/private-order-page.server";

export const maxDuration = 30;
export const instant = true;

type LocalizedReservationAccessPageProps = {
  params: Promise<{ orderId: string }>;
};

const { generateMetadata } = privateOrderPage({
  title: m.reservationAccessMetadataTitle,
  description: m.reservationAccessMetadataDescription,
});

export { generateMetadata };

export default function LocalizedReservationAccessPage({
  params,
}: LocalizedReservationAccessPageProps) {
  return <ReservationAccessRoute params={params} />;
}
