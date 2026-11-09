import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Deferred, Effect, Schema } from "effect";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { PreloadedAdvertisedPrice } from "@/features/checkout/advertised-price";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { recordReservationPagePreloads } from "@/features/reservation/backend/reservation-page-preloads.service.mock";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import {
  type NormalizedCoworkReservationOrder,
  normalizedCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import type {
  CustomerLastReservationForKind,
  ReservationCheckoutAccount,
} from "@/features/reservation/reservation-existing-customer";
import type { PreloadedWorkspaceAvailability } from "@/features/reservation/workspace-availability";
import { getOfficeAvailabilityQuery } from "@/features/reservation/workspace-availability";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { getSearchParam, type SearchParamsRecord } from "@/shared/utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import type {
  ReservationPageForm,
  ReservationPageRestoration,
} from "./create-reservation-page.server";

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

// Office reservations are released unless a test closes the gate.
let officePageEnabled = true;
const isOfficePageEnabled = mock(() => Promise.resolve(officePageEnabled));
const officeFeatureFlag = await import(
  "@/features/office/backend/office-release-gate.server"
);
mock.module("@/features/office/backend/office-release-gate.server", () => ({
  ...officeFeatureFlag,
  isOfficePageEnabled,
  OfficeReleaseGateRequest: OfficeReleaseGate.fromEvaluation(
    Effect.promise(isOfficePageEnabled)
  ),
}));
beforeEach(() => {
  officePageEnabled = true;
});

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

type FakeValues = {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
  readonly selection: string;
};

const restoredValues: FakeValues = {
  email: testEmailAddressForAda,
  name: "Ada Lovelace",
  phone: "+420777777777",
  selection: "restored",
};

/**
 * A family whose selection is one `selection` link parameter and whose
 * restore outcome a test picks.
 */
const createFakeFamily = (
  restoration: ReservationPageRestoration<FakeValues>["kind"] = "restored"
) => ({
  fallback: mock((_locale: string): ReactNode => "loading reservation form"),
  kind: "cowork" as const,
  pathname: "/reservation/cowork" as const,
  prefillsContact: true,
  restore: mock(
    (
      _reservation: NormalizedCoworkReservationOrder,
      searchParams: SearchParamsRecord,
      _scope: { readonly locale: string; readonly today: string }
    ): ReservationPageRestoration<FakeValues> => {
      if (restoration === "ended") return { kind: "ended" };
      if (restoration === "replaced") {
        return { kind: "replaced", content: "offer replaced" };
      }
      return {
        kind: "restored",
        values: {
          ...restoredValues,
          selection:
            getSearchParam(searchParams, "selection") ??
            restoredValues.selection,
        },
      };
    }
  ),
  read: mock(
    (
      searchParams: SearchParamsRecord,
      _scope: {
        readonly lastReservation:
          | CustomerLastReservationForKind<"cowork">
          | undefined;
        readonly today: string;
      }
    ) =>
      Effect.succeed<FakeValues>({
        email: getSearchParam(searchParams, "email") ?? "",
        name: getSearchParam(searchParams, "name") ?? "",
        phone: getSearchParam(searchParams, "phone") ?? "",
        selection: getSearchParam(searchParams, "selection") ?? "default",
      })
  ),
  preload: mock(
    (
      values: FakeValues,
      { locale, today }: { readonly locale: Locale; readonly today: string }
    ) => ({
      advertisedPrices: getCoworkDateAdvertisedPriceRequests({
        date: values.selection === "default" ? today : "2099-08-01",
        locale,
      }),
      availability: [getOfficeAvailabilityQuery(today)],
    })
  ),
  offerings: mock(
    (
      _values: FakeValues,
      _advertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>
    ): ReadonlyArray<PublicPriceListOffering> => []
  ),
  renderForm: mock(
    (form: ReservationPageForm<number | undefined, FakeValues>): ReactNode =>
      `form ${form.initialValues.selection}`
  ),
});

