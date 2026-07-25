import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";

export const locales = ["cs-CZ", "en-US"] as const;

export type Locale = (typeof locales)[number];

export const nexiMinorUnitExponent = 2;

export const NexiCurrencySchema = Schema.Literals(["CZK", "EUR"]).annotate({
  identifier: "NexiCurrency",
  description:
    "Nexi amount currency code. Supported settlement currencies depend on the merchant configuration.",
});
export type NexiCurrency = Schema.Schema.Type<typeof NexiCurrencySchema>;

export const NexiAmountSchema = Schema.Struct({
  amount: Schema.String.check(
    Schema.isPattern(/^[1-9][0-9]*$/, {
      description: "Positive integer minor-unit/scaled amount string.",
    })
  ),
  currency: NexiCurrencySchema,
}).annotate({
  identifier: "NexiAmount",
  description: "Nexi API amount shape with ISO 4217 alphabetic currency code.",
});

export type NexiAmount = Schema.Schema.Type<typeof NexiAmountSchema>;

export const NexiWebhookOperationSchema = Schema.Struct({
  orderId: Schema.NonEmptyString,
  operationId: Schema.optional(Schema.String),
  operationType: Schema.optional(Schema.String),
  operationResult: Schema.optional(Schema.String),
  operationTime: Schema.optional(Schema.String),
  operationAmount: Schema.optional(Schema.String),
  operationCurrency: Schema.optional(Schema.String),
}).annotate({
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
}).annotate({
  identifier: "NexiWebhookNotification",
  description:
    "Official Nexi webhook notification envelope. Schema.Struct decodes only declared fields, so sensitive provider extras are tolerated but not returned in the typed value.",
});

export type NexiWebhookNotification = Schema.Schema.Type<
  typeof NexiWebhookNotificationSchema
>;

const decodeUnknownNexiWebhookNotification = Schema.decodeUnknownEffect(
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
  readonly providerOperationId?: string;
  readonly providerStatus?: string;
}

const cleanOptionalString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const digestNexiProviderIdentifier = (kind: "event" | "operation", value: string) =>
  `nexi-${kind}:${createHash("sha256").update(value).digest("hex")}`;

export const normalizeNexiProviderOperationId = (
  value: string | null | undefined
): string | undefined => {
  const cleaned = cleanOptionalString(value);
  if (!cleaned) return undefined;
  return isBoundedNexiProviderIdentifier(cleaned)
    ? cleaned
    : digestNexiProviderIdentifier("operation", cleaned);
};

export const normalizeNexiWebhookNotification = (
  notification: NexiWebhookNotification
): NexiWebhookNotification => ({
  eventId: cleanOptionalString(notification.eventId),
  eventTime: cleanOptionalString(notification.eventTime),
  securityToken: cleanOptionalString(notification.securityToken),
  operation: {
    orderId: notification.operation.orderId,
    operationId: normalizeNexiProviderOperationId(
      notification.operation.operationId
    ),
    operationType: cleanOptionalString(notification.operation.operationType),
    operationResult: cleanOptionalString(
      notification.operation.operationResult
    ),
    operationTime: cleanOptionalString(notification.operation.operationTime),
    operationAmount: cleanOptionalString(
      notification.operation.operationAmount
    ),
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
  const operation = normalized.operation;
  if (
    explicitEventId &&
    isBoundedNexiProviderIdentifier(explicitEventId)
  ) {
    return { eventId: explicitEventId, source: "provider" };
  }
  const identity = explicitEventId
    ? [
        "provider",
        explicitEventId,
        operation.orderId,
        operation.operationId ?? "",
      ]
    : [
        "derived",
        operation.orderId,
        operation.operationId ?? "",
        operation.operationType ?? "",
        operation.operationResult ?? "",
        normalized.eventTime ?? operation.operationTime ?? "",
        operation.operationAmount ?? "",
        operation.operationCurrency ?? "",
      ];
  return {
    eventId: `nexi:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
    source: explicitEventId ? "provider" : "derived",
  };
};

export const isBoundedNexiProviderIdentifier = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

export const checkNexiWebhookSecurityToken = (input: {
  readonly notificationSecurityToken: string | undefined;
  readonly expectedSecurityToken: string | null | undefined;
}): NexiWebhookSecurityTokenCheck => {
  const notificationSecurityToken = cleanOptionalString(
    input.notificationSecurityToken
  );
  const expectedSecurityToken = cleanOptionalString(
    input.expectedSecurityToken
  );
  if (!notificationSecurityToken || !expectedSecurityToken) {
    return { status: "absent" };
  }

  return {
    status:
      notificationSecurityToken === expectedSecurityToken
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
  providerOperationId: normalizeNexiProviderOperationId(
    verification.provider.operationId
  ),
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

export interface VerifyPaymentOutcomeInput {
  readonly orderId: string;
  readonly correlationId: string;
  /** Integer minor-unit/scaled amount string, matching the submitted order amount. */
  readonly amount: string;
  readonly currency?: NexiCurrency;
  readonly securityToken?: string;
}

export type PaymentOutcomeStatus =
  | "success"
  | "failure"
  | "pending"
  | "manual_review";

export interface ProviderPaymentFacts {
  readonly orderId: string;
  readonly operationId?: string;
  readonly operationType?: string;
  readonly amount?: string;
  readonly currency?: string;
  readonly orderStatus?: string;
  readonly captureExecuted: boolean;
}

const normalizedEvidence = (value: string | undefined) =>
  cleanOptionalString(value)?.toUpperCase();

/**
 * Webhook facts are an additional provider observation, not authority to
 * overwrite the read-only order lookup. Every fact the provider supplied must
 * agree with both the admitted local identity and the reconciled order.
 */
export const isNexiWebhookEvidenceConsistent = (input: {
  readonly notification: NexiWebhookNotification;
  readonly expectedOrderId: string;
  readonly expectedAmount: string;
  readonly expectedCurrency: string;
  readonly verification: PaymentVerificationResult;
}): boolean => {
  const operation = normalizeNexiWebhookNotification(
    input.notification
  ).operation;
  const provider = input.verification.provider;

  if (
    operation.orderId !== input.expectedOrderId ||
    operation.orderId !== provider.orderId
  ) {
    return false;
  }
  if (
    operation.operationId !== undefined &&
    operation.operationId !== provider.operationId
  ) {
    return false;
  }
  if (
    operation.operationType !== undefined &&
    normalizedEvidence(operation.operationType) !==
      normalizedEvidence(provider.operationType)
  ) {
    return false;
  }
  if (
    operation.operationResult !== undefined &&
    normalizedEvidence(operation.operationResult) !==
      normalizedEvidence(provider.orderStatus)
  ) {
    return false;
  }
  if (
    operation.operationAmount !== undefined &&
    (operation.operationAmount !== input.expectedAmount ||
      operation.operationAmount !== provider.amount)
  ) {
    return false;
  }
  if (
    operation.operationCurrency !== undefined &&
    (normalizedEvidence(operation.operationCurrency) !==
      normalizedEvidence(input.expectedCurrency) ||
      normalizedEvidence(operation.operationCurrency) !==
        normalizedEvidence(provider.currency))
  ) {
    return false;
  }

  return true;
};

export interface PaymentVerificationResult {
  readonly status: PaymentOutcomeStatus;
  readonly provider: ProviderPaymentFacts;
  readonly mismatches: ReadonlyArray<
    "orderId" | "amount" | "currency" | "securityToken" | "operationEvidence"
  >;
}
