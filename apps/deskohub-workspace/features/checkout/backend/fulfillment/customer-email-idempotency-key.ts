import { createHash } from "node:crypto";
import type { EmailDeliveryId } from "@deskohub/email";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { customerAccessEmailKind } from "./workspace-reservation-email.service";

const customerAccessRecoveryKeyPrefix = `${customerAccessEmailKind.category}-recovery-`;

/**
 * The provider idempotency key of a customer confirmation generation. The
 * first generation is keyed by the reservation and the email's category. A
 * recovery generation after a bounce is keyed by the failed send it
 * replaces, so the provider can't replay that send and retries of the same
 * recovery keep one key.
 */
export const createCustomerEmailInitialIdempotencyKey = (
  reservationId: WorkspaceReservationId
) => `${customerAccessEmailKind.category}-${reservationId}`;

export const createCustomerEmailRecoveryIdempotencyKey = (
  priorCustomerEmailDeliveryId: EmailDeliveryId
) =>
  `${customerAccessRecoveryKeyPrefix}${createHash("sha256")
    .update(priorCustomerEmailDeliveryId)
    .digest("hex")}`;
