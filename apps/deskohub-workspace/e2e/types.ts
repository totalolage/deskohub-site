import type { Effect } from "effect";
import type { MeetingRoomReservationDuration } from "../features/reservation/meeting-room-reservation-duration";
import type { StoredWorkspaceReservationDetails } from "../features/reservation/persistence-contracts";
import type { ReservationInterval } from "../features/reservation/reservation-interval";
import type { DatasourceConfig, WorkspaceE2EConfig } from "./config";
import type { WorkspaceE2EError } from "./errors";
import type { E2EDatabase } from "./integrations/database.service";

export type CheckoutRow = {
  reservation_id: string;
  checkout_session_key: string;
  checkout_attempt_key: string;
  correlation_id: string;
  dotypos_customer_id: string | null;
  dotypos_reservation_id: string | null;
  reservation_state: string;
  payment_state: string;
  fulfillment_state: string;
  active_payment_attempt_id: string | null;
  reservation_details: unknown;
  locale: string;
  reservation_created_at: Temporal.Instant | null;
  reservation_hold_expires_at: Temporal.Instant | null;
  reservation_confirmed_at: Temporal.Instant | null;
  reservation_cancelled_at: Temporal.Instant | null;
  reservation_hold_expired_at: Temporal.Instant | null;
  paid_at: Temporal.Instant | null;
  fulfilled_at: Temporal.Instant | null;
  fulfillment_failed_at: Temporal.Instant | null;
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
  webhook_processed_at: Temporal.Instant | null;
  webhook_state: string | null;
  webhook_error_code: string | null;
};

export type CheckoutData = {
  readonly checkoutUrl: string;
  readonly date: string;
  readonly email: string;
  readonly expectedReservationDetails: StoredWorkspaceReservationDetails;
  readonly locale: "en-US";
  readonly meetingRoom?: {
    readonly duration: MeetingRoomReservationDuration;
    readonly endsAt: ReservationInterval["endsAt"];
    readonly startDateTime: string;
    readonly startsAt: ReservationInterval["startsAt"];
  };
  readonly office?: {
    readonly endsAt: ReservationInterval["endsAt"];
    readonly endsOn: string;
    readonly seats: number;
    readonly startsAt: ReservationInterval["startsAt"];
    readonly startsOn: string;
  };
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
  cleanupComplete?: boolean;
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
  readonly checkoutStates: readonly CheckoutFlowState[];
  readonly id: string;
  readonly runAfterParallel?: boolean;
  readonly timeoutMs: number;
  readonly execute: (context: {
    readonly resources: WorkspaceE2ECaseResources;
    readonly runStep: WorkspaceE2EStepRunner;
    readonly session: string;
  }) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
};

export interface WorkspaceE2ECaseResources {
  readonly withHostedPaymentSession: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

export type WorkspaceE2EStep<A, R = never> = {
  readonly capacity?: "provider-verification" | "reservation-start";
  readonly execute: Effect.Effect<A, WorkspaceE2EError, R>;
  readonly id: string;
  readonly timeoutMs: number;
};

export type WorkspaceE2EStepRunner = <A, R>(
  step: WorkspaceE2EStep<A, R>
) => Effect.Effect<A, WorkspaceE2EError, R>;
