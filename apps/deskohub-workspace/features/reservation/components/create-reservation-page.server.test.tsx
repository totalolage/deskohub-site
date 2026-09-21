import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const { createReservationPage } = await import(
  "./create-reservation-page.server"
);

test("renders the reservation shell before request-bound content resolves", async () => {
  const render = mock((): ReactNode => "loaded reservation form");
  const fallback = mock((): ReactNode => "loading reservation form");
  const searchParams = new Promise<Record<string, string>>(() => undefined);
  const pageDefinition = createReservationPage({
    fallback,
    kind: "cowork",
    metadata: () => ({ description: "Description", title: "Title" }),
    pathname: "/reservation/cowork",
    render,
  });

  const page = await pageDefinition.Page({
    searchParams,
  });

  expect(render).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledWith("en-US");
  expect(isValidElement(page)).toBe(true);

  const pageProps = (
    page as ReactElement<{
      readonly children: ReactNode;
      readonly fallback: ReactNode;
      readonly locale: string;
    }>
  ).props;

  expect(pageProps).toMatchObject({
    fallback: "loading reservation form",
    locale: "en-US",
  });
  expect(isValidElement(pageProps.children)).toBe(true);
});

test("rejects a disabled gated page before rendering its shell", async () => {
  const render = mock((): ReactNode => "loaded reservation form");
  const fallback = mock((): ReactNode => "loading reservation form");
  const isEnabled = mock(() => Promise.resolve(false));
  const pageDefinition = createReservationPage({
    fallback,
    isEnabled,
    kind: "cowork",
    metadata: () => ({ description: "Description", title: "Title" }),
    pathname: "/reservation/cowork",
    render,
  });

  await expect(
    pageDefinition.Page({ searchParams: Promise.resolve({}) })
  ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  await expect(pageDefinition.generateMetadata()).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404"
  );
  expect(isEnabled).toHaveBeenCalledTimes(2);
  expect(fallback).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

test("prefers the signed requested discount code over a fresh public query code", async () => {
  const { loadRestoredReservation } = await import(
    "./create-reservation-page.server"
  );
  const { buildSignedPayState, sealPayState } = await import(
    "@/features/checkout/backend/checkout/pay-state"
  );
  const { Schema } = await import("effect");
  const { canonicalPromotionCodeSchema } = await import(
    "@/features/discounts/contracts"
  );
  const { normalizedCoworkReservationOrderSchema } = await import(
    "@/features/reservation/cowork-reservation"
  );
  const reservation = Schema.decodeUnknownSync(
    normalizedCoworkReservationOrderSchema
  )({
    kind: "cowork",
    entryTier: "basic",
    date: "2099-06-20",
    coffee: false,
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+420777000111",
  });
  const quote = Effect.runSync(
    buildCoworkReservationQuote({
      kind: "cowork",
      entryTier: reservation.entryTier,
      date: reservation.date,
      coffee: reservation.coffee,
    })
  );
  const token = await Effect.runPromise(
    Effect.gen(function* () {
      const state = yield* buildSignedPayState({
        locale: "en-US",
        reservation,
        quote,
        orderId: "reservation-id",
        checkoutSessionId: "session-id",
        requestedDiscountCode: Schema.decodeUnknownSync(
          canonicalPromotionCodeSchema
        )("CAMPAIGN10"),
      });
      return yield* sealPayState(state);
    })
  );
  const restored = await Effect.runPromise(
    loadRestoredReservation(token, "en-US", "cowork")
  );

  expect(restored).toMatchObject({
    submittedCode: "CAMPAIGN10",
    replacementToken: token,
  });
});
