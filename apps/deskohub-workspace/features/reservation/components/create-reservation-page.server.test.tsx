import { expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { instantStringSchema } from "@/shared/utils/temporal";

const testEmailAddressForAda = testEmailAddress("ada");

const nextServer = await import("next/server");

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));

const loadReservationCheckoutAccount = mock(
  (_kind: string): Promise<unknown> => Promise.resolve({ status: "signed-out" })
);
mock.module(
  "@/features/reservation/backend/reservation-existing-customer.server",
  () => ({ loadReservationCheckoutAccount })
);

const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");

const { createReservationPage } = await import(
  "./create-reservation-page.server"
);
const { checkoutContactReturnState } = await import(
  "@/features/reservation/backend/checkout-contact-return-state"
);
const { checkoutContactQueryParam } = await import(
  "@/features/reservation/reservation-checkout-contact"
);

const checkoutAccount = {
  status: "linked",
  customer: {
    contact: {
      name: "Ada Lovelace",
      email: testEmailAddressForAda,
      phone: "+420 777 777 777",
    },
    hasMarketingConsent: false,
  },
};

type ReservationContentProps = {
  readonly definition: unknown;
  readonly searchParams: Promise<Record<string, string>>;
};

/** Renders the request-bound content the page shell suspends on. */
const renderContent = async (page: ReactNode) => {
  const content = (
    page as ReactElement<{
      readonly children: ReactElement<ReservationContentProps>;
    }>
  ).props.children;
  const Content = content.type as (
    props: ReservationContentProps
  ) => Promise<ReactNode>;
  return Content(content.props);
};

/** Fails a deadlocked load quickly instead of at the test timeout. */
const withinOneSecond = <Value,>(promise: Promise<Value>) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out")), 1000)
    ),
  ]);

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

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

test("gates a disabled page inside its content, keeping the shell static", async () => {
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

  const page = await pageDefinition.Page({
    searchParams: Promise.resolve({}),
  });

  expect(isEnabled).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledWith("en-US");

  type ContentProps = { readonly searchParams: Promise<object> };
  const content = (
    page as ReactElement<{ readonly children: ReactElement<ContentProps> }>
  ).props.children;
  const renderContent = content.type as (
    props: ContentProps
  ) => Promise<ReactNode>;

  await expect(renderContent(content.props)).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404"
  );
  await expect(pageDefinition.generateMetadata()).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404"
  );
  expect(isEnabled).toHaveBeenCalledTimes(2);
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
    email: testEmailAddressForAda,
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
        bookedAt: payStateBookedAt,
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

test("loads the checkout account and the page data concurrently", async () => {
  const customerStarted = createDeferred();
  const pageDataStarted = createDeferred();
  // Each load waits for the other to start, so a sequential render times out.
  loadReservationCheckoutAccount.mockImplementationOnce(async () => {
    customerStarted.resolve();
    await pageDataStarted.promise;
    return checkoutAccount;
  });
  const loadPageData = mock(async () => {
    pageDataStarted.resolve();
    await customerStarted.promise;
    return 5;
  });
  const render = mock(
    (context: { readonly pageData: number }): ReactNode =>
      `seats ${context.pageData}`
  );
  const pageDefinition = createReservationPage({
    fallback: () => "loading reservation form",
    kind: "office",
    loadPageData,
    metadata: () => ({ description: "Description", title: "Title" }),
    pathname: "/reservation/office",
    render,
  });

  const content = await withinOneSecond(
    renderContent(
      await pageDefinition.Page({ searchParams: Promise.resolve({}) })
    )
  );

  expect(content).toBe("seats 5");
  expect(loadReservationCheckoutAccount).toHaveBeenCalledWith("office");
  expect(render).toHaveBeenCalledWith(
    expect.objectContaining({ checkoutAccount, locale: "en-US", pageData: 5 })
  );
});

test("reopens the contact details sealed into a sign-in's return path", async () => {
  const contact = {
    name: "Ada Lovelace",
    email: testEmailAddressForAda,
    phone: "+420777777777",
    billing: { purpose: "personal", invoice: "none" },
    marketingConsent: true,
  } as const;
  const token = await Effect.runPromise(
    checkoutContactReturnState.seal(contact)
  );
  const render = mock(
    (_context: { readonly checkoutContact?: unknown }): ReactNode =>
      "contact form"
  );
  const pageDefinition = createReservationPage({
    fallback: () => "loading reservation form",
    kind: "cowork",
    metadata: () => ({ description: "Description", title: "Title" }),
    pathname: "/reservation/cowork",
    render,
  });

  for (const [query, expected] of [
    [{ [checkoutContactQueryParam]: token }, contact],
    [{ [checkoutContactQueryParam]: "not-a-sealed-contact" }, undefined],
    [{}, undefined],
  ] as const) {
    render.mockClear();
    await renderContent(
      await pageDefinition.Page({ searchParams: Promise.resolve(query) })
    );
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      checkoutContact: expected,
    });
  }
});