/** A family without preloads, for pages that run the live preloads. */
const createPreloadFreeFamily = () => ({
  ...createFakeFamily(),
  preload: () => ({ advertisedPrices: [], availability: [] }),
});

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

const { buildSignedPayState, sealPayState } = await import(
  "@/features/checkout/backend/checkout/pay-state"
);

const signedCoworkReservation = Schema.decodeUnknownSync(
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

/** A sealed Pay state for the signed cowork reservation. */
const sealCoworkPayState = (requestedDiscountCode?: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const quote = yield* buildCoworkReservationQuote({
        kind: "cowork",
        entryTier: signedCoworkReservation.entryTier,
        date: signedCoworkReservation.date,
        coffee: signedCoworkReservation.coffee,
      });
      const state = yield* buildSignedPayState({
        locale: "en-US",
        reservation: signedCoworkReservation,
        quote,
        orderId: "reservation-id",
        bookedAt: payStateBookedAt,
        checkoutSessionId: "session-id",
        ...(requestedDiscountCode && {
          requestedDiscountCode: Schema.decodeUnknownSync(
            canonicalPromotionCodeSchema
          )(requestedDiscountCode),
        }),
      });
      return yield* sealPayState(state);
    }).pipe(Effect.provide(TestSealedStateKeys))
  );

test("renders the reservation shell before request-bound content resolves", async () => {
  const family = createFakeFamily();
  const searchParams = new Promise<Record<string, string>>(() => undefined);
  const pageDefinition = createReservationPage(family);

  const page = await pageDefinition.Page({
    searchParams,
  });

  expect(family.renderForm).not.toHaveBeenCalled();
  expect(family.fallback).toHaveBeenCalledWith("en-US");
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

test("gates a page by its registry release gate inside its content, keeping the shell static", async () => {
  officePageEnabled = false;
  isOfficePageEnabled.mockClear();
  const family = {
    ...createFakeFamily(),
    kind: "office" as const,
    pathname: "/reservation/office" as const,
  };
  const pageDefinition = createReservationPage(family);

  const page = await pageDefinition.Page({
    searchParams: Promise.resolve({}),
  });

  expect(isOfficePageEnabled).not.toHaveBeenCalled();
  expect(family.fallback).toHaveBeenCalledWith("en-US");

  await expect(renderContent(page)).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404"
  );
  await expect(pageDefinition.generateMetadata()).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404"
  );
  expect(isOfficePageEnabled).toHaveBeenCalledTimes(2);
  expect(family.renderForm).not.toHaveBeenCalled();
});

test("prefers the signed requested discount code over a fresh public query code", async () => {
  const { loadRestoredReservation } = await import(
    "./create-reservation-page.server"
  );
  const token = await sealCoworkPayState("CAMPAIGN10");
  const restored = await Effect.runPromise(
    loadRestoredReservation(token, "en-US", "cowork")
  );

  expect(restored).toMatchObject({
    submittedCode: "CAMPAIGN10",
    replacementToken: token,
  });
});

