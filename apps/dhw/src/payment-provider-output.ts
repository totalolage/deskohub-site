import type {
  AdministrationOperationType,
  AdministrationOrderType,
} from "@deskohub/workspace-admin-api";

/**
 * Heads a provider listing: how many records came back, `+` when the listing
 * was cut short, and whether the payment provider answered.
 */
export const formatProviderListSummary = (
  label: string,
  listing: {
    readonly items: ReadonlyArray<unknown>;
    readonly providerAvailable: boolean;
    readonly truncated: boolean;
  }
) =>
  `${label}: ${listing.items.length}${listing.truncated ? "+" : ""} · provider ${listing.providerAvailable ? "available" : "unavailable"}`;

export const formatProviderOrderRow = (order: AdministrationOrderType) =>
  [
    order.orderId,
    order.providerStatus,
    order.link?.stateLabel ?? "Not linked",
    order.link?.reservationId ?? "No reservation",
  ].join("\t");

export const formatProviderOperationRow = (
  operation: AdministrationOperationType
) =>
  [
    operation.operationId ?? "Unknown operation",
    operation.operationTime ?? "Unknown time",
    operation.operationType ?? "Unknown type",
    operation.operationResult ?? "Unknown result",
    operation.orderId ?? "No order",
    operation.linkedReservationId ?? "No reservation",
  ].join("\t");
