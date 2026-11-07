import { Layer } from "effect";
import type { CustomerDataServices } from "../../customer-api/customer-data-runtime";
import { BookingIds } from "../booking-ids.service";
import { PaymentBrowser } from "../payment-browser.service";
import { RememberedReferralCode } from "../remembered-referral.service";
import { completeFakePayment } from "./fake-payment-gateway";

/**
 * The payment page as sample-data mode shows it: the fake Workspace's page
 * completes at once and redirects to the return URL, so nothing opens and the
 * order is paid before the status screen reads it. A URL no fake Workspace
 * issued can't open.
 */
export const samplePaymentBrowserLayer = PaymentBrowser.fromAuthSession(
  (paymentUrl, returnUrl) =>
    completeFakePayment(paymentUrl)
      ? Promise.resolve({ type: "success", url: returnUrl })
      : Promise.reject(new Error("No sample payment page at this URL"))
);

/**
 * The development-only booking services of sample-data mode: the live ones,
 * except that the payment page is the fake Workspace's. Loaded only behind
 * the sample-data switch, as `sampleCustomerDataLayer` is.
 */
export const sampleBookingServicesLayer: Layer.Layer<
  PaymentBrowser | RememberedReferralCode | BookingIds,
  never,
  CustomerDataServices
> = Layer.mergeAll(
  samplePaymentBrowserLayer,
  RememberedReferralCode.Default,
  BookingIds.Default
);
