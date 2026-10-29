import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Deferred, Effect, Layer } from "effect";
import {
  type CurrentLinkedAccount,
  CustomerAccountContactService,
} from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import type { IMarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { CustomerLastReservation } from "@/features/reservation/reservation-existing-customer";
import { CustomerLastReservationService } from "./customer-last-reservation.service";

const testEmailAddressForAda = testEmailAddress("ada");

mock.module("server-only", () => ({}));

const { loadLinkedExistingCustomer, loadReservationCheckoutAccount } =
  await import("./reservation-existing-customer.server");

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
  // swaps them for fakes that read the current scenario.
  let currentAccount: CustomerAccountContactService["Service"]["currentAccount"];
  let linkedContact: CustomerAccountContactService["Service"]["linkedContact"];
  let resolve: CustomerAccountResolver["Service"]["resolve"];

  const originalContactsLive = CustomerAccountContactService.Live;
  const originalResolverLive = CustomerAccountResolver.Live;
  const originalLastReservationsLive = CustomerLastReservationService.Live;
  const originalMarketingConsentsLive = MarketingConsentLedger.Live;

  CustomerAccountContactService.Live = Layer.mock(
    CustomerAccountContactService,
    {
      currentAccount: Effect.suspend(() => currentAccount),
      linkedContact: (linked) => linkedContact(linked),
    }
  );
  CustomerAccountResolver.Live = Layer.mock(CustomerAccountResolver, {
    resolve: Effect.suspend(() => resolve),
  });
  CustomerLastReservationService.Live = Layer.mock(
    CustomerLastReservationService,
    { load: () => Effect.succeed(null) }
  );
  MarketingConsentLedger.Live = Layer.mock(MarketingConsentLedger, {
    status: () => Effect.succeed("absent"),
  });

  beforeEach(() => {
    currentAccount = Effect.succeed({ status: "linked", ...account });
    linkedContact = mock(() => Effect.succeed(contact));
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "not-found",
      })
    );
  });

  afterAll(() => {
    CustomerAccountContactService.Live = originalContactsLive;
    CustomerAccountResolver.Live = originalResolverLive;
    CustomerLastReservationService.Live = originalLastReservationsLive;
    MarketingConsentLedger.Live = originalMarketingConsentsLive;
  });

  test("reads a signed-out visitor without loading a profile", async () => {
    currentAccount = Effect.succeed({ status: "signed-out" });

    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "signed-out",
    });
    expect(linkedContact).not.toHaveBeenCalled();
  });

  test("asks an unlinked account for its profile under its login email", async () => {
    currentAccount = Effect.succeed({
      status: "unlinked",
      accountId: account.accountId,
      email: account.email,
    });

    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "profile-missing",
      email: testEmailAddressForAda,
    });
    expect(linkedContact).not.toHaveBeenCalled();
  });

  test("links an unlinked account to its exact-email customer and books with the saved profile", async () => {
    currentAccount = Effect.succeed({
      status: "unlinked",
      accountId: account.accountId,
      email: account.email,
    });
    resolve = Effect.succeed({
      accountId: account.accountId,
      dotyposCustomerId: account.dotyposCustomerId,
    });

    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "linked",
      customer: {
        contact: {
          name: "Ada Lovelace",
          email: testEmailAddressForAda,
          phone: "+420 777 777 777",
        },
        hasMarketingConsent: false,
      },
    });
    expect(linkedContact).toHaveBeenCalledWith(account);
  });

  test.each([
    ["ambiguous", { status: "support-required" }],
    ["unusable", { status: "support-required" }],
    ["claimed", { status: "support-required" }],
    ["deletion-requested", { status: "signed-out" }],
  ] as const)(
    "reads an unlinked account whose resolution is %s without a profile form",
    async (linkReason, expected) => {
      currentAccount = Effect.succeed({
        status: "unlinked",
        accountId: account.accountId,
        email: account.email,
      });
      resolve = Effect.fail(
        new CustomerAccountAccessError({ reason: "link-required", linkReason })
      );

      expect(await loadReservationCheckoutAccount("cowork")).toEqual(expected);
      expect(linkedContact).not.toHaveBeenCalled();
    }
  );

  test("books a linked account as its customer by default", async () => {
    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "linked",
      customer: {
        contact: {
          name: "Ada Lovelace",
          email: testEmailAddressForAda,
          phone: "+420 777 777 777",
        },
        hasMarketingConsent: false,
      },
    });
    expect(linkedContact).toHaveBeenCalledWith(
      expect.objectContaining(account)
    );
  });

  test("asks a linked account whose profile cannot book for its profile", async () => {
    linkedContact = () => Effect.succeed(null);

    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "profile-missing",
      email: testEmailAddressForAda,
    });
  });

  test.each([
    ["the account", "currentAccount"],
    ["the linked profile", "linkedContact"],
  ] as const)(
    "reads the account as unavailable when %s cannot be read",
    async (_label, failing) => {
      const failure = Effect.fail(
        customerAccountUnavailable("account-link.read")
      );
      if (failing === "currentAccount") currentAccount = failure;
      else linkedContact = () => failure;

      expect(await loadReservationCheckoutAccount("cowork")).toEqual({
        status: "unavailable",
      });
    }
  );

  test("reads every visitor as signed out without account configuration", async () => {
    currentAccount = Effect.fail(
      new CustomerAccountAccessError({ reason: "not-configured" })
    );

    expect(await loadReservationCheckoutAccount("cowork")).toEqual({
      status: "signed-out",
    });
  });
});
