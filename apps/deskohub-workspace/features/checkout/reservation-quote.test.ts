import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import type {
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteInput,
} from "@/features/checkout/reservation-quote-cowork";
import type { AppliedDiscount, DiscountQuote } from "@/features/discounts";
import { discountIdSchema } from "@/features/discounts/contracts";
import { coworkAdvertisedPriceDetailsSchema } from "@/features/reservation/cowork-reservation";
import {
  type ReservationOrderData,
  reservationOrderSchema,
} from "@/features/reservation/reservation-order";
import "@/shared/polyfills/temporal";
import { buildReservationQuote } from "./reservation-quote";

const buildQuote = (...args: Parameters<typeof buildReservationQuote>) =>
  Effect.runSync(buildReservationQuote(...args));

const decodeReservation = Schema.decodeUnknownSync(reservationOrderSchema);
const discountId = Schema.decodeUnknownSync(discountIdSchema);
const defaultCustomer = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
} as const;

const coworkReservation = (
  input: {
    readonly entryTier: WorkspaceCoworkProductTier;
    readonly coffee: boolean;
    readonly date?: string;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  },
  customer = defaultCustomer
): ReservationOrderData =>
  decodeReservation({
    kind: "cowork",
    date: "2099-06-10",
    ...customer,
    ...input,
  });

const meetingRoomReservation = (
  duration:
    | { readonly unit: "hour"; readonly amount: 1 | 4 }
    | { readonly unit: "day"; readonly amount: 1 },
  startsAt: string,
  endsAt: string,
  reservationDate = "2099-06-10"
): ReservationOrderData =>
  decodeReservation({
    kind: "meeting-room",
    duration,
    reservationDate,
    ...defaultCustomer,
    startsAt,
    endsAt,
  });

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const discountQuote = (
  applications: readonly AppliedDiscount[]
): DiscountQuote => ({
  product: { kind: "cowork", tier: "open-space" },
  discountableSubtotal: money(29_000),
  discounts: applications,
  totalDiscount: money(
    applications.reduce(
      (total, application) => total + application.amount.value,
      0
    )
  ),
  discountedSubtotal: applications.at(-1)?.subtotalAfter ?? money(29_000),
});

const discountApplication = (
  amount: number,
  overrides: Partial<AppliedDiscount> = {}
): AppliedDiscount => ({
  discount: {
    id: discountId("member-discount"),
    label: "Member discount",
    adjustment: { kind: "fixed", amount: money(amount) },
  },
  subtotalBefore: money(29_000),
  amount: money(amount),
  subtotalAfter: money(29_000 - amount),
  ...overrides,
});

