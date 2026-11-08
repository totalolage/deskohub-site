import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useLocalSearchParams } from "expo-router";
import { OrderStatusScreen } from "../../../../../src/account/reservations/order-status-screen";
import { statusVisitOf } from "../../../../../src/account/reservations/status-refresh-rules";

export default function ReservationStatusRoute() {
  // Only `after` matters; other params (such as a preview's bypass) are ignored.
  const { orderId, after } = useLocalSearchParams<{
    orderId: string;
    after?: string;
  }>();
  return (
    <OrderStatusScreen
      key={orderId}
      orderId={CustomerReservationOrderId.make(orderId)}
      visit={statusVisitOf(after)}
    />
  );
}
