/**
 * Webhook Client
 *
 * Client utilities for making webhook requests and handling responses
 */

import type {
  WebhookErrorResponse,
  WebhookResponse,
  WebhookResult,
  WebhookStatusChange,
} from "../types/webhook.types";

/**
 * Webhook request payload for testing
 */
export interface WebhookTestPayload {
  reservationId: string;
  customerId: string;
  status: WebhookStatusChange;
}

/**
 * Send a test webhook request
 */
export async function sendTestWebhook(
  payload: WebhookTestPayload
): Promise<WebhookResponse> {
  const { reservationId, customerId, status } = payload;

  // Map status to Dotypos status code
  const statusCode = status === "created" ? 0 : status === "confirmed" ? 5 : 10;

  const webhookPayload = [
    {
      branchid: 128665136,
      created: Date.now(),
      customerid: parseInt(customerId),
      employeeid: 123,
      enddate: Date.now() + 7200000,
      reservationid: parseInt(reservationId),
      startdate: Date.now(),
      status: statusCode,
      updated: Date.now(),
      deleted: 0,
    },
  ];

  try {
    const response = await fetch("/api/webhooks/reservation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookPayload),
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      return {
        error: "Request failed",
        message: data.message || `HTTP ${response.status}`,
        issues: data.issues,
      };
    }

    return data as WebhookResponse;
  } catch (error) {
    return {
      error: "Network error",
      message:
        error instanceof Error ? error.message : "Failed to send webhook",
    };
  }
}

/**
 * Type guard to check if response is an error
 */
export function isWebhookError(
  response: WebhookResponse
): response is WebhookErrorResponse {
  return "error" in response && !("success" in response);
}

/**
 * Type guard to check if response is successful
 */
export function isWebhookSuccess(
  response: WebhookResponse
): response is Extract<WebhookResponse, { success: true }> {
  return "success" in response && response.success === true;
}

/**
 * Extract webhook result from response
 */
export function extractWebhookResult(
  response: WebhookResponse
): WebhookResult | null {
  if (isWebhookSuccess(response) && "data" in response && response.data) {
    return response.data;
  }
  return null;
}
