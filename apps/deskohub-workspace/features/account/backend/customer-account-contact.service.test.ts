import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Result } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { NoReviewAccounts } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import type { CustomerProfile } from "./customer-dotypos-adapter.service";
import { CustomerProfileService } from "./customer-profile.service";

const customerEmail = testEmailAddress("ada");

const accountId = customerAccountIdSchema.make("auth-user-1");
const dotyposCustomerId = "60111";

const session = (
  overrides: Partial<CustomerAccountSession> = {}
): CustomerAccountSession => ({
  accountId,
  email: reservationCustomerEmailSchema.make(customerEmail),
  deletionRequested: false,
  ...overrides,
});

const profile = (
  overrides: Partial<CustomerProfile> = {}
): CustomerProfile => ({
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420 777 777 777",
  billing: null,
  ...overrides,
});

const runCurrent = (
  options: {
    readonly session?: CustomerAccountSession | null;
    readonly find?: ReturnType<typeof mock>;
    readonly profile?: CustomerProfile;
    readonly createUnderHeldLock?: ReturnType<typeof mock>;
  } = {},
  operation: (
    contacts: CustomerAccountContactService["Service"]
  ) => Effect.Effect<unknown, CustomerAccountAccessError> = (contacts) =>
    contacts.current
) => {
  const find =
    options.find ?? mock(() => Effect.succeed(dotyposCustomerId as never));
  const claim = mock(() => Effect.die("claim must not be called"));
  const markDeletionRequested = mock(() =>
    Effect.die("markDeletionRequested must not be called")
  );
  const load = mock(() => Effect.succeed(options.profile ?? profile()));
  const create = mock(() => Effect.die("create must not be called"));
  const update = mock(() => Effect.die("update must not be called"));
  const createUnderHeldLock =
    options.createUnderHeldLock ??
    mock(() => Effect.die("createUnderHeldLock must not be called"));
  const currentSession =
    options.session !== undefined ? options.session : session();

  const layer = CustomerAccountContactService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.succeed(currentSession),
        }),
        Layer.mock(CustomerAccountLinkRepository, {
          find,
          claim,
          markDeletionRequested,
        }),
        Layer.mock(CustomerProfileService, {
          load,
          create,
          createUnderHeldLock,
          update,
        }),
        NoReviewAccounts
      )
    )
  );

  return Effect.gen(function* () {
    const contacts = yield* CustomerAccountContactService;
    return yield* operation(contacts);
  })
    .pipe(Effect.provide(layer), Effect.result, Effect.runPromise)
    .then((outcome) => ({
      outcome,
      find,
      claim,
      markDeletionRequested,
      load,
      create,
      createUnderHeldLock,
      update,
    }));
};

