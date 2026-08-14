export const providerOrderAbandonmentTimeoutMinutes = 30;

type ProviderOrderState = {
  readonly operationCount: number;
  readonly authorizedAmount?: string;
  readonly capturedAmount?: string;
};

const isAbsentOrZeroProviderAmount = (value: string | undefined) =>
  value === undefined || /^0+(?:\.0+)?$/.test(value.trim());

export const hasProviderPaymentActivity = (order: ProviderOrderState) =>
  order.operationCount > 0 ||
  !isAbsentOrZeroProviderAmount(order.authorizedAmount) ||
  !isAbsentOrZeroProviderAmount(order.capturedAmount);

export const getProviderOrderAbandonmentState = (input: {
  readonly checkedAt: Temporal.Instant | undefined;
  readonly providerOrderCreatedAt: Temporal.Instant | null;
  readonly order: ProviderOrderState;
}): "abandoned" | "deferred" | "not_empty" => {
  if (
    hasProviderPaymentActivity(input.order) ||
    !input.checkedAt ||
    !input.providerOrderCreatedAt
  ) {
    return "not_empty";
  }

  const abandonmentCutoff = input.providerOrderCreatedAt.add({
    minutes: providerOrderAbandonmentTimeoutMinutes,
  });
  return Temporal.Instant.compare(input.checkedAt, abandonmentCutoff) < 0
    ? "deferred"
    : "abandoned";
};

export const getProviderOrderAbandonmentCutoff = (
  providerOrderCreatedAt: Temporal.Instant
) =>
  providerOrderCreatedAt.add({
    minutes: providerOrderAbandonmentTimeoutMinutes,
  });
