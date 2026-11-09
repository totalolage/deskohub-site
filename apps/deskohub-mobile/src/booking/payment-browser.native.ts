import type { Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { PaymentBrowser } from "./payment-browser.service";

/**
 * Opens the gateway's Custom Tab in the app's own task. With Expo's default
 * (`createTask: true`), Android keeps the tab in a separate task, and the
 * next payment brings that task back with the previous order's page instead
 * of the new one, as it did for sign-in (#1039).
 */
const authSessionOptions: WebBrowser.AuthSessionOpenOptions = {
  createTask: false,
};

/**
 * The payment page on Android and iOS: Expo's auth session, which closes
 * when the gateway redirects to the app's return URL.
 */
export const paymentBrowserLayer: Layer.Layer<PaymentBrowser> =
  PaymentBrowser.fromAuthSession((url, redirectUrl) =>
    WebBrowser.openAuthSessionAsync(url, redirectUrl, authSessionOptions)
  );
