import type { Layer } from "effect";
import { PaymentBrowser } from "./payment-browser.service";

/**
 * The payment page on web: the app's page leaves for the gateway, which
 * returns to the address the server gives the order.
 */
export const paymentBrowserLayer: Layer.Layer<PaymentBrowser> =
  PaymentBrowser.fromLocation({
    assign: (url) => globalThis.location.assign(url),
  });
