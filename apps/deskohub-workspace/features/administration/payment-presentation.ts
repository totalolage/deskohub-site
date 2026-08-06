export const getProviderValueLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

const operationFailureResults = new Set([
  "CANCELED",
  "CANCELLED",
  "DECLINED",
  "DENIED",
  "DENIED_BY_RISK",
  "FAILED",
  "REFUNDED",
  "THREEDS_FAILED",
  "VOIDED",
]);

const operationWarningTypes = new Set(["CANCEL", "REFUND", "VOID"]);

export const getProviderOperationTimelineTone = (
  operationType: string | undefined,
  operationResult: string | undefined
): "neutral" | "positive" | "warning" => {
  const type = operationType?.toUpperCase();
  const result = operationResult?.toUpperCase();
  if (
    (result && operationFailureResults.has(result)) ||
    (type && operationWarningTypes.has(type))
  ) {
    return "warning";
  }
  if (
    (type === "AUTHORIZATION" && result === "AUTHORIZED") ||
    ((type === "AUTHORIZATION" || type === "CAPTURE") && result === "EXECUTED")
  ) {
    return "positive";
  }
  return "neutral";
};
