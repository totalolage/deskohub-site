export const locales = ["cs-CZ", "en-US"] as const;

export type Locale = (typeof locales)[number];

export type NexiCurrency = "CZK";

export interface CreateHostedPaymentPageInput {
  readonly orderId: string;
  readonly amount: string;
  readonly currency?: NexiCurrency;
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
