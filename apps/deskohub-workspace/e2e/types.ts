import type { Effect } from "effect";
import type { DatasourceConfig, WorkspaceE2EConfig } from "./config";
import type { WorkspaceE2EError } from "./errors";

export type CheckoutRow = {
  reservation_id: string;
  correlation_id: string;
  dotypos_customer_id: string | null;
  dotypos_reservation_id: string | null;
  reservation_state: string;
  payment_state: string;
  fulfillment_state: string;
  active_payment_attempt_id: string | null;
  product_tier: string;
  product_coffee: boolean;
  product_monitor_option: string | null;
  locale: string;
  reservation_created_at: Date | null;
  reservation_confirmed_at: Date | null;
  reservation_cancelled_at: Date | null;
  reservation_hold_expired_at: Date | null;
  paid_at: Date | null;
  fulfilled_at: Date | null;
  fulfillment_failed_at: Date | null;
  failure_code: string | null;
  fulfillment_failure_code: string | null;
  payment_attempt_id: string | null;
  provider: string | null;
  provider_order_id: string | null;
  security_token: string | null;
  payment_attempt_state: string | null;
  amount_value: number | null;
  amount_exponent: number | null;
  currency: string | null;
  provider_redirect_url: string | null;
  last_webhook_event_id: string | null;
  last_provider_operation_id: string | null;
  last_provider_status: string | null;
  payment_failure_code: string | null;
  webhook_id: string | null;
  webhook_provider: string | null;
  webhook_event_id: string | null;
  webhook_provider_order_id: string | null;
  webhook_processed_at: Date | null;
  webhook_state: string | null;
  webhook_error_code: string | null;
};

export type CheckoutData = {
  readonly checkoutUrl: string;
  readonly date: string;
  readonly email: string;
  readonly expectedCoffee: boolean;
  readonly expectedMonitorOption: string | null;
  readonly expectedProductTier: string;
  readonly locale: "en-US";
  readonly message: string;
  readonly name: string;
  readonly orderIdHint: string;
  readonly phone: string;
};

export type CheckoutFlow = {
  readonly id: string;
  readonly makeData: (
    config: WorkspaceE2EConfig,
    datasourceConfig: DatasourceConfig,
    date: string
  ) => Effect.Effect<CheckoutData | undefined, WorkspaceE2EError>;
  readonly submitReservationScript: (data: CheckoutData) => string;
};

export type CheckoutFlowState = {
  checkoutRow?: CheckoutRow;
  data: CheckoutData;
  orderId?: string;
  startedAt?: Date;
};

export type PaymentTerminalScenario = {
  readonly providerStatus: string;
  readonly state: "cancelled" | "failed";
  readonly titlePattern: RegExp;
};

export type WorkspaceE2ECase = {
  readonly id: string;
  readonly execute: (context: {
    readonly session: string;
  }) => Effect.Effect<void, WorkspaceE2EError>;
};
