import { afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type CustomerBookingSelection,
  type CustomerCheckoutSubmission,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Context, Effect, Layer } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import {
  fakeCustomerApiLayer,
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { bookingServicesLayer } from "../data/booking-services-layer";
import { PaymentBrowser } from "../payment-browser.service";
import { fakeBooking, fakeBookingCodes } from "./fake-booking-api";
import { sampleLegalDocuments } from "./sample-booking-catalog";
import { samplePaymentBrowserLayer } from "./sample-booking-services-layer";

const harness = () => {
  const workspace = FakeWorkspace.forKind("linked");
  const booking = fakeBooking(workspace);
  const run = <A, E>(
    use: (api: CustomerApi["Service"]) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.flatMap(Effect.service(CustomerApi), use).pipe(
        Effect.provide(fakeCustomerApiLayer(workspace))
      )
    );
  return { workspace, booking, run };
};

let attempts = 0;

/** Quotes, holds and submits the selection, with `code` applied first. */
const submitted = (
  api: CustomerApi["Service"],
  selection: CustomerBookingSelection,
  code?: string
) =>
  Effect.gen(function* () {
    const { coffee, ...fields } = selection;
    const quote = yield* api.booking.getQuote({
      query: {
        ...fields,
        ...(coffee === undefined ? {} : { coffee: coffee ? "true" : "false" }),
        locale: "en-US",
      },
    });
    attempts += 1;
    const checkout = yield* api.booking.createCheckout({
      payload: {
        locale: "en-US",
        checkoutSessionId: "session-1",
        checkoutAttemptId: `attempt-${attempts}`,
        advertisedPriceToken: quote.advertisedPriceToken,
        selection,
        bookingFor: "self",
        contact: {
          name: "Alex Sample",
          email: testEmailAddress("alex"),
          phone: "+420600000000",
        },
        billing: { purpose: "personal", invoice: "none" },
      },
      headers: {},
    });
    if (checkout.status === "payment_disabled") {
      return yield* Effect.die("payment disabled");
    }
    const payStateToken =
      code === undefined
        ? checkout.payStateToken
        : (yield* api.booking.applyCheckoutDiscountCode({
            payload: {
              locale: "en-US",
              payStateToken: checkout.payStateToken,
              code,
            },
            headers: {},
          })).payStateToken;
    return yield* api.booking.submitCheckout({
      payload: {
        locale: "en-US",
        payStateToken,
        legalConsent: true,
        acceptedLegalDocuments: sampleLegalDocuments("en-US", 1).map(
          ({ key, hash }) => ({ key, hash })
        ),
        returnTarget: "native-app",
      },
      headers: {},
    });
  });

/** What the status screen and the reservations list read for the order. */
const reservationOf = (api: CustomerApi["Service"], orderId: string) =>
  Effect.all({
    status: api.reservations.getReservationStatus({
      params: { orderId: CustomerReservationOrderId.make(orderId) },
    }),
    history: api.reservations.listReservations(),
  }).pipe(
    Effect.map(({ status, history }) => ({
      status,
      row: history.current.find((row) => row.orderId === orderId),
    }))
  );

/** The door code and the invoice the order's status screen offers. */
const documentsOf = (api: CustomerApi["Service"], orderId: string) => {
  const params = { orderId: CustomerReservationOrderId.make(orderId) };
  return Effect.all({
    access: Effect.result(api.reservations.getReservationAccess({ params })),
    invoice: Effect.result(api.reservations.getReservationInvoice({ params })),
  });
};

const paymentUrlOf = (submission: CustomerCheckoutSubmission) => {
  if (submission.status !== "payment_required") {
    throw new Error(`expected payment_required, got ${submission.status}`);
  }
  return submission.paymentUrl;
};

const openSamplePayment = (paymentUrl: string, returnUrl: string) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(Effect.service(PaymentBrowser), (browser) =>
        browser.open(paymentUrl, returnUrl)
      ).pipe(Effect.provide(samplePaymentBrowserLayer))
    )
  );

