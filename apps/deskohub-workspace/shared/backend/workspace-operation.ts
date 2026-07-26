import { Data, Effect } from "effect";

export const workspaceOperations = [
  "checkout.advertised-price.load",
  "checkout.apply-discount-code",
  "checkout.order.load-state",
  "checkout.pay.load",
  "checkout.payment-return",
  "checkout.prepare-pay-state",
  "checkout.result.refresh",
  "checkout.status.load",
  "checkout.submit-reservation",
  "cloudinaryWebhook",
  "contact.submit",
  "dotypos.tables-preview.load",
  "gallery.images.load",
  "meeting-room.page-enabled",
  "nexiWebhook",
  "resendWebhook",
  "reservationHoldCleanupCron",
  "reservationHoldCleanupSchedule",
  "telemetry.flush",
  "workspace.availability.load",
  "workspaceAvailability",
  "workspaceLocationMap.get",
] as const;

export type WorkspaceOperation = (typeof workspaceOperations)[number];

const workspaceOperationSet = new Set<string>(workspaceOperations);

export const isWorkspaceOperation = (
  value: unknown
): value is WorkspaceOperation =>
  typeof value === "string" && workspaceOperationSet.has(value);

export class InvalidWorkspaceOperation extends Data.TaggedError(
  "InvalidWorkspaceOperation"
) {}

export const resolveWorkspaceOperation = (
  value: unknown
): Effect.Effect<WorkspaceOperation, InvalidWorkspaceOperation> =>
  isWorkspaceOperation(value)
    ? Effect.succeed(value)
    : Effect.fail(new InvalidWorkspaceOperation());
