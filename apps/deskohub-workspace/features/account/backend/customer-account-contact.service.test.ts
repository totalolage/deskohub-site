import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
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

const accountId = customerAccountIdSchema.make("auth-user-1");
const dotyposCustomerId = "60111";

const session = (
  overrides: Partial<CustomerAccountSession> = {}
): CustomerAccountSession => ({
  accountId,
  email: reservationCustomerEmailSchema.make("ada@example.test"),
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
  } = {}
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
        Layer.mock(CustomerProfileService, { load, create, update })
      )
    )
  );

  return Effect.gen(function* () {
    const contacts = yield* CustomerAccountContactService;
    return yield* contacts.current;
  })
    .pipe(Effect.provide(layer), Effect.result, Effect.runPromise)
    .then((outcome) => ({
      outcome,
      find,
      claim,
      markDeletionRequested,
      load,
      create,
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
    ["an empty first name", { firstName: "", lastName: null }],
    ["a whitespace-only name", { firstName: "   ", lastName: null }],
    ["a too-short name", { firstName: "A", lastName: null }],
    ["a too-long name", { firstName: "A".repeat(101), lastName: null }],
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
      email: "ada@example.test",
      phone: "+420 777 777 777",
    });
    expect(find).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ accountId, dotyposCustomerId });
    expect(claim).not.toHaveBeenCalled();
    expect(markDeletionRequested).not.toHaveBeenCalled();
  });

  test("uses the first name alone when the profile has no last name", async () => {
    const { outcome } = await runCurrent({
      profile: profile({ firstName: "Ada", lastName: null }),
    });

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: { name: "Ada" },
    });
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
    ["too long", "+420 777 777 777 777 777"],
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

  test("propagates a profile read failure", async () => {
    const profileFailure = new CustomerAccountAccessError({
      reason: "unavailable",
    });
    const layer = CustomerAccountContactService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.succeed(session()),
          }),
          Layer.mock(CustomerAccountLinkRepository, {
            find: () => Effect.succeed(dotyposCustomerId as never),
          }),
          Layer.mock(CustomerProfileService, {
            load: () => Effect.fail(profileFailure),
          })
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const contacts = yield* CustomerAccountContactService;
      return yield* contacts.current;
    }).pipe(Effect.provide(layer), Effect.result, Effect.runPromise);

    expect(outcome).toMatchObject({ _tag: "Failure", failure: profileFailure });
  });
});