describe("sample booking", () => {
  test("a free submission is a fulfilled order the status read finds", async () => {
    const { booking, run } = harness();
    const selection: CustomerBookingSelection = {
      family: "cowork",
      tier: "reserved-desk",
      date: booking.dateIn(20),
    };

    const { submission, reservation } = await run((api) =>
      Effect.gen(function* () {
        const submission = yield* submitted(
          api,
          selection,
          fakeBookingCodes.free
        );
        return {
          submission,
          reservation: yield* reservationOf(api, submission.orderId),
        };
      })
    );

    expect(submission.status).toBe("paid");
    expect(reservation.status).toMatchObject({
      orderId: submission.orderId,
      kind: "cowork",
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      total: { value: 0, currency: "CZK" },
    });
    expect(reservation.row).toMatchObject({
      product: { kind: "cowork", tier: "reserved-desk" },
      seats: 1,
      status: "confirmed",
    });
    expect(
      await run((api) => documentsOf(api, submission.orderId))
    ).toMatchObject({
      access: { _tag: "Success", success: { code: "000000" } },
      invoice: {
        _tag: "Failure",
        failure: { _tag: "CustomerInvoiceNotIssued" },
      },
    });
  });

  test("a submission to pay stays pending until the sample payment page completes", async () => {
    const { booking, run } = harness();
    const selection: CustomerBookingSelection = {
      family: "meeting-room",
      date: booking.dateIn(20),
      startTime: "10:00",
      duration: "hour:4",
    };

    const submission = await run((api) => submitted(api, selection));
    const paymentUrl = paymentUrlOf(submission);
    const pending = await run((api) => reservationOf(api, submission.orderId));

    expect(pending.status).toMatchObject({
      kind: "meeting-room",
      status: "pending",
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
    });
    expect(
      Date.parse(pending.status.endsAt ?? "") -
        Date.parse(pending.status.startsAt ?? "")
    ).toBe(4 * 3_600_000);
    expect(pending.row).toMatchObject({ seats: null, status: "pending" });

    const returnUrl = `deskohub://reservations/${submission.orderId}?after=payment`;
    expect(await openSamplePayment(paymentUrl, returnUrl)).toMatchObject({
      _tag: "Success",
      success: "returned",
    });
    const paid = await run((api) => reservationOf(api, submission.orderId));
    expect(paid.status).toMatchObject({
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      total: pending.status.total,
    });
    expect(paid.row).toMatchObject({ status: "confirmed" });
    expect(
      await run((api) => documentsOf(api, submission.orderId))
    ).toMatchObject({
      access: { _tag: "Success", success: { code: "000000" } },
      invoice: { _tag: "Success" },
    });

    // A reopened page answers the same and leaves the order as it was.
    expect(await openSamplePayment(paymentUrl, returnUrl)).toMatchObject({
      success: "returned",
    });
    const history = await run((api) => api.reservations.listReservations());
    expect(
      history.current.filter((row) => row.orderId === submission.orderId)
    ).toEqual([paid.row as NonNullable<typeof paid.row>]);
    expect(
      (await run((api) => reservationOf(api, submission.orderId))).status
    ).toEqual(paid.status);
  });

  test("a whole-day meeting room runs the Prague calendar day, 23 hours when clocks go forward", async () => {
    const { booking, run } = harness();
    booking.now = () => new Date("2027-03-01T10:00:00Z");
    const submission = await run((api) =>
      submitted(
        api,
        { family: "meeting-room", date: "2027-03-28", duration: "day:1" },
        fakeBookingCodes.free
      )
    );
    const { status } = await run((api) =>
      reservationOf(api, submission.orderId)
    );

    expect(status).toMatchObject({
      startsAt: "2027-03-27T23:00:00.000Z",
      endsAt: "2027-03-28T22:00:00.000Z",
    });
  });

  test("each fake Workspace's payment page pays only its own order", async () => {
    const first = harness();
    const second = harness();
    const selection = (booking: typeof first.booking) =>
      ({
        family: "office",
        date: booking.dateIn(20),
        endDate: booking.dateIn(21),
        seats: 2,
      }) satisfies CustomerBookingSelection;
    const firstSubmission = await first.run((api) =>
      submitted(api, selection(first.booking))
    );
    const secondSubmission = await second.run((api) =>
      submitted(api, selection(second.booking))
    );
    expect(firstSubmission.orderId).toBe(secondSubmission.orderId);

    await openSamplePayment(paymentUrlOf(firstSubmission), "deskohub://x");

    const firstRead = await first.run((api) =>
      reservationOf(api, firstSubmission.orderId)
    );
    expect(firstRead.status.status).toBe("fulfilled");
    expect(firstRead.row).toMatchObject({ seats: 2 });
    expect(
      (await second.run((api) => reservationOf(api, secondSubmission.orderId)))
        .status.status
    ).toBe("pending");
  });

  test("the sample payment browser can't open a page no fake Workspace issued", async () => {
    expect(
      await openSamplePayment(
        "https://pay.example.test/checkout/unknown",
        "deskohub://x"
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PaymentBrowserUnavailable" },
    });
  });
});

describe("booking services in sample-data mode", () => {
  const globals = globalThis as { __DEV__?: boolean };
  const flag = process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA;

  afterEach(() => {
    delete globals.__DEV__;
    if (flag === undefined) delete process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA;
    else process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA = flag;
  });

  /** The payment browser the default booking services build. */
  const defaultPaymentBrowser = (
    isDevelopmentBuild: boolean,
    sampleFlag: string | undefined
  ) => {
    globals.__DEV__ = isDevelopmentBuild;
    if (sampleFlag === undefined) {
      delete process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA;
    } else process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA = sampleFlag;
    const layer = AtomRegistry.make().get(bookingServicesLayer);
    return Effect.runPromise(
      Effect.scoped(
        Layer.build(layer).pipe(
          Effect.provide(
            fakeCustomerDataLayer({
              workspace: FakeWorkspace.forKind("linked"),
              device: makeFakeDevice(),
            })
          ),
          Effect.map((context) => Context.get(context, PaymentBrowser))
        )
      )
    );
  };

  const samplePaymentBrowser = Effect.runSync(
    Effect.scoped(
      Effect.map(Layer.build(samplePaymentBrowserLayer), (context) =>
        Context.get(context, PaymentBrowser)
      )
    )
  );

  test("only a development build with the flag completes payments in place", async () => {
    expect(await defaultPaymentBrowser(true, "1")).toBe(samplePaymentBrowser);
    expect(await defaultPaymentBrowser(false, "1")).not.toBe(
      samplePaymentBrowser
    );
    expect(await defaultPaymentBrowser(true, undefined)).not.toBe(
      samplePaymentBrowser
    );
    expect(await defaultPaymentBrowser(true, "true")).not.toBe(
      samplePaymentBrowser
    );
  });
});
