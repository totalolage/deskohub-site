import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Deferred, Effect, Layer } from "effect";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import {
  type CurrentLinkedAccount,
  CustomerAccountContactService,
} from "@/features/account/backend/customer-account-contact.service";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import type { IMarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { CustomerLastReservation } from "@/features/reservation/reservation-existing-customer";
import {
  getMeetingRoomAvailabilityQuery,
  type WorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import { getReviewAccountContact } from "@/features/review-accounts";
import { CustomerLastReservationService } from "./customer-last-reservation.service";
import {
  AvailabilityQueryInvalid,
  WorkspaceAvailabilityService,
} from "./workspace-availability.service";

const testEmailAddressForAda = testEmailAddress("ada");

mock.module("server-only", () => ({}));

const {
  isRememberedCoworkOfferAvailable,
  isRememberedMeetingRoomReservationAvailable,
  loadLinkedExistingCustomer,
  loadReservationCheckoutAccount,
} = await import("./reservation-existing-customer.server");

const account: CurrentLinkedAccount = {
  accountId: customerAccountIdSchema.make("auth-user-1"),
  dotyposCustomerId: "60111" as DotyposCustomerId,
  email: reservationCustomerEmailSchema.make(testEmailAddressForAda),
};

const contact = {
  ...account,
  name: "Ada Lovelace",
  phone: "+420 777 777 777",
};

const lastReservation: CustomerLastReservation = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: true,
};

const runLoad = (options: {
  readonly marketingConsentStatus?: IMarketingConsentLedger["status"];
  readonly linkedContact: CustomerAccountContactService["Service"]["linkedContact"];
  readonly load: CustomerLastReservationService["Service"]["load"];
}) =>
  loadLinkedExistingCustomer(account, "cowork").pipe(
    Effect.timeout("1 second"),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(CustomerAccountContactService, {
          linkedContact: options.linkedContact,
        }),
        Layer.mock(CustomerLastReservationService, { load: options.load }),
        Layer.mock(MarketingConsentLedger, {
          status:
            options.marketingConsentStatus ?? (() => Effect.succeed("absent")),
        })
      )
    ),
    Effect.result,
    Effect.runPromise
  );

describe("loadLinkedExistingCustomer", () => {
  test("loads the contact and the last reservation concurrently from the link", async () => {
    const lastReservationStarted = Deferred.makeUnsafe<void>();
    const contactStarted = Deferred.makeUnsafe<void>();
    // Each read waits for the other to start, so a sequential load times out.
    const linkedContact = mock((_account: CurrentLinkedAccount) =>
      Deferred.succeed(contactStarted, undefined).pipe(
        Effect.andThen(Deferred.await(lastReservationStarted)),
        Effect.as(contact)
      )
    );
    const load = mock(() =>
      Deferred.succeed(lastReservationStarted, undefined).pipe(
        Effect.andThen(Deferred.await(contactStarted)),
        Effect.as(lastReservation as never)
      )
    );

    const outcome = await runLoad({ linkedContact, load });

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: {
        contact: {
          name: "Ada Lovelace",
          email: testEmailAddressForAda,
          phone: "+420 777 777 777",
        },
        hasMarketingConsent: false,
        lastReservation,
      },
    });
    expect(linkedContact).toHaveBeenCalledWith(account);
    expect(load).toHaveBeenCalledWith(account.dotyposCustomerId, "cowork");
  });

  test("keeps the account contact when the last reservation fails", async () => {
    const outcome = await runLoad({
      linkedContact: () => Effect.succeed(contact),
      load: () => Effect.fail(new Error("database unavailable") as never),
    });

    expect(outcome._tag).toBe("Success");
    if (outcome._tag !== "Success") throw new Error("Expected a customer");
    expect(outcome.success).toEqual({
      contact: {
        name: "Ada Lovelace",
        email: testEmailAddressForAda,
        phone: "+420 777 777 777",
      },
      hasMarketingConsent: false,
    });
  });

  test("reports only a current, unwithdrawn marketing consent", async () => {
    const loadConsent = (status: MarketingConsentStatus) => {
      const getMarketingConsentStatus = mock(() => Effect.succeed(status));
      return runLoad({
        marketingConsentStatus: getMarketingConsentStatus,
        linkedContact: () => Effect.succeed(contact),
        load: () => Effect.succeed(null),
      }).then((outcome) => {
        expect(getMarketingConsentStatus).toHaveBeenCalledWith(
          account.dotyposCustomerId
        );
        return outcome;
      });
    };
    expect(await loadConsent("active")).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: true },
    });
    expect(await loadConsent("withdrawn")).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: false },
    });
    expect(await loadConsent("absent")).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: false },
    });
  });

  test("keeps asking for marketing consent when it cannot be read", async () => {
    const outcome = await runLoad({
      marketingConsentStatus: () =>
        Effect.fail(new Error("database unavailable") as never),
      linkedContact: () => Effect.succeed(contact),
      load: () => Effect.succeed(null),
    });

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: false },
    });
  });
});

