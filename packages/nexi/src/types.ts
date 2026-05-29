import { Effect, Schema } from "effect";

export const locales = ["cs-CZ", "en-US"] as const;

export type Locale = (typeof locales)[number];

export const nexiMinorUnitExponent = 2;

export const NexiCurrencySchema = Schema.Literal("CZK", "EUR").annotations({
  identifier: "NexiCurrency",
  description:
    "Nexi amount currency code. Supported settlement currencies depend on the merchant configuration.",
});
export type NexiCurrency = Schema.Schema.Type<typeof NexiCurrencySchema>;

export const NexiAmountSchema = Schema.Struct({
  amount: Schema.String.pipe(
    Schema.pattern(/^[1-9][0-9]*$/, {
      description: "Positive integer minor-unit/scaled amount string.",
    })
  ),
  currency: NexiCurrencySchema,
}).annotations({
  identifier: "NexiAmount",
  description: "Nexi API amount shape with ISO 4217 alphabetic currency code.",
});

export type NexiAmount = Schema.Schema.Type<typeof NexiAmountSchema>;

export const NexiWebhookOperationSchema = Schema.Struct({
  orderId: Schema.String.pipe(Schema.nonEmptyString()),
  operationId: Schema.optional(Schema.String),
  operationType: Schema.optional(Schema.String),
  operationResult: Schema.optional(Schema.String),
  operationTime: Schema.optional(Schema.String),
  operationAmount: Schema.optional(Schema.String),
  operationCurrency: Schema.optional(Schema.String),
}).annotations({
  identifier: "NexiWebhookOperation",
  description:
    "Official Nexi webhook operation payload fields required by Deskohub payment processing.",
});

export type NexiWebhookOperation = Schema.Schema.Type<
  typeof NexiWebhookOperationSchema
>;

export const NexiWebhookNotificationSchema = Schema.Struct({
  eventId: Schema.optional(Schema.String),
  eventTime: Schema.optional(Schema.String),
  securityToken: Schema.optional(Schema.String),
  operation: NexiWebhookOperationSchema,
}).annotations({
  identifier: "NexiWebhookNotification",
  description:
    "Official Nexi webhook notification envelope. Schema.Struct decodes only declared fields, so sensitive provider extras are tolerated but not returned in the typed value.",
});

export type NexiWebhookNotification = Schema.Schema.Type<
  typeof NexiWebhookNotificationSchema
>;

const decodeUnknownNexiWebhookNotification = Schema.decodeUnknown(
  NexiWebhookNotificationSchema
);

export type NexiWebhookEventIdentitySource = "provider" | "derived";

export interface NexiWebhookEventIdentity {
  readonly eventId: string;
  readonly source: NexiWebhookEventIdentitySource;
}

export type NexiWebhookSecurityTokenStatus = "absent" | "match" | "mismatch";

export interface NexiWebhookSecurityTokenCheck {
  readonly status: NexiWebhookSecurityTokenStatus;
}

export type NexiFailureStatusKind = "cancelled" | "expired" | "failed";

export interface NexiPaymentMetadata {
  readonly providerOperationId: string;
  readonly providerStatus?: string;
}

const cleanOptionalString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeNexiWebhookNotification = (
  notification: NexiWebhookNotification
): NexiWebhookNotification => ({
  eventId: cleanOptionalString(notification.eventId),
  eventTime: cleanOptionalString(notification.eventTime),
  securityToken: cleanOptionalString(notification.securityToken),
  operation: {
    orderId: notification.operation.orderId,
    operationId: cleanOptionalString(notification.operation.operationId),
    operationType: cleanOptionalString(notification.operation.operationType),
    operationResult: cleanOptionalString(notification.operation.operationResult),
    operationTime: cleanOptionalString(notification.operation.operationTime),
    operationAmount: cleanOptionalString(notification.operation.operationAmount),
    operationCurrency: cleanOptionalString(
      notification.operation.operationCurrency
    ),
  },
});

export const decodeNexiWebhookNotification = (payload: unknown) =>
  decodeUnknownNexiWebhookNotification(payload).pipe(
    Effect.map(normalizeNexiWebhookNotification)
  );

export const deriveNexiWebhookEventIdentity = (
  notification: NexiWebhookNotification
): NexiWebhookEventIdentity => {
  const normalized = normalizeNexiWebhookNotification(notification);
  const explicitEventId = normalized.eventId;
  if (explicitEventId) return { eventId: explicitEventId, source: "provider" };

  const operation = normalized.operation;
  return {
    eventId: [
      "nexi",
      operation.orderId,
      operation.operationId ?? "no-operation-id",
      operation.operationType ?? "no-operation-type",
      operation.operationResult ?? "no-operation-result",
      normalized.eventTime ?? operation.operationTime ?? "no-operation-time",
      operation.operationAmount ?? "no-operation-amount",
      operation.operationCurrency ?? "no-operation-currency",
    ].join(":"),
    source: "derived",
  };
};

export const checkNexiWebhookSecurityToken = (input: {
  readonly notificationSecurityToken: string | undefined;
  readonly expectedSecurityToken: string | null | undefined;
}): NexiWebhookSecurityTokenCheck => {
  const notificationSecurityToken = cleanOptionalString(
    input.notificationSecurityToken
  );
  if (!notificationSecurityToken) return { status: "absent" };

  return {
    status:
      notificationSecurityToken === input.expectedSecurityToken
        ? "match"
        : "mismatch",
  };
};

export const classifyNexiFailureStatus = (
  providerStatus: string | undefined
): NexiFailureStatusKind => {
  const normalized = cleanOptionalString(providerStatus)?.toUpperCase();
  if (["CANCELED", "CANCELLED", "VOIDED"].includes(normalized ?? "")) {
    return "cancelled";
  }
  if (["EXPIRED", "TIMEOUT", "TIMED_OUT"].includes(normalized ?? "")) {
    return "expired";
  }
  return "failed";
};

export const getNexiPaymentMetadata = (
  verification: PaymentVerificationResult
): NexiPaymentMetadata => ({
  providerOperationId: verification.provider.orderId,
  providerStatus:
    verification.provider.orderStatus ??
    (verification.provider.captureExecuted ? "capture_executed" : undefined),
});

export interface CreateHostedPaymentPageInput {
  readonly orderId: string;
  readonly correlationId: string;
  /** Integer minor-unit/scaled amount string, e.g. "5000" for 50.00. */
  readonly amount: string;
  readonly currency: NexiCurrency;
  readonly locale: Locale;
  readonly resultUrl: string;
  readonly cancelUrl: string;
  readonly notificationUrl: string;
}

export interface HostedPaymentPageSession {
  readonly orderId: string;
  readonly hostedPage: string;
  readonly securityToken: string;
}

export interface VerifyPaymentOutcomeInput {
  readonly orderId: string;
  readonly correlationId: string;
  /** Integer minor-unit/scaled amount string, matching the submitted order amount. */
  readonly amount: string;
  readonly currency?: NexiCurrency;
  readonly securityToken: string;
}

export type PaymentOutcomeStatus = "success" | "failure" | "pending";

export interface ProviderPaymentFacts {
  readonly orderId: string;
  readonly amount?: string;
  readonly currency?: string;
  readonly orderStatus?: string;
  readonly captureExecuted: boolean;
}

export interface PaymentVerificationResult {
  readonly status: PaymentOutcomeStatus;
  readonly provider: ProviderPaymentFacts;
  readonly mismatches: ReadonlyArray<
    "orderId" | "amount" | "currency" | "securityToken"
  >;
}
