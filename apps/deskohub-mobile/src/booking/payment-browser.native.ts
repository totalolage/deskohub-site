import type { Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { PaymentBrowser } from "./payment-browser.service";

/**
 * The payment page on Android and iOS: Expo's auth session, which closes
 * when the gateway redirects to the app's return URL.
 */
export const paymentBrowserLayer: Layer.Layer<PaymentBrowser> =
  PaymentBrowser.fromAuthSession((url, redirectUrl) =>
    WebBrowser.openAuthSessionAsync(url, redirectUrl)
  );