describe("loadReservationCheckoutAccount", () => {
  // The page loader provides the services' live layers itself, so the test
  // swaps them for fakes that read the current scenario. The standing table
  // test covers how the standing is read; these cover checkout's policy.
  let peek: CurrentCustomerAccount["Service"]["peek"];
  let resolve: CurrentCustomerAccount["Service"]["resolve"];
  let linkedContact: CustomerAccountContactService["Service"]["linkedContact"];
  const resolveCalls = mock(() => undefined);

  const originalCurrentAccountLive = CurrentCustomerAccount.Live;
  const originalContactsLive = CustomerAccountContactService.Live;
  const originalLastReservationsLive = CustomerLastReservationService.Live;
  const originalMarketingConsentsLive = MarketingConsentLedger.Live;

  CurrentCustomerAccount.Live = Layer.mock(CurrentCustomerAccount, {
    peek: Effect.suspend(() => peek),
    resolve: Effect.suspend(() => {
      resolveCalls();
      return resolve;
    }),
  });
  CustomerAccountContactService.Live = Layer.mock(
    CustomerAccountContactService,
    { linkedContact: (linked) => linkedContact(linked) }
  );
  CustomerLastReservationService.Live = Layer.mock(
    CustomerLastReservationService,
    { load: () => Effect.succeed(null) }
  );
  MarketingConsentLedger.Live = Layer.mock(MarketingConsentLedger, {
    status: () => Effect.succeed("absent"),
  });

  const session = {
    accountId: account.accountId,
    email: account.email,
    deletionRequested: false,
    ...testSessionProfile,
  } satisfies CustomerAccountSession;

  const linkedStanding = (reviewMarker: "absent" | "unreadable") =>
    ({
      kind: "linked",
      session,
      reviewMarker,
      account: {
        accountId: account.accountId,
        dotyposCustomerId: account.dotyposCustomerId,
      },
      autoLinked: false,
    }) as const;
  const unlinked = (reviewMarker: "absent" | "unreadable") =>
    ({ kind: "unlinked", session, reviewMarker }) as const;
  const unavailable = (failure: CustomerAccountAccessError) =>
    ({
      kind: "unavailable",
      session,
      reviewMarker: "absent",
      failure,
    }) as const;
  const linkRequired = (linkReason: CustomerAccountAccessError["linkReason"]) =>
    new CustomerAccountAccessError({ reason: "link-required", linkReason });
  const accessError = (reason: CustomerAccountAccessError["reason"]) =>
    new CustomerAccountAccessError({ reason });

  const linkedCustomer = {
    status: "linked",
    customer: {
      contact: {
        name: "Ada Lovelace",
        email: testEmailAddressForAda,
        phone: "+420 777 777 777",
      },
      hasMarketingConsent: false,
    },
  } as const;
  const profileMissing = {
    status: "profile-missing",
    email: testEmailAddressForAda,
  } as const;

  beforeEach(() => {
    peek = Effect.succeed(linkedStanding("absent"));
    resolve = Effect.die("resolve is not expected in this scenario");
    linkedContact = mock(() => Effect.succeed(contact));
    resolveCalls.mockClear();
  });

  afterAll(() => {
    CurrentCustomerAccount.Live = originalCurrentAccountLive;
    CustomerAccountContactService.Live = originalContactsLive;
    CustomerLastReservationService.Live = originalLastReservationsLive;
    MarketingConsentLedger.Live = originalMarketingConsentsLive;
  });

  test.each([
    ["signed out", { kind: "signed-out" }, { status: "signed-out" }],
    [
      "awaiting deletion",
      { kind: "deletion-pending", session, reviewMarker: "absent" },
      { status: "signed-out" },
    ],
    [
      "awaiting deletion with a review marker",
      { kind: "deletion-pending", session, reviewMarker: "present" },
      { status: "signed-out" },
    ],
    ["unverified", { kind: "unverified" }, { status: "unavailable" }],
    [
      "a review account",
      { kind: "review", session },
      {
        status: "review-account",
        contact: getReviewAccountContact(testEmailAddressForAda),
      },
    ],
    [
      "unlinked with an unreadable review marker",
      unlinked("unreadable"),
      { status: "unavailable" },
    ],
    [
      "unable to read its link",
      unavailable(customerAccountUnavailable("account-link.read")),
      { status: "unavailable" },
    ],
  ] as const)(
    "reads an account that is %s without resolving or loading a profile",
    async (_label, standing, expected) => {
      peek = Effect.succeed(standing);

      expect(await loadReservationCheckoutAccount("cowork")).toEqual(expected);
      expect(resolveCalls).not.toHaveBeenCalled();
      expect(linkedContact).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["not configured", "not-configured", { status: "signed-out" }],
    ["unavailable", "unavailable", { status: "unavailable" }],
    ["undecodable", "unauthenticated", { status: "unavailable" }],
  ] as const)(
    "reads a session read that is %s without resolving",
    async (_label, reason, expected) => {
      peek = Effect.fail(accessError(reason));

      expect(await loadReservationCheckoutAccount("cowork")).toEqual(expected);
      expect(resolveCalls).not.toHaveBeenCalled();
    }
  );

  test.each(["absent", "unreadable"] as const)(
    "books a linked account whose review marker is %s as its customer without resolving",
    async (reviewMarker) => {
      peek = Effect.succeed(linkedStanding(reviewMarker));

      expect(await loadReservationCheckoutAccount("cowork")).toEqual(
        linkedCustomer
      );
      expect(linkedContact).toHaveBeenCalledWith(account);
      expect(resolveCalls).not.toHaveBeenCalled();
    }
  );

  test("asks a linked account whose profile cannot book for its profile", async () => {
    linkedContact = () => Effect.succeed(null);

    expect(await loadReservationCheckoutAccount("cowork")).toEqual(
      profileMissing
    );
  });

  test("reads the account as unavailable when the linked profile cannot be read", async () => {
    linkedContact = () =>
      Effect.fail(customerAccountUnavailable("account-link.read"));

    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "unavailable",
    });
  });

  test("links an unlinked account to its exact-email customer and books with the saved profile", async () => {
    peek = Effect.succeed(unlinked("absent"));
    resolve = Effect.succeed({ ...linkedStanding("absent"), autoLinked: true });

    expect(await loadReservationCheckoutAccount("cowork")).toEqual(
      linkedCustomer
    );
    expect(resolveCalls).toHaveBeenCalledTimes(1);
    expect(linkedContact).toHaveBeenCalledWith(account);
  });

  test.each([
    [
      "has no Dotypos profile",
      Effect.succeed({
        kind: "profile-missing",
        session,
        reviewMarker: "absent",
      }),
      profileMissing,
    ],
    ...(["ambiguous", "unusable", "claimed"] as const).map(
      (reason) =>
        [
          `needs support (${reason})`,
          Effect.succeed({
            kind: "support-required",
            reason,
            session,
            reviewMarker: "absent",
          }),
          { status: "support-required" },
        ] as const
    ),
    [
      "signed out since the first read",
      Effect.succeed({ kind: "signed-out" }),
      { status: "signed-out" },
    ],
    [
      "awaiting deletion since the first read",
      Effect.succeed({
        kind: "deletion-pending",
        session,
        reviewMarker: "absent",
      }),
      { status: "signed-out" },
    ],
    [
      "unverified since the first read",
      Effect.succeed({ kind: "unverified" }),
      { status: "unavailable" },
    ],
    [
      "refused under the lock as awaiting deletion",
      Effect.succeed(unavailable(linkRequired("deletion-requested"))),
      { status: "signed-out" },
    ],
    [
      "refused under the lock as unverified",
      Effect.succeed(unavailable(accessError("unverified-email"))),
      { status: "unavailable" },
    ],
    [
      "unable to take the account lock",
      Effect.succeed(
        unavailable(customerAccountUnavailable("account-link.lock"))
      ),
      { status: "unavailable" },
    ],
    [
      "undecodable on the second session read",
      Effect.fail(accessError("unauthenticated")),
      { status: "signed-out" },
    ],
    [
      "unreadable on the second session read",
      Effect.fail(accessError("unavailable")),
      { status: "unavailable" },
    ],
    [
      "not configured on the second session read",
      Effect.fail(accessError("not-configured")),
      { status: "signed-out" },
    ],
  ] as const)(
    "reads an unlinked account whose resolution %s",
    async (_label, resolution, expected) => {
      peek = Effect.succeed(unlinked("absent"));
      resolve = resolution;

      expect(await loadReservationCheckoutAccount("cowork")).toEqual(expected);
      expect(resolveCalls).toHaveBeenCalledTimes(1);
      expect(linkedContact).not.toHaveBeenCalled();
    }
  );
});

