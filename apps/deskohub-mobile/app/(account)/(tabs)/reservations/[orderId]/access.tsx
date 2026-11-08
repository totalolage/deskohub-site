import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useLocalSearchParams } from "expo-router";
import { ReservationAccessScreen } from "../../../../../src/account/reservations/access-screen";

export default function ReservationAccessRoute() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return (
    <ReservationAccessScreen
      orderId={CustomerReservationOrderId.make(orderId)}
    />
  );
}
