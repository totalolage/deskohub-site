import { describe, expect, test } from "bun:test";
import { Effect, Exit, type Layer, Option } from "effect";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";
import {
  PaymentBrowser,
  PaymentBrowserUnavailable,
  paymentReturnUrl,
} from "./payment-browser.service";

const openPayment = Effect.service(PaymentBrowser).pipe(
  Effect.flatMap((browser) =>
    browser.open(
      "https://gateway.example.test/pay/1",
      "deskohub://reservations/order-1?after=payment"
    )
  )
);

const open = (layer: Layer.Layer<PaymentBrowser>) =>
  Effect.runPromiseExit(openPayment.pipe(Effect.provide(layer)));

/** The failure opening the page ended with. */
const failure = (layer: Layer.Layer<PaymentBrowser>) =>
  Effect.runPromise(openPayment.pipe(Effect.flip, Effect.provide(layer)));

/** A stand-in for Expo's auth session that records what it was opened with. */
const authSession = (answer: () => Promise<WebBrowserAuthSessionResult>) => {
  const opened: Array<readonly [string, string]> = [];
  const layer = PaymentBrowser.fromAuthSession((url, redirectUrl) => {
    opened.push([url, redirectUrl]);
    return answer();
  });
  return { opened, layer };
};

const result = (type: string) =>
  ({ type }) as unknown as WebBrowserAuthSessionResult;

describe("native payment browser", () => {
  test("opens the payment page with the return URL and reports a redirect as returned", async () => {
    const session = authSession(async () => ({
      type: "success",
      url: "deskohub://reservations/order-1?after=payment",
    }));
    expect(await open(session.layer)).toEqual(Exit.succeed("returned"));
    expect(session.opened).toEqual([
      [
        "https://gateway.example.test/pay/1",
        "deskohub://reservations/order-1?after=payment",
      ],
    ]);
  });

  test.each(["cancel", "dismiss", "opened"])(
    "reports %s as dismissed",
    async (type) => {
      const session = authSession(async () => result(type));
      expect(await open(session.layer)).toEqual(Exit.succeed("dismissed"));
    }
  );

  test("a locked browser couldn't show the page", async () => {
    const session = authSession(async () => result("locked"));
    const error = await failure(session.layer);
    expect(error).toBeInstanceOf(PaymentBrowserUnavailable);
    expect(error.cause).toEqual({ type: "locked" });
  });

  test("a session that can't start is unavailable", async () => {
    const session = authSession(() => Promise.reject(new Error("no browser")));
    const error = await failure(session.layer);
    expect(error).toBeInstanceOf(PaymentBrowserUnavailable);
    expect(error.cause).toEqual(new Error("no browser"));
  });
});

describe("web payment browser", () => {
  test("leaves for the payment page and never completes", async () => {
    const assigned: Array<string> = [];
    const layer = PaymentBrowser.fromLocation({
      assign: (url) => {
        assigned.push(url);
      },
    });
    const outcome = await Effect.runPromise(
      openPayment.pipe(Effect.timeoutOption("20 millis"), Effect.provide(layer))
    );
    expect(assigned).toEqual(["https://gateway.example.test/pay/1"]);
    expect(outcome).toEqual(Option.none());
  });

  test("a location that refuses the address is unavailable", async () => {
    const error = await failure(
      PaymentBrowser.fromLocation({
        assign: () => {
          throw new Error("blocked");
        },
      })
    );
    expect(error).toBeInstanceOf(PaymentBrowserUnavailable);
  });
});

describe("paymentReturnUrl", () => {
  test("uses a status URL in the app's scheme", () => {
    expect(paymentReturnUrl("order-1", "deskohub://reservations/order-1")).toBe(
      "deskohub://reservations/order-1"
    );
  });

  test("falls back to the app's status screen for a site status URL", () => {
    expect(
      paymentReturnUrl(
        "order/1",
        "https://workspace.example.test/cs/reservation/status?order=order-1"
      )
    ).toBe("deskohub://reservations/order%2F1?after=payment");
  });
});
