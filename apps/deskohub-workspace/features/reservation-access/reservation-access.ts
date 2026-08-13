import type {
  AlgoPin,
  IgloohomeDeviceId,
  IgloohomePinId,
} from "@deskohub/igloohome";
import { Schema } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export const reservationAccessGrantIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("ReservationAccessGrantId")
).annotate({
  identifier: "ReservationAccessGrantId",
  description: "Opaque identifier for a reservation access issuance ledger.",
});
export type ReservationAccessGrantId =
  typeof reservationAccessGrantIdSchema.Type;

export const reservationAccessGrantStates = [
  "pending",
  "provisioning",
  "issued",
  "uncertain",
  "failed",
] as const;
export type ReservationAccessGrantState =
  (typeof reservationAccessGrantStates)[number];

export interface ReservationAccessGrant {
  readonly id: ReservationAccessGrantId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly deviceId: IgloohomeDeviceId;
  readonly state: ReservationAccessGrantState;
  readonly providerCredentialId: IgloohomePinId | null;
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
  readonly provisioningStartedAt: Temporal.Instant | null;
  readonly issuedAt: Temporal.Instant | null;
  readonly failedAt: Temporal.Instant | null;
  readonly failureCode: string | null;
  readonly updatedAt: Temporal.Instant;
}

export interface IssuedReservationAccess {
  readonly grantId: ReservationAccessGrantId;
  readonly accessCode: AlgoPin;
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
}