describe("remembered reservation option availability", () => {
  // The checks provide the live availability layer themselves, so the test
  // swaps it for a fake that answers the current scenario.
  const date = "2099-06-10";
  let availability: Effect.Effect<
    WorkspaceAvailability,
    AvailabilityQueryInvalid
  >;
  const getAvailability = mock(
    (
      _request: Parameters<
        WorkspaceAvailabilityService["Service"]["getAvailability"]
      >[0]
    ) => availability
  );

  const originalAvailabilityLive = WorkspaceAvailabilityService.Live;
  WorkspaceAvailabilityService.Live = Layer.mock(WorkspaceAvailabilityService, {
    getAvailability,
  });

  const availableOn = (
    overrides: Partial<WorkspaceAvailability> = {}
  ): WorkspaceAvailability => ({
    date,
    from: date,
    to: date,
    unavailableDates: [],
    reservedDeskWorkstationRequiredDates: [],
    unavailableCoworkTiers: [],
    meetingRoomUnavailable: false,
    officeUnavailable: false,
    unavailableMonitorOptions: [],
    notices: [],
    ...overrides,
  });

  beforeEach(() => {
    availability = Effect.succeed(availableOn());
    getAvailability.mockClear();
  });

  // The checks are Effects the page recipe runs; each test runs one alone.
  const coworkOfferAvailable = (
    offer: Parameters<typeof isRememberedCoworkOfferAvailable>[0]
  ) => Effect.runPromise(isRememberedCoworkOfferAvailable(offer));
  const meetingRoomReservationAvailable = (
    remembered: Parameters<
      typeof isRememberedMeetingRoomReservationAvailable
    >[0]
  ) =>
    Effect.runPromise(isRememberedMeetingRoomReservationAvailable(remembered));

  afterAll(() => {
    WorkspaceAvailabilityService.Live = originalAvailabilityLive;
  });

  test("queries the remembered cowork offer on the form's date", async () => {
    expect(
      await coworkOfferAvailable({
        date,
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      })
    ).toBe(true);
    expect(
      await coworkOfferAvailable({
        date,
        entryTier: "open-space",
        monitorOption: undefined,
      })
    ).toBe(true);

    expect(getAvailability.mock.calls).toEqual([
      [
        {
          query: {
            kind: "cowork",
            from: date,
            to: date,
            date,
            entryTier: "reserved-desk",
            monitorOption: "2x27-qhd",
          },
        },
      ],
      [
        {
          query: {
            kind: "cowork",
            from: date,
            to: date,
            date,
            entryTier: "open-space",
          },
        },
      ],
    ]);
  });

  test("reads a remembered cowork offer as unavailable when it's taken or unknown", async () => {
    availability = Effect.succeed(
      availableOn({ unavailableMonitorOptions: ["2x27-qhd"] })
    );
    expect(
      await coworkOfferAvailable({
        date,
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      })
    ).toBe(false);

    availability = Effect.fail(
      new AvailabilityQueryInvalid({ message: "Invalid availability date." })
    );
    expect(
      await coworkOfferAvailable({
        date,
        entryTier: "open-space",
        monitorOption: undefined,
      })
    ).toBe(false);
  });

  test("queries the meeting room for the remembered duration's interval", async () => {
    const interval = getMeetingRoomReservationInterval(
      `${date}T09:00`,
      getMeetingRoomReservationDuration("hour:4")
    );

    expect(
      await meetingRoomReservationAvailable({
        duration: "hour:4",
        startDateTime: `${date}T09:00`,
      })
    ).toBe(true);
    expect(interval).not.toBeNull();
    expect(getAvailability.mock.calls).toEqual([
      [{ query: interval && getMeetingRoomAvailabilityQuery(interval) }],
    ]);
  });

  test("reads the meeting room as unavailable when it's taken, unknown, or the start is invalid", async () => {
    const remembered = {
      duration: "hour:4",
      startDateTime: `${date}T09:00`,
    } as const;

    availability = Effect.succeed(
      availableOn({ meetingRoomUnavailable: true })
    );
    expect(await meetingRoomReservationAvailable(remembered)).toBe(false);

    availability = Effect.fail(
      new AvailabilityQueryInvalid({ message: "Invalid availability date." })
    );
    expect(await meetingRoomReservationAvailable(remembered)).toBe(false);

    getAvailability.mockClear();
    expect(
      await meetingRoomReservationAvailable({
        ...remembered,
        startDateTime: "not-a-start",
      })
    ).toBe(false);
    expect(getAvailability).not.toHaveBeenCalled();
  });
});
