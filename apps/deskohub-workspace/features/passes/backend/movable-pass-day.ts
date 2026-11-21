import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { orders, passPurchases, workspaceReservations } from "@/db/schema";

/** Standing shared by availability and the transactional attachment fence. */
export const movablePassDay = and(
  eq(passPurchases.product, "unlimited"),
  eq(passPurchases.tier, "open-space"),
  eq(passPurchases.status, "active"),
  eq(orders.paymentState, "paid"),
  eq(workspaceReservations.paymentState, "paid"),
  eq(workspaceReservations.reservationState, "confirmed"),
  eq(workspaceReservations.fulfillmentState, "fulfilled"),
  eq(workspaceReservations.authorAccountId, passPurchases.buyerAccountId),
  gte(workspaceReservations.serviceDate, passPurchases.validFrom),
  lt(workspaceReservations.serviceDate, passPurchases.validUntil),
  or(
    isNull(passPurchases.accessEndsOn),
    lt(workspaceReservations.serviceDate, passPurchases.accessEndsOn)
  )
);
