export const checkoutStatusKinds = [
  "not_found",
  "created",
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_fulfillment_delayed",
  "paid_awaiting_delivery",
  "paid_delivery_delayed",
  "fulfilled",
  "fulfillment_failed",
  "payment_failed",
  "cancelled",
  "expired",
  "late_payment_checking",
  "late_payment_refund",
  "late_payment_review",
] as const;

export type CheckoutStatusKind = (typeof checkoutStatusKinds)[number];

type CheckoutStatusTraits = {
  /** Locally paid; a late payment counts only after recovery confirms it. */
  readonly paid: boolean;
  readonly autoRefresh: boolean;
  readonly offersNewReservation: boolean;
  readonly offersReservationRetry: boolean;
  readonly supportTopic:
    | "fulfillment_failed"
    | "late_payment_review"
    | "payment_pending"
    | undefined;
  /** Includes the confirmation recipient even without a support request. */
  readonly showsCustomerContact: boolean;
  readonly promisesEmail: boolean;
};

export const checkoutStatusTraits = {
  not_found: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  created: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  pending: {
    paid: false,
    autoRefresh: true,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: true,
  },
  payment_pending_delayed: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: "payment_pending",
    showsCustomerContact: true,
    promisesEmail: true,
  },
  paid_waiting_fulfillment: {
    paid: true,
    autoRefresh: true,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: true,
  },
  paid_fulfillment_delayed: {
    paid: true,
    autoRefresh: false,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: "fulfillment_failed",
    showsCustomerContact: true,
    promisesEmail: true,
  },
  paid_awaiting_delivery: {
    paid: true,
    autoRefresh: true,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: true,
    promisesEmail: true,
  },
  paid_delivery_delayed: {
    paid: true,
    autoRefresh: false,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: "fulfillment_failed",
    showsCustomerContact: true,
    promisesEmail: true,
  },
  fulfilled: {
    paid: true,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: true,
  },
  fulfillment_failed: {
    paid: true,
    autoRefresh: false,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: "fulfillment_failed",
    showsCustomerContact: true,
    promisesEmail: false,
  },
  payment_failed: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: true,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  cancelled: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: true,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  expired: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: true,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  late_payment_checking: {
    paid: false,
    autoRefresh: true,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  late_payment_refund: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: true,
    offersReservationRetry: false,
    supportTopic: undefined,
    showsCustomerContact: false,
    promisesEmail: false,
  },
  late_payment_review: {
    paid: false,
    autoRefresh: false,
    offersNewReservation: false,
    offersReservationRetry: false,
    supportTopic: "late_payment_review",
    showsCustomerContact: true,
    promisesEmail: false,
  },
} as const satisfies Record<CheckoutStatusKind, CheckoutStatusTraits>;