describe("CustomerAccountContactService.current", () => {
  test("returns null for an anonymous session without reading the link", async () => {
    const { outcome, find, load } = await runCurrent({ session: null });

    expect(outcome).toMatchObject({ _tag: "Success", success: null });
    expect(find).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("returns null for a deletion-pending session without reading the link", async () => {
    const { outcome, find, load } = await runCurrent({
      session: session({ deletionRequested: true }),
    });

    expect(outcome).toMatchObject({ _tag: "Success", success: null });
    expect(find).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("returns null for an unlinked account without claiming a link", async () => {
    const { outcome, find, claim, load, create } = await runCurrent({
      find: mock(() => Effect.succeed(null)),
    });

    expect(outcome).toMatchObject({ _tag: "Success", success: null });
    expect(find).toHaveBeenCalledWith(accountId);
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test.each([
    ["a whitespace-only name", { firstName: "   ", lastName: null }],
    ["a too-short name", { firstName: "A", lastName: null }],
  ] as const)("returns null for a profile with %s", async (_label, name) => {
    const { outcome } = await runCurrent({ profile: profile(name) });

    expect(outcome).toMatchObject({ _tag: "Success", success: null });
  });

  test("returns the linked account contact from the session and profile", async () => {
    const { outcome, find, claim, load, markDeletionRequested } =
      await runCurrent();

    expect(outcome._tag).toBe("Success");
    if (outcome._tag !== "Success") throw new Error("Expected a contact");
    expect(outcome.success).toEqual({
      accountId,
      dotyposCustomerId,
      name: "Ada Lovelace",
      email: customerEmail,
      phone: "+420 777 777 777",
    });
    expect(find).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ accountId, dotyposCustomerId });
    expect(claim).not.toHaveBeenCalled();
    expect(markDeletionRequested).not.toHaveBeenCalled();
  });

  test("joins padded name parts with a single space", async () => {
    const { outcome } = await runCurrent({
      profile: profile({ firstName: " Ada ", lastName: " Lovelace " }),
    });

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: { name: "Ada Lovelace" },
    });
  });

  test.each([
    ["missing", null],
    ["invalid", "12"],
  ] as const)(
    "exposes no phone when the profile phone is %s",
    async (_label, phone) => {
      const { outcome } = await runCurrent({ profile: profile({ phone }) });

      expect(outcome).toMatchObject({
        _tag: "Success",
        success: { name: "Ada Lovelace", phone: null },
      });
    }
  );

  test("maps a link read failure to an unavailable account error", async () => {
    const { outcome, load } = await runCurrent({
      find: mock(() => Effect.fail(new Error("database unavailable"))),
    });

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag !== "Failure") throw new Error("Expected a failure");
    expect(outcome.failure).toBeInstanceOf(CustomerAccountAccessError);
    expect(outcome.failure).toMatchObject({
      reason: "unavailable",
      cause: { code: "account-link.read" },
    });
    expect(load).not.toHaveBeenCalled();
  });
});

describe("CustomerAccountContactService.currentAccount", () => {
  const runCurrentAccount = (options: Parameters<typeof runCurrent>[0] = {}) =>
    runCurrent(options, (contacts) => contacts.currentAccount);

  test("reads an anonymous session as signed out without reading the link", async () => {
    const { outcome, find } = await runCurrentAccount({ session: null });

    expect(Result.getOrThrow(outcome)).toEqual({ status: "signed-out" });
    expect(find).not.toHaveBeenCalled();
  });

  test("reads a deletion-pending session as signed out without reading the link", async () => {
    const { outcome, find } = await runCurrentAccount({
      session: session({ deletionRequested: true }),
    });

    expect(Result.getOrThrow(outcome)).toEqual({ status: "signed-out" });
    expect(find).not.toHaveBeenCalled();
  });

  test("reads a session without a link as unlinked without claiming one", async () => {
    const { outcome, find, claim, load } = await runCurrentAccount({
      find: mock(() => Effect.succeed(null)),
    });

    expect(Result.getOrThrow(outcome)).toEqual({
      status: "unlinked",
      accountId,
      email: customerEmail,
    });
    expect(find).toHaveBeenCalledWith(accountId);
    expect(claim).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("reads a linked session with its Dotypos customer without reading the profile", async () => {
    const { outcome, load } = await runCurrentAccount();

    expect(Result.getOrThrow(outcome)).toEqual({
      status: "linked",
      accountId,
      dotyposCustomerId,
      email: customerEmail,
    });
    expect(load).not.toHaveBeenCalled();
  });

  test("maps a link read failure to an unavailable account error", async () => {
    const { outcome } = await runCurrentAccount({
      find: mock(() => Effect.fail(new Error("database unavailable"))),
    });

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag !== "Failure") throw new Error("Expected a failure");
    expect(outcome.failure).toBeInstanceOf(CustomerAccountAccessError);
    expect(outcome.failure).toMatchObject({
      reason: "unavailable",
      cause: { code: "account-link.read" },
    });
  });
});

describe("CustomerAccountContactService.currentLinkedAccount", () => {
  test.each([
    ["an anonymous", { session: null }],
    ["a deletion-pending", { session: session({ deletionRequested: true }) }],
    ["an unlinked", { find: mock(() => Effect.succeed(null)) }],
  ] as const)("returns null for %s session", async (_label, options) => {
    const { outcome } = await runCurrent(
      options,
      (contacts) => contacts.currentLinkedAccount
    );

    expect(Result.getOrThrow(outcome)).toBeNull();
  });

  test("keeps the link read failure", async () => {
    const { outcome } = await runCurrent(
      { find: mock(() => Effect.fail(new Error("database unavailable"))) },
      (contacts) => contacts.currentLinkedAccount
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unavailable", cause: { code: "account-link.read" } },
    });
  });

  test("returns the session's link without reading the profile", async () => {
    const { outcome, find, load } = await runCurrent(
      {},
      (contacts) => contacts.currentLinkedAccount
    );

    expect(Result.getOrThrow(outcome)).toEqual({
      accountId,
      dotyposCustomerId,
      email: customerEmail,
    });
    expect(find).toHaveBeenCalledWith(accountId);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("CustomerAccountContactService.completeProfileUnderHeldLock", () => {
  const profileInput = {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: "+420 777 777 777",
  };
  const unlinkedAccount = { accountId, email: customerEmail };

  const runComplete = (createdProfile: CustomerProfile) => {
    const createUnderHeldLock = mock(() =>
      Effect.succeed({
        account: { accountId, dotyposCustomerId: "60999" },
        profile: createdProfile,
        created: true,
      })
    );
    return runCurrent({ createUnderHeldLock }, (contacts) =>
      contacts.completeProfileUnderHeldLock(unlinkedAccount, profileInput)
    );
  };

  test("saves the profile under the held lock and returns its contact", async () => {
    const { outcome, createUnderHeldLock, create, find, load } =
      await runComplete(profile());

    expect(Result.getOrThrow(outcome)).toEqual({
      accountId,
      dotyposCustomerId: "60999",
      name: "Ada Lovelace",
      email: customerEmail,
      phone: "+420 777 777 777",
    });
    expect(createUnderHeldLock).toHaveBeenCalledWith(
      accountId,
      customerEmail,
      profileInput
    );
    expect(create).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("returns null when the saved profile's name cannot book", async () => {
    const { outcome } = await runComplete(
      profile({ firstName: "A", lastName: null })
    );

    expect(Result.getOrThrow(outcome)).toBeNull();
  });

  test("keeps the profile creation failure", async () => {
    const createUnderHeldLock = mock(() =>
      Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "claimed",
        })
      )
    );
    const { outcome } = await runCurrent({ createUnderHeldLock }, (contacts) =>
      contacts.completeProfileUnderHeldLock(unlinkedAccount, profileInput)
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: "link-required", linkReason: "claimed" },
    });
  });
});
