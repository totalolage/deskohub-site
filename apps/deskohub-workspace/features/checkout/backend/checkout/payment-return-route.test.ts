import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import type { PaymentReturnTarget } from "@/features/checkout/payment-return-target";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { handleCheckoutPaymentReturn } from "./checkout-payment-return-route.server";

const invoke = async (
  search = "",
  {
    params = { locale: "en-US", orderId: "order-id" },
    stored = undefined,
    lookupFails = false,
  }: {
    readonly params?: { readonly locale: string; readonly orderId: string };
    readonly stored?: PaymentReturnTarget;
    readonly lookupFails?: boolean;
  } = {}
) => {
  const lookups: string[] = [];
  const reservations = Layer.mock(WorkspaceReservationRepository, {
    findPaymentReturnTarget: (orderId) =>
      Effect.suspend(() => {
        lookups.push(orderId);
        return lookupFails
          ? Effect.fail(
              new EffectDrizzleQueryError({
                query: "select",
                params: [],
                cause: new Error("synthetic outage"),
              })
            )
          : Effect.succeed(stored);
      }),
  });
  const response = await handleCheckoutPaymentReturn(
    new Request(
      `https://deskohub.test/en-US/checkout/pay/return/order-id${search}`
    ),
    { params: Promise.resolve(params) }
  ).pipe(Effect.provide(reservations), Effect.runPromise);
  return { response, lookups };
};

const expectReturnHeaders = (response: Response) => {
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.has("set-cookie")).toBe(false);
};

describe("checkout pay return route", () => {
  test("hands a cookie-less provider return to the protected status page", async () => {
    const { response, lookups } = await invoke("?paymentid=synthetic-payment");

    expectReturnHeaders(response);
    expect(response.headers.get("location")).toBe(
      "https://deskohub.test/en-US/reservation/status/order-id"
    );
    expect(await response.text()).toBe("");
    expect(lookups).toEqual(["order-id"]);
  });

  test("preserves explicit return outcomes for status reconciliation", async () => {
    for (const outcome of ["success", "cancelled"]) {
      const { response } = await invoke(`?outcome=${outcome}`);

      expectReturnHeaders(response);
      expect(response.headers.get("location")).toBe(
        `https://deskohub.test/en-US/reservation/status/order-id?outcome=${outcome}`
      );
    }
  });

  test("discards unknown outcomes and provider query parameters", async () => {
    const { response } = await invoke(
      "?outcome=untrusted&paymentid=synthetic-payment&redirectUrl=https://elsewhere.test&accessToken=untrusted"
    );

    expect(response.headers.get("location")).toBe(
      "https://deskohub.test/en-US/reservation/status/order-id"
    );
  });

  test.each([
    ["native-app", () => "deskohub://reservations/order-id?after=payment"],
    [
      "web-app",
      () =>
        expect.stringMatching(
          /^https?:\/\/[^/?]+\/app\/reservations\/order-id\?after=payment$/
        ),
    ],
  ] as const)(
    "returns a %s checkout to its app screen after success and cancellation",
    async (stored, location) => {
      for (const search of ["", "?outcome=cancelled"]) {
        const { response } = await invoke(search, { stored });

        expectReturnHeaders(response);
        expect(response.headers.get("location")).toEqual(location());
      }
    }
  );

  test("never lets the query choose an app destination", async () => {
    const { response } = await invoke(
      "?returnTarget=native-app&target=web-app"
    );

    expect(response.headers.get("location")).toBe(
      "https://deskohub.test/en-US/reservation/status/order-id"
    );
  });

  test("returns to the site status page when the target lookup fails", async () => {
    const { response } = await invoke("?outcome=cancelled", {
      lookupFails: true,
    });

    expectReturnHeaders(response);
    expect(response.headers.get("location")).toBe(
      "https://deskohub.test/en-US/reservation/status/order-id?outcome=cancelled"
    );
  });

  test("rejects invalid route params", async () => {
    for (const params of [
      { locale: "en-US", orderId: "" },
      { locale: "fr-FR", orderId: "order-id" },
    ]) {
      const { response, lookups } = await invoke("", {
        params,
        stored: "native-app",
      });
      expect(response.status).toBe(404);
      expect(lookups).toEqual([]);
    }
  });
});
