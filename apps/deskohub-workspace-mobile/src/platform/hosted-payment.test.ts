import { describe, expect, mock, test } from "bun:test";
import {
  completeHostedPayment,
  getHostedPaymentReturnUrl,
} from "./hosted-payment";

const appOrigin = "https://app.workspace.deskohub.cz";
const hostedPaymentUrl = "https://payments.example.test/hosted";
const orderId = "purchase/1";

describe("hosted payment completion", () => {
  test("redirects the PWA in the current page without reconciling early", async () => {
    const navigateWeb = mock(() => undefined);
    const openNativeSession = mock(() => Promise.resolve());
    const reconcile = mock(() => Promise.resolve("paid"));

    await expect(
      completeHostedPayment(
        { appOrigin, hostedPaymentUrl, orderId, platform: "web" },
        { navigateWeb, openNativeSession, reconcile }
      )
    ).resolves.toBeNull();

    expect(navigateWeb).toHaveBeenCalledWith(hostedPaymentUrl);
    expect(openNativeSession).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("waits for the Android browser return before reconciling", async () => {
    let finishBrowserSession: (() => void) | undefined;
    const browserSession = new Promise<void>((resolve) => {
      finishBrowserSession = resolve;
    });
    const navigateWeb = mock(() => undefined);
    const openNativeSession = mock(() => browserSession);
    const reconcile = mock(() => Promise.resolve("paid"));

    const completion = completeHostedPayment(
      { appOrigin, hostedPaymentUrl, orderId, platform: "android" },
      { navigateWeb, openNativeSession, reconcile }
    );
    await Promise.resolve();

    expect(openNativeSession).toHaveBeenCalledWith(
      hostedPaymentUrl,
      "https://app.workspace.deskohub.cz/payment/purchase%2F1"
    );
    expect(reconcile).not.toHaveBeenCalled();

    finishBrowserSession?.();
    await expect(completion).resolves.toBe("paid");
    expect(reconcile).toHaveBeenCalledWith(orderId);
    expect(navigateWeb).not.toHaveBeenCalled();
  });

  test("builds the canonical encoded payment return URL", () => {
    expect(getHostedPaymentReturnUrl(appOrigin, orderId)).toBe(
      "https://app.workspace.deskohub.cz/payment/purchase%2F1"
    );
  });
});
