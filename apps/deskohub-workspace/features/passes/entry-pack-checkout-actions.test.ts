import { expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Result, Schema } from "effect";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import {
  makeFakeSavedLocalePreference,
  syntheticSessionCookie,
} from "@/features/account/backend/saved-locale-preference.test-utils";
import { LatePaymentVerificationService } from "@/features/checkout/backend/payment/late-payment-verification.service";
import { PaymentProviders } from "@/features/checkout/backend/payment/payment-provider";
import { type Locale, m } from "@/features/i18n";
import { getLocale } from "@/features/i18n/paraglide/runtime.js";
import { type OrderId, orderIdSchema } from "@/features/order";
import { currencyCZK } from "@/shared/money/currencies";
import { fixtureReservationAuthorId as accountId } from "@/shared/testing/workspace-fixtures.test-utils";
import { passPurchaseQuoteCodec } from "./pass-purchase-quote";

const requestHeaders = new AsyncLocalStorage<Headers>();
mock.module("next/headers", () => ({
  headers: async () => requestHeaders.getStore() ?? new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const item = requestHeaders
        .getStore()
        ?.get("cookie")
        ?.split("; ")
        .find((cookie) => cookie.startsWith(`${name}=`));
      return item ? { name, value: item.slice(name.length + 1) } : undefined;
    },
  }),
}));

const reader = makeFakeSavedLocalePreference();
mock.module("@/features/account/server/saved-locale-preference.server", () => ({
  savedLocalePreference: reader.savedLocalePreference,
}));

const buyerEmail = testEmailAddress("entry-pack-action-buyer");
Object.defineProperty(CurrentCustomerAccount, "Live", {
  value: Layer.mock(CurrentCustomerAccount, {
    requireActive: Effect.succeed({
      accountId,
      email: buyerEmail,
      deletionRequested: false,
      ...testSessionProfile,
    }),
  }),
});

const issuedOrders = new Map<OrderId, Locale>();
const entryPackOrders = await import("./backend/entry-pack-order");
const readOwnedLocale = mock((orderId: OrderId) =>
  Effect.succeed(issuedOrders.get(orderId))
);
mock.module("./backend/entry-pack-order", () => ({
  ...entryPackOrders,
  readOwnedPassPurchaseOrderLocale: readOwnedLocale,
}));

const amount = currencyCZK(115_000);
const observedLocales = mock((_locale: Locale) => {});
const observeProviders = mock((_providers: readonly string[]) => {});
const purchase = await import("./backend/entry-pack-purchase");
mock.module("./backend/entry-pack-purchase", () => ({
  ...purchase,
  beginEntryPackPurchase: (
    input: Parameters<typeof purchase.beginEntryPackPurchase>[0]
  ) =>
    Effect.sync(() => {
      issuedOrders.set(input.orderId, input.locale);
      return {
        locale: input.locale,
        tier: input.product.tier,
        entryCount: input.product.size,
        validFrom: Temporal.PlainDate.from("2026-11-20"),
        validUntil: Temporal.PlainDate.from("2027-01-19"),
        quote: Schema.encodeSync(passPurchaseQuoteCodec)({
          product: input.product,
          discountableSubtotal: amount,
          discountedSubtotal: amount,
          totalDiscount: currencyCZK(0),
          discounts: [],
        }),
      };
    }),
  payForEntryPack: (input: Parameters<typeof purchase.payForEntryPack>[0]) =>
    Effect.gen(function* () {
      const providers = yield* PaymentProviders;
      yield* LatePaymentVerificationService;
      observeProviders(providers.activeProviders);
      observedLocales(getLocale());
      if (!issuedOrders.has(input.orderId)) {
        return yield* new purchase.EntryPackPurchaseError({
          reason: "unavailable",
        });
      }
      return { status: "pending", statusUrl: "/fixture/status" };
    }),
}));

const unlimited = await import("./backend/unlimited-pass-purchase");
const unlimitedFailures = new Map<OrderId, Error>();
const beginUnlimited = mock(
  (input: Parameters<typeof unlimited.beginUnlimitedPassPurchase>[0]) =>
    Effect.sync(() => ({
      outcome: Result.fail(unlimitedFailures.get(input.orderId)!),
      retiredPredecessorOrderIds: input.supersedeOrderIds?.slice(1) ?? [],
    }))
);
mock.module("./backend/unlimited-pass-purchase", () => ({
  ...unlimited,
  beginUnlimitedPassPurchase: beginUnlimited,
}));

const { beginEntryPackCheckout, beginUnlimitedCheckout, payEntryPackCheckout } =
  await import("./entry-pack-checkout-actions");

const withoutReferer = <A>(action: () => A) =>
  requestHeaders.run(
    new Headers({
      cookie: `${syntheticSessionCookie}; PARAGLIDE_LOCALE=cs-CZ`,
    }),
    action
  );

