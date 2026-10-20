import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Deferred, Effect, Layer } from "effect";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
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
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
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

const marketingConsent = (
  withdrawnAt: Temporal.Instant | null
): CustomerMarketingConsent =>
  ({
    dotyposCustomerId: account.dotyposCustomerId,
    documentHash: "marketing-hash",
    locale: "en-US",
    grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    withdrawnAt,
  }) as CustomerMarketingConsent;

const runLoad = (options: {
  readonly getMarketingConsent?: CustomerMarketingConsentRepository["Service"]["get"];
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
        Layer.mock(CustomerMarketingConsentRepository, {
          get: options.getMarketingConsent ?? (() => Effect.succeed(null)),
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
    const loadConsent = (consent: CustomerMarketingConsent | null) => {
      const getMarketingConsent = mock(() => Effect.succeed(consent));
      return runLoad({
        getMarketingConsent,
        linkedContact: () => Effect.succeed(contact),
        load: () => Effect.succeed(null),
      }).then((outcome) => {
        expect(getMarketingConsent).toHaveBeenCalledWith(
          account.dotyposCustomerId
        );
        return outcome;
      });
    };

    expect(await loadConsent(marketingConsent(null))).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: true },
    });
    expect(
      await loadConsent(
        marketingConsent(Temporal.Instant.from("2026-02-01T00:00:00Z"))
      )
    ).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: false },
    });
    expect(await loadConsent(null)).toMatchObject({
      _tag: "Success",
      success: { hasMarketingConsent: false },
    });
  });

  test("keeps asking for marketing consent when it cannot be read", async () => {
    const outcome = await runLoad({
      getMarketingConsent: () =>
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
  const originalMarketingConsentsLive = CustomerMarketingConsentRepository.Live;

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
  CustomerMarketingConsentRepository.Live = Layer.mock(
    CustomerMarketingConsentRepository,
    { get: () => Effect.succeed(null) }
  );

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
    CustomerMarketingConsentRepository.Live = originalMarketingConsentsLive;
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
