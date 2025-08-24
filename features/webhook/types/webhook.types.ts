/**
 * Webhook Types
 *
 * Centralized types for webhook handling to avoid duplication
 */

/**
 * Webhook status change types
 */
export type WebhookStatusChange =
  | "created"
  | "confirmed"
  | "declined"
  | "unknown";

/**
 * Webhook processing result
 */
export interface WebhookResult {
  reservationId: number;
  customerId: number;
  statusChange: WebhookStatusChange;
  emailSent: boolean;
  customerEmail: string | null;
}

/**
 * Webhook API response types
 */
export type WebhookResponse =
  | { success: true; data: WebhookResult }
  | { success: true; message: string }
  | { success: true; error: string }
  | { error: string; message: string; issues?: unknown };

/**
 * Webhook error response
 */
export interface WebhookErrorResponse {
  error: string;
  message: string;
  issues?: unknown;
}

/**
 * Webhook success response
 */
export interface WebhookSuccessResponse {
  success: true;
  data?: WebhookResult;
  message?: string;
  error?: string;
}

/**
 * Type guard for webhook result
 */
export function isWebhookResult(value: unknown): value is WebhookResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "reservationId" in value &&
    "customerId" in value &&
    "statusChange" in value &&
    "emailSent" in value
  );
}

/**
 * Type guard for success response with data
 */
export function isWebhookSuccessWithData(
  response: WebhookResponse
): response is { success: true; data: WebhookResult } {
  return (
    "success" in response &&
    response.success === true &&
    "data" in response &&
    isWebhookResult(response.data)
  );
}