test("Details issues an order and in-place Pay uses its verified locale without Referer", async () => {
  const orderId = crypto.randomUUID();
  reader.fake.savedPreference = "en-US";
  expect(issuedOrders.size).toBe(0);

  const begin = await withoutReferer(() =>
    beginEntryPackCheckout({
      locale: "en-US",
      orderId,
      buyerEmail,
      product: { kind: "entry-pack", tier: "open-space", size: 5 },
    })
  );
  const ready = begin.data;
  expect(ready?.status).toBe("ready");
  if (ready?.status !== "ready")
    throw new Error("Details did not issue a Pay snapshot");

  reader.fake.savedPreference = "cs-CZ";
  const pay = {
    locale: "cs-CZ" as const,
    orderId,
    accepted: true,
    acceptedDocuments: ready.disclosure.documents,
    displayedPriceFingerprint: ready.price.fingerprint,
    billing: { purpose: "personal", invoice: "none" } as const,
  };
  const owned = await withoutReferer(() => payEntryPackCheckout(pay));
  expect(owned.data).toEqual({
    status: "pending",
    statusUrl: "/fixture/status",
  });
  expect(observedLocales).toHaveBeenLastCalledWith("en-US");
  expect(observeProviders).toHaveBeenCalledWith(["nexi"]);

  const foreign = await withoutReferer(() =>
    payEntryPackCheckout({
      ...pay,
      orderId: crypto.randomUUID(),
      locale: "en-US",
    })
  );
  expect(foreign.data).toEqual({
    status: "purchase_error",
    reason: "unavailable",
  });
  expect(observedLocales).toHaveBeenLastCalledWith("cs-CZ");

  const lookups = readOwnedLocale.mock.calls.length;
  const malformed = await withoutReferer(() =>
    payEntryPackCheckout({ ...pay, orderId: "malformed" })
  );
  expect(malformed.validationErrors?.fieldErrors.orderId).toBeDefined();
  expect(readOwnedLocale).toHaveBeenCalledTimes(lookups);
});

test.each([undefined, "", " \t "])(
  "Unlimited Continue rejects a missing or blank gift name before beginning checkout (%p)",
  async (recipientName) => {
    const calls = beginUnlimited.mock.calls.length;
    const result = await withoutReferer(() =>
      beginUnlimitedCheckout({
        locale: "en-US",
        orderId: orderIdSchema.make(crypto.randomUUID()),
        buyerEmail,
        holderEmail: testEmailAddress("unlimited-action-holder"),
        selection: { tier: "reserved-desk", startDate: "2026-11-20" },
        ...(recipientName !== undefined && { recipientName }),
      })
    );
    expect(result.validationErrors?.fieldErrors.recipientName).toEqual([
      m.unlimitedPassRecipientNameRequired({}, { locale: "cs-CZ" }),
    ]);
    expect(beginUnlimited).toHaveBeenCalledTimes(calls);
  }
);

test("Unlimited Continue normalizes a gift name without returning it", async () => {
  const orderId = orderIdSchema.make(crypto.randomUUID());
  const recipientName = "李";
  unlimitedFailures.set(
    orderId,
    new purchase.EntryPackPurchaseError({ reason: "holds-unavailable" })
  );
  const result = await withoutReferer(() =>
    beginUnlimitedCheckout({
      locale: "en-US",
      orderId,
      buyerEmail,
      holderEmail: testEmailAddress("unlimited-action-holder"),
      selection: { tier: "reserved-desk", startDate: "2026-11-20" },
      recipientName: `  ${recipientName}  `,
    })
  );
  expect(beginUnlimited.mock.calls.at(-1)?.[0].recipientName).toBe(
    recipientName
  );
  expect(result.data).toMatchObject({
    status: "purchase_error",
    reason: "holds-unavailable",
  });
  expect(JSON.stringify(result)).not.toContain(recipientName);
});

test("Unlimited Continue passes the validated renewal source to purchase admission", async () => {
  const orderId = orderIdSchema.make(crypto.randomUUID());
  const renewsPassId = orderIdSchema.make(crypto.randomUUID());
  unlimitedFailures.set(
    orderId,
    new purchase.EntryPackPurchaseError({ reason: "holds-unavailable" })
  );
  const input = {
    locale: "en-US",
    orderId,
    buyerEmail,
    renewsPassId,
    selection: { tier: "reserved-desk", startDate: "2026-11-20" },
  } as const;
  await withoutReferer(() => beginUnlimitedCheckout(input));
  expect(beginUnlimited.mock.calls.at(-1)?.[0]).toMatchObject({ renewsPassId });
  const calls = beginUnlimited.mock.calls.length;
  const response = await withoutReferer(() =>
    beginUnlimitedCheckout({ ...input, renewsPassId: "invalid" })
  );
  expect(response.validationErrors?.fieldErrors.renewsPassId).toBeDefined();
  expect(beginUnlimited).toHaveBeenCalledTimes(calls);
});

test.each([
  {
    error: new purchase.EntryPackPurchaseError({ reason: "holds-unavailable" }),
    response: { status: "purchase_error", reason: "holds-unavailable" },
  },
  {
    error: new Error("Synthetic late Continue failure"),
    response: { status: "purchase_error", reason: "unavailable" },
  },
  {
    error: Object.assign(new Error("Synthetic cutoff void"), {
      _tag: "UnlimitedPassDraftVoided",
      blockingDates: ["2026-11-20"],
    }),
    response: { status: "draft_voided", blockingDates: ["2026-11-20"] },
  },
])(
  "Unlimited Continue returns durable predecessor acknowledgements for $error.message",
  async ({ error, response }) => {
    const orderId = orderIdSchema.make(crypto.randomUUID());
    const predecessorOrderIds = Array.from({ length: 8 }, () =>
      orderIdSchema.make(crypto.randomUUID())
    );
    unlimitedFailures.set(orderId, error);
    const result = await withoutReferer(() =>
      beginUnlimitedCheckout({
        locale: "en-US",
        orderId,
        buyerEmail,
        selection: { tier: "reserved-desk", startDate: "2026-11-20" },
        supersedeOrderIds: predecessorOrderIds,
      })
    );
    expect(result.data).toEqual({
      ...response,
      retiredPredecessorOrderIds: predecessorOrderIds.slice(1),
    });
  }
);