test("keeps a restored checkout's discount intent, even none, over the query code", async () => {
  const family = createPreloadFreeFamily();
  const page = createReservationPage(family);
  const token = await sealCoworkPayState();

  await renderContent(
    await page.Page({
      searchParams: Promise.resolve({
        discountCode: "summer10",
        payState: token,
        selection: "edited",
      }),
    })
  );
  await renderContent(
    await page.Page({
      searchParams: Promise.resolve({ discountCode: "summer10" }),
    })
  );

  const [restoredForm, freshForm] = family.renderForm.mock.calls.map(
    ([form]) => form
  );
  expect(family.restore.mock.calls[0]?.[0]).toEqual(signedCoworkReservation);
  expect(restoredForm).toMatchObject({
    checkoutSessionId: "session-id",
    initialValues: { selection: "edited" },
    replacementToken: token,
    submittedCode: undefined,
  });
  expect(freshForm).toMatchObject({
    checkoutSessionId: undefined,
    replacementToken: undefined,
    submittedCode: "SUMMER10",
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
  const family = {
    ...createPreloadFreeFamily(),
    kind: "office" as const,
    loadPageData,
    pathname: "/reservation/office" as const,
  };
  const pageDefinition = createReservationPage(family);

  await withinOneSecond(
    renderContent(
      await pageDefinition.Page({ searchParams: Promise.resolve({}) })
    )
  );

  expect(loadReservationCheckoutAccount).toHaveBeenCalledWith("office");
  expect(family.renderForm).toHaveBeenCalledWith(
    expect.objectContaining({
      checkoutCustomer: expect.objectContaining({ status: "linked" }),
      locale: "en-US",
      pageData: 5,
    })
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
  const sealUnder = (locale: Locale, phone: string) =>
    Effect.runPromise(
      checkoutContactReturnState
        .seal({ ...contact, phone }, locale)
        .pipe(Effect.provide(TestSealedStateKeys))
    );
  const token = await sealUnder("en-US", contact.phone);
  // Typed on a de-DE page, then reopened on this en-US one, which reads a
  // national number as a Czech one.
  const germanToken = await sealUnder("de-DE", "0151 23456789");
  const family = createPreloadFreeFamily();
  const pageDefinition = createReservationPage(family);

  for (const [query, expected] of [
    [{ [checkoutContactQueryParam]: token }, contact],
    [
      { [checkoutContactQueryParam]: germanToken },
      { ...contact, phone: "+49 1512 3456789" },
    ],
    [{ [checkoutContactQueryParam]: "not-a-sealed-contact" }, { name: "" }],
    [{}, { name: "" }],
  ] as const) {
    family.renderForm.mockClear();
    await renderContent(
      await pageDefinition.Page({ searchParams: Promise.resolve(query) })
    );
    expect(family.renderForm.mock.calls[0]?.[0]).toMatchObject({
      initialValues: expected,
    });
  }
});

describe("the reservation page recipe", () => {
  const lastReservation = {
    kind: "cowork",
    entryTier: "open-space",
    coffee: true,
  } as const satisfies CustomerLastReservationForKind<"cowork">;
  const linkedAccount: ReservationCheckoutAccount<"cowork"> = {
    status: "linked",
    customer: { ...checkoutAccount.customer, lastReservation },
  };
  const restoredReservation = {
    checkoutSessionId: checkoutSessionIdSchema.make("session-id"),
    replacementToken: "signed-pay-state",
    reservation: signedCoworkReservation,
  };

  const loadContent = async (
    family: ReturnType<typeof createFakeFamily>,
    request: {
      readonly checkoutAccount?: ReservationCheckoutAccount<"cowork">;
      readonly restoredReservation?: typeof restoredReservation;
      readonly searchParams?: SearchParamsRecord;
    },
    preloads = recordReservationPagePreloads()
  ) => {
    const content = await Effect.runPromise(
      createReservationPage(family)
        .loadContent({
          checkoutAccount: request.checkoutAccount ?? { status: "signed-out" },
          locale: "en-US",
          pageData: undefined,
          restoredReservation: request.restoredReservation,
          searchParams: request.searchParams ?? {},
        })
        .pipe(Effect.provide(preloads.layer))
    );
    return { content, preloads };
  };

  const loadForm = async (...input: Parameters<typeof loadContent>) => {
    const { content, preloads } = await loadContent(...input);
    if (content.kind !== "form") throw new Error("Expected the form");
    return { ...content, preloads };
  };

  test("reopens the family's restored selection with the URL beside its token", async () => {
    const family = createFakeFamily("restored");
    const searchParams = { payState: "signed-pay-state", selection: "edited" };

    const { form, preloads } = await loadForm(family, {
      restoredReservation,
      searchParams,
    });

    expect(family.restore).toHaveBeenCalledWith(
      signedCoworkReservation,
      searchParams,
      expect.objectContaining({ locale: "en-US", today: expect.any(String) })
    );
    expect(family.read).not.toHaveBeenCalled();
    expect(form).toMatchObject({
      checkoutSessionId: "session-id",
      initialValues: { ...restoredValues, selection: "edited" },
      replacementToken: "signed-pay-state",
    });
    expect(preloads.availabilityPreloads[0]?.replacementToken).toBe(
      "signed-pay-state"
    );
  });

  test("opens an ended reservation as an empty link that continues its checkout", async () => {
    const family = createFakeFamily("ended");

    const { form } = await loadForm(family, {
      checkoutAccount: linkedAccount,
      restoredReservation,
      searchParams: {
        customer: "contact",
        name: "Query Override",
        payState: "signed-pay-state",
        selection: "from-query",
      },
    });

    expect(family.read).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ lastReservation })
    );
    expect(form).toMatchObject({
      checkoutCustomer: {
        status: "linked",
        existingCustomer: { initialMode: "account" },
      },
      checkoutSessionId: "session-id",
      initialValues: { selection: "default" },
      replacementToken: "signed-pay-state",
    });
  });

  test("shows the family's replacement for an offer that no longer exists, preloading nothing", async () => {
    const family = createFakeFamily("replaced");

    const { content, preloads } = await loadContent(family, {
      restoredReservation,
    });

    expect(content).toEqual({ kind: "replaced", content: "offer replaced" });
    expect(family.read).not.toHaveBeenCalled();
    expect(preloads.advertisedPriceRequests).toHaveLength(0);
    expect(preloads.availabilityPreloads).toHaveLength(0);
  });

  test("lets a link's contact choose the contact step only where the family prefills it", async () => {
    const initialMode = async (
      prefillsContact: boolean,
      searchParams: SearchParamsRecord
    ) => {
      const { form } = await loadForm(
        { ...createFakeFamily(), prefillsContact },
        { checkoutAccount: linkedAccount, searchParams }
      );
      return form.checkoutCustomer.status === "linked"
        ? form.checkoutCustomer.existingCustomer.initialMode
        : undefined;
    };

    expect(await initialMode(true, { name: "Grace Hopper" })).toBe("contact");
    expect(await initialMode(false, { name: "Grace Hopper" })).toBe("account");
    expect(await initialMode(false, { customer: "contact" })).toBe("contact");
  });

  test("preloads prices and availability side by side and prices the offerings from them", async () => {
    const pricesStarted = Effect.runSync(Deferred.make<void>());
    const availabilityStarted = Effect.runSync(Deferred.make<void>());
    const seededPrices: ReadonlyArray<PreloadedAdvertisedPrice> = [];
    const seededAvailability: ReadonlyArray<PreloadedWorkspaceAvailability> =
      [];
    const preloads = recordReservationPagePreloads({
      // Each group waits for the other to start, so sequential preloads hang.
      advertisedPrices: () =>
        Deferred.succeed(pricesStarted, undefined).pipe(
          Effect.andThen(Deferred.await(availabilityStarted)),
          Effect.as(seededPrices)
        ),
      availability: () =>
        Deferred.succeed(availabilityStarted, undefined).pipe(
          Effect.andThen(Deferred.await(pricesStarted)),
          Effect.as(seededAvailability)
        ),
    });
    const family = createFakeFamily();

    const { form } = await withinOneSecond(
      loadForm(family, { searchParams: { selection: "linked" } }, preloads)
    );

    expect(preloads.advertisedPriceRequests).toEqual([
      family.preload.mock.results[0]?.value.advertisedPrices,
    ]);
    expect(form.initialAdvertisedPrices).toBe(seededPrices);
    expect(form.initialAvailability).toBe(seededAvailability);
    expect(family.offerings).toHaveBeenCalledWith(
      expect.objectContaining({ selection: "linked" }),
      seededPrices,
      expect.objectContaining({ locale: "en-US" })
    );
  });
});
