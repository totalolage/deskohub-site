import type { AlgoPin } from "@deskohub/igloohome";
import { Schema } from "effect";

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
  "expired",
  "uncertain",
  "failed",
] as const;
export type ReservationAccessGrantState =
  (typeof reservationAccessGrantStates)[number];

export const reservationAccessProvisioningStaleAfterMilliseconds = 60_000;

export const isReservationAccessProvisioningStale = (
  grant: Pick<ReservationAccessGrant, "state" | "provisioningStartedAt">,
  now = Temporal.Now.instant()
) =>
  grant.state === "provisioning" &&
  grant.provisioningStartedAt !== null &&
  Temporal.Instant.compare(
    grant.provisioningStartedAt,
    now.subtract({
      milliseconds: reservationAccessProvisioningStaleAfterMilliseconds,
    })
  ) <= 0;

/**
 * Igloohome access name for a grant's credential. Operators find a credential
 * in the Igloohome app by this name, so it stays unique per grant, and it
 * carries no reservation or customer identifier because Igloohome processes it
 * outside the EU.
 */
export const makeReservationAccessName = (grantId: ReservationAccessGrantId) =>
  `Deskohub ${grantId}`;

/**
 * The name of the grant's Igloohome credential: the stored name of its latest
 * request, or the name its first request will use. A grant without a stored
 * name was created by a deployment that predates stored names, which named its
 * credential `Deskohub <reservation-id>`.
 */
export const getReservationAccessName = (
  grant: Pick<ReservationAccessGrant, "reservationId" | "accessName">
) => grant.accessName ?? `Deskohub ${grant.reservationId}`.slice(0, 60);

export interface ReservationAccessGrant {
  readonly id: ReservationAccessGrantId;
  readonly reservationId: string;
  readonly provider: string;
  readonly credentialType: string;
  readonly deviceId: string;
  readonly state: ReservationAccessGrantState;
  readonly providerCredentialId: string | null;
  /**
   * Name sent with the latest Igloohome request, or the name the first request
   * will use. Null on grants created before names were stored.
   */
  readonly accessName: string | null;
  readonly scheduledAccessStartsAt: Temporal.Instant;
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
  readonly provisioningStartedAt: Temporal.Instant | null;
  readonly issuedAt: Temporal.Instant | null;
  readonly failedAt: Temporal.Instant | null;
  readonly failureCode: string | null;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
}

export interface IssuedReservationAccess {
  readonly grantId: ReservationAccessGrantId;
  readonly accessCode: AlgoPin;
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
}