describe("reservation quotes", () => {
  test("builds an access-only quote without a discount section", () => {
    const quote = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: false })
    );

    expect(quote.payment.expectedPrice).toEqual({
      value: 29_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(quote.items).toEqual([
      {
        type: "cowork",
        tier: "open-space",
        amount: { value: 29_000, exponent: 2, currency: "CZK" },
      },
    ]);
  });

  test("charges paid coffee for the Basic non-courtesy tier", () => {
    const quote = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: true })
    );

    expect(quote.items).toEqual([
      {
        type: "cowork",
        tier: "open-space",
        amount: { value: 29_000, exponent: 2, currency: "CZK" },
      },
      {
        type: "coffee",
        amount: { value: 5000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(quote.payment.expectedPrice.value).toBe(34_000);
  });

  test("shows courtesy coffee as a zero CZK line item for included tiers", () => {
    const quote = buildQuote(
      coworkReservation({ entryTier: "reserved-desk", coffee: true })
    );

    expect(quote.items).toEqual([
      {
        type: "cowork",
        tier: "reserved-desk",
        amount: { value: 41_000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(quote.payment.expectedPrice.value).toBe(41_000);
  });

  test("applies generic cowork discounts without discounting paid coffee", () => {
    const application = discountApplication(2000);
    const quote = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: true }),
      {
        discountQuote: discountQuote([application]),
      }
    );

    expect(quote.payment.discounts).toEqual([application]);
    expect(quote.payment.expectedPrice.value).toBe(32_000);
    expect(quote.payment.undiscountedPrice.value).toBe(34_000);
  });

  test("preserves authoritative minor-unit discount amounts", () => {
    const application = discountApplication(4375);
    const quote = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: false }),
      {
        discountQuote: discountQuote([application]),
      }
    );

    expect(quote.payment.expectedPrice.value).toBe(24_625);
    expect(quote.payment.discounts[0]?.amount.value).toBe(4375);
  });

  test("fingerprint changes for different composition with the same total", () => {
    const accessOnly = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: false })
    );
    const coffeeDiscountedToSameTotal = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: true }),
      {
        discountQuote: discountQuote([discountApplication(5000)]),
      }
    );

    expect(accessOnly.payment.expectedPrice.value).toBe(
      coffeeDiscountedToSameTotal.payment.expectedPrice.value
    );
    expect(accessOnly.fingerprint).not.toBe(
      coffeeDiscountedToSameTotal.fingerprint
    );
  });

  test("does not duplicate reservation data in quote output", () => {
    const quote = buildQuote(
      coworkReservation({ entryTier: "open-space", coffee: false })
    );

    expect(quote).not.toHaveProperty("order");
    expect(quote).not.toHaveProperty("reservation");
    expect(quote).not.toHaveProperty("summary");
    expect(quote).not.toHaveProperty("name");
    expect(quote).not.toHaveProperty("email");
    expect(quote).not.toHaveProperty("phone");
  });

  test("monitor composition does not alter the cowork price quote", () => {
    const firstMonitor = buildQuote(
      coworkReservation({
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x32-qhd",
      })
    );
    const secondMonitor = buildQuote(
      coworkReservation({
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x27-qhd",
      })
    );

    expect(firstMonitor).toEqual(secondMonitor);
    expect(firstMonitor.items).not.toContainEqual(
      expect.objectContaining({ type: "monitor" })
    );
  });

  test("ignores customer fields when fingerprinting", () => {
    const firstQuote = buildQuote(
      coworkReservation({ entryTier: "reserved-desk", coffee: true })
    );
    const secondQuote = buildQuote(
      coworkReservation(
        { entryTier: "reserved-desk", coffee: true },
        {
          name: "Grace Hopper",
          email: "grace@example.com",
          phone: "+420606111111",
        }
      )
    );

    expect(secondQuote.fingerprint).toBe(firstQuote.fingerprint);
  });

  test("fingerprints meeting-room price inputs rather than hourly clocks", () => {
    const firstCoworkDate = buildQuote(
      coworkReservation({
        entryTier: "open-space",
        coffee: false,
        date: "2099-06-10",
      })
    );
    const secondCoworkDate = buildQuote(
      coworkReservation({
        entryTier: "open-space",
        coffee: false,
        date: "2099-06-11",
      })
    );
    const morning = buildQuote(
      meetingRoomReservation(
        { unit: "hour", amount: 4 },
        "2099-06-10T07:00:00Z",
        "2099-06-10T11:00:00Z"
      )
    );
    const afternoon = buildQuote(
      meetingRoomReservation(
        { unit: "hour", amount: 4 },
        "2099-06-10T11:00:00Z",
        "2099-06-10T15:00:00Z"
      )
    );

    expect(secondCoworkDate.fingerprint).toBe(firstCoworkDate.fingerprint);
    expect(afternoon.fingerprint).toBe(morning.fingerprint);
  });

  test("prices meeting room reservations by approved duration", () => {
    const oneHour = buildQuote(
      meetingRoomReservation(
        { unit: "hour", amount: 1 },
        "2099-06-10T07:00:00Z",
        "2099-06-10T08:00:00Z"
      )
    );
    const fourHours = buildQuote(
      meetingRoomReservation(
        { unit: "hour", amount: 4 },
        "2099-06-10T07:00:00Z",
        "2099-06-10T11:00:00Z"
      )
    );
    const fullDay = buildQuote(
      meetingRoomReservation(
        { unit: "day", amount: 1 },
        "2099-06-09T22:00:00Z",
        "2099-06-10T22:00:00Z"
      )
    );

    expect(oneHour.items).toEqual([
      {
        type: "meeting-room",
        duration: { unit: "hour", amount: 1 },
        amount: { value: 35_000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(fourHours.payment.expectedPrice.value).toBe(98_000);
    expect(fullDay.payment.expectedPrice.value).toBe(182_000);
  });

  test("applies discounts to meeting-room reservations", () => {
    const reservation = meetingRoomReservation(
      { unit: "hour", amount: 4 },
      "2099-06-10T07:00:00Z",
      "2099-06-10T11:00:00Z"
    );
    const application = discountApplication(10_000, {
      subtotalBefore: money(98_000),
      subtotalAfter: money(88_000),
    });
    const quote = buildQuote(reservation, {
      discountQuote: {
        product: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
        },
        discountableSubtotal: money(98_000),
        discounts: [application],
        totalDiscount: money(10_000),
        discountedSubtotal: money(88_000),
      },
    });

    expect(quote.payment.expectedPrice).toEqual(money(88_000));
    expect(quote.payment.undiscountedPrice).toEqual(money(98_000));
    expect(quote.payment.discounts).toEqual([application]);
  });

  test("prices a DST calendar day as the whole-day product", () => {
    const quote = buildQuote(
      meetingRoomReservation(
        { unit: "day", amount: 1 },
        "2027-03-27T23:00:00Z",
        "2027-03-28T22:00:00Z",
        "2027-03-28"
      )
    );

    expect(quote.items).toEqual([
      {
        type: "meeting-room",
        duration: { unit: "day", amount: 1 },
        amount: money(182_000),
      },
    ]);
  });
});

describe("cowork quote input truthfulness", () => {
  const buildCoworkQuote = (input: CoworkReservationQuoteInput) =>
    Effect.runSync(buildCoworkReservationQuote(input));

  test("does not price the workstation add-on for an empty monitor option", () => {
    const emptyOption = buildCoworkQuote({
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "",
    });
    const absentOption = buildCoworkQuote({
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
    });

    for (const quote of [emptyOption, absentOption]) {
      expect(quote.payment.expectedPrice.value).toBe(41_000);
      expect(quote.items).not.toContainEqual(
        expect.objectContaining({ type: "workstation" })
      );
    }
  });

  test("prices the workstation add-on only for a real monitor selection", () => {
    const quote = buildCoworkQuote({
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    });

    expect(quote.items).toContainEqual({
      type: "workstation",
      amount: { value: 12_000, exponent: 2, currency: "CZK" },
    });
    expect(quote.payment.expectedPrice.value).toBe(53_000);
  });

  test("requires the canonical cowork kind in the quote input", () => {
    const decodeDetails = Schema.decodeUnknownSync(
      coworkAdvertisedPriceDetailsSchema
    );

    expect(() =>
      decodeDetails({
        entryTier: "reserved-desk",
        workstation: true,
        date: "2099-06-10",
      })
    ).toThrow();

    expect(() =>
      decodeDetails({
        kind: "cowork",
        entryTier: "reserved-desk",
        workstation: true,
        date: "2099-06-10",
      })
    ).not.toThrow();
  });

  test("rejects quote building without the canonical cowork kind", () => {
    const buildQuoteWithoutKind = (
      input: Omit<CoworkReservationQuoteInput, "kind">
    ) => Effect.runSync(buildCoworkReservationQuote(input as never));

    expect(() =>
      buildQuoteWithoutKind({
        entryTier: "reserved-desk",
        coffee: true,
        workstation: true,
      })
    ).toThrow();
    expect(() =>
      buildQuoteWithoutKind({
        kind: "residency",
        entryTier: "reserved-desk",
        coffee: true,
        workstation: true,
      } as Omit<CoworkReservationQuoteInput, "kind">)
    ).toThrow();
  });

  test("rejects wrong-family kinds at the cowork builder boundary", () => {
    // Cast past TypeScript the way a runtime bug would: a dishonest input
    // that claims to satisfy CoworkReservationQuoteInput.
    const buildWrongFamilyQuote = (
      input: Omit<CoworkReservationQuoteInput, "kind"> & {
        kind: "office" | "meeting-room";
      }
    ) => Effect.runSync(buildCoworkReservationQuote(input as never));

    expect(() =>
      buildWrongFamilyQuote({
        kind: "office",
        entryTier: "reserved-desk",
        workstation: true,
      })
    ).toThrow();
    expect(() =>
      buildWrongFamilyQuote({
        kind: "meeting-room",
        entryTier: "reserved-desk",
        duration: { unit: "hour", amount: 1 },
      })
    ).toThrow();
  });

  test("typechecks the required cowork kind discriminator", () => {
    expect(() =>
      Effect.runSync(
        // @ts-expect-error The canonical cowork kind discriminator is required
        // in CoworkReservationQuoteInput.
        buildCoworkReservationQuote({
          entryTier: "reserved-desk",
          coffee: true,
          workstation: true,
        })
      )
    ).toThrow();
  });
});
