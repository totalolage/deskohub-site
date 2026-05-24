import { Schema } from "effect";

export const locales = ["cs-CZ", "en-US"] as const;

export type Locale = (typeof locales)[number];

export const nexiMinorUnitExponent = 2;

export const NexiCurrencySchema = Schema.Literal("CZK").annotations({
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

export interface CreateHostedPaymentPageInput {
  readonly orderId: string;
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
