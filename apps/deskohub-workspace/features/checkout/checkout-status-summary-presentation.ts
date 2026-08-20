export type CheckoutStatusSummaryRow = {
  readonly label: string;
  readonly value: string;
};

export type CheckoutStatusSummaryPresentation = {
  readonly reservationTitle: string;
  readonly rows: readonly CheckoutStatusSummaryRow[];
};
