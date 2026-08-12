import { Tracer } from "effect";

export const readExternalParentSpan = (
  traceParent: string | undefined
): Tracer.ExternalSpan | undefined => {
  if (!traceParent) return undefined;
  const [version, traceId, spanId, flags] = traceParent.split("-");
  if (
    version !== "00" ||
    !traceId?.match(/^[0-9a-f]{32}$/) ||
    !spanId?.match(/^[0-9a-f]{16}$/) ||
    !flags?.match(/^[0-9a-f]{2}$/)
  ) {
    throw new Error("Invalid workspace E2E trace parent");
  }
  return Tracer.externalSpan({
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
    spanId,
    traceId,
  });
};
