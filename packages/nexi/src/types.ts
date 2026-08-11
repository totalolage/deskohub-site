import { Effect, Schema } from "effect";

export const locales = ["cs-CZ", "en-US"] as const;

export type Locale = (typeof locales)[number];

export const nexiMinorUnitExponent = 2;

export const NexiOrderIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("NexiOrderId")
).annotate({
  identifier: "NexiOrderId",
  description: "Opaque order identifier assigned to a Nexi payment.",
});
export type NexiOrderId = typeof NexiOrderIdSchema.Type;

export const NexiCorrelationIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("NexiCorrelationId")
).annotate({
  identifier: "NexiCorrelationId",
  description: "Correlation identifier sent with Nexi API requests.",
});
export type NexiCorrelationId = typeof NexiCorrelationIdSchema.Type;

export const NexiOperationIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("NexiOperationId")
).annotate({
  identifier: "NexiOperationId",
  description: "Opaque identifier assigned to a Nexi payment operation.",
});
export type NexiOperationId = typeof NexiOperationIdSchema.Type;

export const NexiWebhookEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("NexiWebhookEventId")
).annotate({
  identifier: "NexiWebhookEventId",
  description:
    "Stable Nexi webhook event identifier, supplied by Nexi or deterministically derived from its payload.",
});
export type NexiWebhookEventId = typeof NexiWebhookEventIdSchema.Type;

export const NexiCustomerReferenceSchema = Schema.NonEmptyString.pipe(
  Schema.brand("NexiCustomerReference")
).annotate({
  identifier: "NexiCustomerReference",
  description: "Merchant customer reference supplied to Nexi.",
});
export type NexiCustomerReference = typeof NexiCustomerReferenceSchema.Type;

const decodeNexiWebhookEventId = Schema.decodeUnknownSync(
  NexiWebhookEventIdSchema
);
const decodeNexiOperationId = Schema.decodeUnknownSync(NexiOperationIdSchema);

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
  orderId: NexiOrderIdSchema,
  operationId: Schema.optional(NexiOperationIdSchema),
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
  eventId: Schema.optional(NexiWebhookEventIdSchema),
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
  readonly eventId: NexiWebhookEventId;
  readonly source: NexiWebhookEventIdentitySource;
}

export type NexiWebhookSecurityTokenStatus = "absent" | "match" | "mismatch";

export interface NexiWebhookSecurityTokenCheck {
  readonly status: NexiWebhookSecurityTokenStatus;
}

export type NexiFailureStatusKind = "cancelled" | "expired" | "failed";

export interface NexiPaymentMetadata {
  readonly providerOperationId?: NexiOperationId;
  readonly providerStatus?: string;
}

const cleanOptionalString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const cleanOptionalNexiWebhookEventId = (
  value: NexiWebhookEventId | undefined
) => {
  const cleaned = cleanOptionalString(value);
  return cleaned ? decodeNexiWebhookEventId(cleaned) : undefined;
};

const cleanOptionalNexiOperationId = (value: NexiOperationId | undefined) => {
  const cleaned = cleanOptionalString(value);
  return cleaned ? decodeNexiOperationId(cleaned) : undefined;
};

export const normalizeNexiWebhookNotification = (
  notification: NexiWebhookNotification
): NexiWebhookNotification => ({
  eventId: cleanOptionalNexiWebhookEventId(notification.eventId),
  eventTime: cleanOptionalString(notification.eventTime),
  securityToken: cleanOptionalString(notification.securityToken),
  operation: {
    orderId: notification.operation.orderId,
    operationId: cleanOptionalNexiOperationId(
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
  if (explicitEventId) return { eventId: explicitEventId, source: "provider" };

  const operation = normalized.operation;
  return {
    eventId: decodeNexiWebhookEventId(
      [
        "nexi",
        operation.orderId,
        operation.operationId ?? "no-operation-id",
        operation.operationType ?? "no-operation-type",
        operation.operationResult ?? "no-operation-result",
        normalized.eventTime ?? operation.operationTime ?? "no-operation-time",
        operation.operationAmount ?? "no-operation-amount",
        operation.operationCurrency ?? "no-operation-currency",
      ].join(":")
    ),
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
  providerOperationId: verification.provider.operationId,
  providerStatus:
    verification.provider.orderStatus ??
    (verification.provider.captureExecuted ? "capture_executed" : undefined),
});

export interface CreateHostedPaymentPageInput {
  readonly orderId: NexiOrderId;
  readonly correlationId: NexiCorrelationId;
  /** Integer minor-unit/scaled amount string, e.g. "5000" for 50.00. */
  readonly amount: string;
  readonly currency: NexiCurrency;
  readonly locale: Locale;
  readonly resultUrl: string;
  readonly cancelUrl: string;
  readonly notificationUrl: string;
  readonly customer?: HostedPaymentCustomer;
}

export interface HostedPaymentCustomer {
  readonly id?: NexiCustomerReference;
  readonly name: string;
  readonly email?: string;
  readonly mobilePhone?: {
    readonly countryCallingCode: string;
    readonly nationalNumber: string;
  };
}

export interface VerifyPaymentOutcomeInput {
  readonly orderId: NexiOrderId;
  readonly correlationId: NexiCorrelationId;
  /** Integer minor-unit/scaled amount string, matching the submitted order amount. */
  readonly amount: string;
  readonly currency?: NexiCurrency;
  readonly securityToken: string;
}

export type PaymentOutcomeStatus = "success" | "failure" | "pending";

export interface ProviderPaymentFacts {
  readonly orderId: NexiOrderId;
  readonly operationId?: NexiOperationId;
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

export interface GetNexiOrderInput {
  readonly orderId: NexiOrderId;
  readonly correlationId: NexiCorrelationId;
}

export interface ListNexiOrdersInput {
  readonly correlationId: NexiCorrelationId;
  readonly fromTime?: string;
  readonly toTime?: string;
  readonly maxRecords?: number;
}

export interface GetNexiOperationInput {
  readonly correlationId: NexiCorrelationId;
  readonly operationId: NexiOperationId;
}

export interface ListNexiOperationsInput {
  readonly correlationId: NexiCorrelationId;
  readonly fromTime?: string;
  readonly toTime?: string;
  readonly maxRecords?: number;
  readonly channel?: string;
  readonly operationType?: string;
}

export interface NexiOperation {
  readonly orderId?: NexiOrderId;
  readonly operationId?: NexiOperationId;
  readonly channel?: string;
  readonly operationType?: string;
  readonly operationResult?: string;
  readonly operationTime?: string;
  readonly amount?: string;
  readonly currency?: string;
  readonly cancelledOperationId?: NexiOperationId;
}

export interface NexiOrder {
  readonly orderId: NexiOrderId;
  readonly amount?: string;
  readonly currency?: string;
  readonly authorizedAmount?: string;
  readonly capturedAmount?: string;
  readonly lastOperationTime?: string;
  readonly lastOperationType?: string;
  readonly operations: readonly NexiOperation[];
}
