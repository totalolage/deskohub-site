/** A layout group such as `(account)`, which adds nothing to the URL. */
const isGroup = (segment: string) =>
  segment.startsWith("(") && segment.endsWith(")");

/**
 * The screen's route pattern, such as `/reservations/[orderId]`, from Expo
 * Router's segments. Screen views record the pattern, never the concrete
 * path, so no order or account id reaches analytics.
 */
export const screenPathPattern = (segments: readonly string[]) =>
  `/${segments.filter((segment) => !isGroup(segment) && segment !== "index").join("/")}`;
