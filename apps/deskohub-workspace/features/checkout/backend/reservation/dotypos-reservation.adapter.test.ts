import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { checkoutDetailsSchema } from "@/features/checkout/schemas/checkout-details";
import { discountIdSchema } from "@/features/discounts/contracts";
import { type Locale, locales } from "@/features/i18n";
import { formatMoney, moneyWithValue } from "@/shared/money/money";
import {
  createWorkspaceDotyposReservation,
  formatWorkspaceReservationNote,
  noteNamesPaymentOrder,
} from "./dotypos-reservation.adapter";
import {
  type IWorkspaceTableAssignmentService,
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

const checkoutDetails = Schema.decodeUnknownSync(checkoutDetailsSchema)({
  locale: "en-US",
  reservation: {
    kind: "cowork",
    entryTier: "basic",
    date: "2099-06-10",
    coffee: false,
  },
  payment: {
    expectedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
    undiscountedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
    discounts: [],
    summary: {
      sections: [],
      total: { value: 35_000, exponent: 2, currency: "CZK" },
    },
  },
  legal: {},
});

const makeMeetingRoomCheckoutDetails = (earlySetup: boolean) =>
  Schema.decodeUnknownSync(checkoutDetailsSchema)({
    locale: "en-US",
    reservation: {
      kind: "meeting-room",
      duration: { unit: "hour", amount: 1 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T09:00:00Z",
      ...(earlySetup && { earlySetup: true }),
    },
    payment: {
      expectedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
      undiscountedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
      discounts: [],
      items: [
        {
          type: "meeting-room",
          duration: { unit: "hour", amount: 1 },
          amount: { value: 35_000, exponent: 2, currency: "CZK" },
        },
      ],
    },
    legal: {},
  });

const createMeetingRoomDotyposInput = async (earlySetup: boolean) => {
  const reservation = {
    kind: "meeting-room" as const,
    duration: { unit: "hour" as const, amount: 1 as const },
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T09:00:00Z",
    ...(earlySetup && { earlySetup: true }),
  };
  const assignTableId = mock(() => Effect.succeed("meeting-room-id"));
  const createReservation = mock(() =>
    Effect.succeed({ id: "dotypos-reservation-id" } as never)
  );
  const testLayer = Layer.mergeAll(
    Layer.mock(WorkspaceTableAssignmentService, {
      assignTableId,
    } satisfies IWorkspaceTableAssignmentService),
    Layer.mock(DotyposService, { createReservation })
  );

  await createWorkspaceDotyposReservation({
    paymentOrderId: "payment-order-id",
    dotyposCustomerId: "dotypos-customer-id",
    checkoutDetails: makeMeetingRoomCheckoutDetails(earlySetup),
    reservation,
    status: "NEW",
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  return createReservation.mock.calls[0]![0];
};

describe("createWorkspaceDotyposReservation", () => {
  test("uses the cowork reservation domain interval for creation", async () => {
    const reservation = {
      kind: "cowork" as const,
      entryTier: "basic" as const,
      date: "2099-06-10",
      coffee: false,
    };
    const assignTableId = mock(() => Effect.succeed("cowork-table-id"));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const testLayer = Layer.mergeAll(
      Layer.mock(WorkspaceTableAssignmentService, {
        assignTableId,
      } satisfies IWorkspaceTableAssignmentService),
      Layer.mock(DotyposService, {
        createReservation,
      })
    );

    await createWorkspaceDotyposReservation({
      paymentOrderId: "payment-order-id",
      dotyposCustomerId: "dotypos-customer-id",
      checkoutDetails,
      reservation,
      status: "NEW",
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(assignTableId).toHaveBeenCalledWith(reservation);
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date("2099-06-09T22:00:00Z"),
        endDate: new Date("2099-06-10T22:00:00Z"),
      })
    );
  });

  test("creates an early-setup meeting-room reservation from 15 minutes before its start", async () => {
    const input = await createMeetingRoomDotyposInput(true);

    expect(input.startDate).toEqual(new Date("2099-06-10T07:45:00Z"));
    expect(input.endDate).toEqual(new Date("2099-06-10T09:00:00Z"));
    expect(input.note.split("\n").some((line) => line.endsWith("09:45"))).toBe(
      true
    );
  });

  test("keeps a meeting-room reservation start unchanged without early setup", async () => {
    const input = await createMeetingRoomDotyposInput(false);

    expect(input.startDate).toEqual(new Date("2099-06-10T08:00:00Z"));
    expect(input.endDate).toEqual(new Date("2099-06-10T09:00:00Z"));
    expect(input.note.split("\n").some((line) => line.endsWith("09:45"))).toBe(
      false
    );
  });
});

const summerSale = {
  discount: {
    id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
    label: "Letní sleva",
    adjustment: { kind: "percentage" as const, basisPoints: 1000 },
  },
  subtotalBefore: { value: 35_000, exponent: 2, currency: "CZK" },
  amount: { value: 3500, exponent: 2, currency: "CZK" },
  subtotalAfter: { value: 31_500, exponent: 2, currency: "CZK" },
};

const meetingRoomDuration = { unit: "hour" as const, amount: 2 as const };

const noteReservations = {
  cowork: {
    kind: "cowork",
    entryTier: "profi",
    date: "2099-06-10",
    coffee: true,
    monitorOption: "2x27-4k",
  },
  "meeting-room": {
    kind: "meeting-room",
    duration: meetingRoomDuration,
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T10:00:00Z",
    earlySetup: true,
  },
  office: {
    kind: "office",
    startsOn: "2099-06-10",
    endsOn: "2099-06-12",
    seats: 3,
  },
} satisfies Record<
  WorkspaceTableAssignmentReservation["kind"],
  WorkspaceTableAssignmentReservation
>;

const formatNote = (
  locale: Locale,
  reservation: WorkspaceTableAssignmentReservation
) =>
  formatWorkspaceReservationNote({
    paymentOrderId: "payment-order-id",
    reservation,
    checkoutDetails: {
      ...checkoutDetails,
      locale,
      payment: { ...checkoutDetails.payment, discounts: [summerSale] },
    },
  });

describe("formatWorkspaceReservationNote", () => {
  test.each(Object.values(noteReservations))(
    "writes the same $kind note for staff whatever the checkout locale",
    (reservation) => {
      const staffNote = formatNote("cs-CZ", reservation);

      for (const locale of locales) {
        expect(formatNote(locale, reservation)).toBe(staffNote);
      }
    }
  );

  test("names products, durations and amounts in Czech for an English checkout", () => {
    const coworkNote = formatNote("en-US", noteReservations.cowork);
    const meetingRoomNote = formatNote(
      "en-US",
      noteReservations["meeting-room"]
    );
    const officeNote = formatNote("en-US", noteReservations.office);

    expect(coworkNote).toContain(
      getWorkspaceProductTierTitle("profi", "cs-CZ")
    );
    expect(coworkNote).toContain(
      getWorkspaceProductMonitorTitle("2x27-4k", "cs-CZ")
    );
    expect(meetingRoomNote).toContain(
      getWorkspaceMeetingRoomProductTitle("cs-CZ")
    );
    expect(meetingRoomNote).toContain(
      getWorkspaceMeetingRoomDurationLabel(meetingRoomDuration, "cs-CZ")
    );
    expect(officeNote).toContain(getWorkspaceOfficeProductTitle("cs-CZ"));
    expect(officeNote).toContain(
      formatMoney(checkoutDetails.payment.expectedPrice, "cs-CZ")
    );
    expect(officeNote).toContain(
      formatMoney(moneyWithValue(-3500, summerSale.amount), "cs-CZ")
    );
  });

  test("names the discount by its staff label for a non-Czech checkout", () => {
    const germanSale = {
      ...summerSale,
      discount: {
        ...summerSale.discount,
        label: "Sommerrabatt",
        staffLabel: "Letní sleva",
      },
    };
    const note = formatWorkspaceReservationNote({
      paymentOrderId: "payment-order-id",
      reservation: noteReservations.office,
      checkoutDetails: {
        ...checkoutDetails,
        locale: "de-DE",
        payment: { ...checkoutDetails.payment, discounts: [germanSale] },
      },
    });

    expect(note).toContain(germanSale.discount.staffLabel);
    expect(note).not.toContain(germanSale.discount.label);
  });

  test("names the discount by its checkout label when an older snapshot has no staff label", () => {
    const note = formatNote("en-US", noteReservations.office);

    expect(summerSale.discount).not.toHaveProperty("staffLabel");
    expect(note).toContain(summerSale.discount.label);
  });

  test("lets late-payment recovery find a note by its payment order", () => {
    const note = formatNote("en-US", noteReservations.office);

    expect(noteNamesPaymentOrder(note, "payment-order-id")).toBe(true);
    expect(noteNamesPaymentOrder(note, "other-payment-order-id")).toBe(false);
    expect(noteNamesPaymentOrder(undefined, "payment-order-id")).toBe(false);
    expect(noteNamesPaymentOrder(null, "payment-order-id")).toBe(false);
  });

  test("finds notes written before staff notes were Czech", () => {
    expect(
      noteNamesPaymentOrder(
        "Booked online\nPayment order: payment-order-id",
        "payment-order-id"
      )
    ).toBe(true);
  });
});
