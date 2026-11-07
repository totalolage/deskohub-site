/**
 * The payment pages the fake Workspaces hand out, by URL, as a payment
 * gateway knows its sessions. Completing a page runs what its Workspace
 * registered, so the sample payment browser can pay an order without opening
 * anything. Every URL is unique in the process, so fake Workspaces never
 * complete each other's orders.
 */
const pages = new Map<string, () => void>();
let issued = 0;

/** Issues a payment page for the order; completing it runs `complete`. */
export const issueFakePaymentPage = (
  orderId: string,
  complete: () => void
): string => {
  issued += 1;
  const url = `https://pay.sample.example/checkout/${encodeURIComponent(orderId)}?session=${issued}`;
  pages.set(url, complete);
  return url;
};

/**
 * Completes the payment the page at `url` takes, again on a reopened page;
 * false for a URL no fake Workspace issued.
 */
export const completeFakePayment = (url: string): boolean => {
  const complete = pages.get(url);
  complete?.();
  return complete !== undefined;
};
