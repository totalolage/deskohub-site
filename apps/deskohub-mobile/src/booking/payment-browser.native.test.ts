import { afterAll, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import * as WebBrowser from "expo-web-browser";
import { paymentBrowserLayer } from "./payment-browser.native";
import { PaymentBrowser } from "./payment-browser.service";

const openAuthSession = spyOn(WebBrowser, "openAuthSessionAsync");

afterAll(() => openAuthSession.mockRestore());

test("opens the payment page in the app's own task, so a later payment can't bring back an earlier page", async () => {
  await Effect.runPromise(
    Effect.service(PaymentBrowser).pipe(
      Effect.flatMap((browser) =>
        browser.open(
          "https://gateway.example.test/pay/1",
          "deskohub://reservations/order-1?after=payment"
        )
      ),
      Effect.provide(paymentBrowserLayer)
    )
  );

  expect(openAuthSession.mock.calls).toEqual([
    [
      "https://gateway.example.test/pay/1",
      "deskohub://reservations/order-1?after=payment",
      { createTask: false },
    ],
  ]);
});
