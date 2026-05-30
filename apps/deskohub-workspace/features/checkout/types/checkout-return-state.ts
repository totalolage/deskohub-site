import type { ReservationInput } from "@/features/reservation/schemas/reservation";

export type CheckoutReturnStateJson = {
  readonly schema: "workspace-checkout-return-state";
  readonly schemaVersion: 1;
  readonly reservation: Omit<ReservationInput, "legalConsent">;
};
