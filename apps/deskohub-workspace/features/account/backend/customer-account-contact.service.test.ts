import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Result } from "effect";
import { getReviewAccountContact } from "@/features/review-accounts";
import type { CustomerProfile } from "../contracts";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "../customer-account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import {
  type PeekedStanding,
  peeking,
  type TestPeekedStandingLabel,
  testPeekedStandingLabels,
  testPeekedStandings,
} from "./current-customer-account.test-utils";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import { CustomerProfileService } from "./customer-profile.service";

const { accountId, email: customerEmail } = testCustomerSession;
const { dotyposCustomerId } = testLinkedAccount;

const profile = (
  overrides: Partial<CustomerProfile> = {}
): CustomerProfile => ({
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420 777 777 777",
  billing: null,
  ...overrides,
});

/**
 * The contact service over a faked standing (`peek` answers `standing`) and
 * profile service; the standing table test covers how the standing is read.
 */
const runCurrent = (
  options: {
    readonly standing?: PeekedStanding | CustomerAccountAccessError;
    readonly profile?: CustomerProfile;
    readonly create?: ReturnType<typeof mock>;
  } = {},
  operation: (
    contacts: CustomerAccountContactService["Service"]
  ) => Effect.Effect<unknown, CustomerAccountAccessError> = (contacts) =>
    contacts.current
) => {
  const load = mock(() => Effect.succeed(options.profile ?? profile()));
  const create =
    options.create ?? mock(() => Effect.die("create must not be called"));
  const update = mock(() => Effect.die("update must not be called"));
  const calls = { peeks: 0 };

  const layer = CustomerAccountContactService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        peeking(options.standing ?? testPeekedStandings.linked, calls),
        Layer.mock(CustomerProfileService, { load, create, update })
      )
    )
  );

  return Effect.gen(function* () {
    const contacts = yield* CustomerAccountContactService;
    return yield* operation(contacts);
  })
    .pipe(Effect.provide(layer), Effect.result, Effect.runPromise)
    .then((outcome) => ({ outcome, calls, load, create, update }));
};

const linkedContact = {
  accountId,
  dotyposCustomerId,
  name: "Ada Lovelace",
  email: customerEmail,
  phone: "+420 777 777 777",
};

describe("CustomerAccountContactService.current", () => {
  // The booking contact's policy, one row per standing `peek` reports.
  const expected: Record<
    TestPeekedStandingLabel,
    | { readonly contact: unknown }
    | { readonly failure: CustomerAccountAccessError }
  > = {
    "signed out": { contact: null },
    unverified: {
      failure: new CustomerAccountAccessError({ reason: "unverified-email" }),
    },
    "awaiting deletion": { contact: null },
    "awaiting deletion, review marker present": { contact: null },
    "awaiting deletion, review marker unreadable": { contact: null },
    "review account": {
      contact: { accountId, ...getReviewAccountContact(customerEmail) },
    },
    unlinked: { contact: null },
    // As the review marker read failed before.
    "unlinked, review marker unreadable": {
      failure: customerAccountUnavailable("account-link.read"),
    },
    linked: { contact: linkedContact },
    "linked, review marker unreadable": { contact: linkedContact },
    "link unavailable": {
      failure: customerAccountUnavailable("account-link.read"),
    },
  };

  test.each(testPeekedStandingLabels)(
    "answers the standing %s with its own contact policy",
    async (label) => {
      const standing = testPeekedStandings[label];
      const { outcome, calls, load, create } = await runCurrent({ standing });
      const row = expected[label];

      if ("contact" in row) {
        expect(Result.getOrThrow(outcome)).toEqual(row.contact);
      } else {
        expect(outcome).toEqual(Result.fail(row.failure));
      }
      expect(calls.peeks).toBe(1);
      // Only a linked account's profile is read.
      expect(load).toHaveBeenCalledTimes(standing.kind === "linked" ? 1 : 0);
      expect(create).not.toHaveBeenCalled();
    }
  );

  test("fails with the session read's error", async () => {
    const failure = customerAccountUnavailable("authentication.session");

    const { outcome } = await runCurrent({ standing: failure });

    expect(outcome).toEqual(Result.fail(failure));
  });

  test("reads the linked account's profile by its stored link", async () => {
    const { load } = await runCurrent();

    expect(load).toHaveBeenCalledWith(testLinkedAccount);
  });

  test.each([
    ["a whitespace-only name", { firstName: "   ", lastName: null }],
    ["a too-short name", { firstName: "A", lastName: null }],
  ] as const)("returns null for a profile with %s", async (_label, name) => {
    const { outcome } = await runCurrent({ profile: profile(name) });

    expect(outcome).toMatchObject({ _tag: "Success", success: null });
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

  test.each([
    // What the Workspace writes: kept, it reads the same in every locale.
    ["in E.164 form", "+420777777777", "+420777777777"],
    // Entered without a country calling code, such as at the till: read in
    // the base locale's region and offered with one, so a de-DE checkout
    // doesn't read it as a German number.
    ["as a national number", "777 777 777", "+420 777 777 777"],
    ["with an international prefix", "00420777777777", "+420 777 777 777"],
  ] as const)(
    "offers a stored phone written %s in a form every locale reads alike",
    async (_label, phone, offered) => {
      const { outcome } = await runCurrent({ profile: profile({ phone }) });

      expect(outcome).toMatchObject({
        _tag: "Success",
        success: { phone: offered },
      });
    }
  );
});

describe("CustomerAccountContactService.completeProfile", () => {
  const profileInput = {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: "+420 777 777 777",
  };
  const unlinkedAccount = { accountId, email: customerEmail };

  const runComplete = (createdProfile: CustomerProfile) => {
    const create = mock(() =>
      Effect.succeed({
        account: { accountId, dotyposCustomerId: "60999" },
        profile: createdProfile,
        created: true,
      })
    );
    return runCurrent({ create }, (contacts) =>
      contacts.completeProfile(unlinkedAccount, profileInput)
    );
  };

  test("creates the account's profile and returns its contact", async () => {
    const { outcome, create, calls, load } = await runComplete(profile());

    expect(Result.getOrThrow(outcome)).toEqual({
      accountId,
      dotyposCustomerId: "60999",
      name: "Ada Lovelace",
      email: customerEmail,
      phone: "+420 777 777 777",
    });
    expect(create).toHaveBeenCalledWith(accountId, profileInput);
    expect(calls.peeks).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  test("returns null when the saved profile's name cannot book", async () => {
    const { outcome } = await runComplete(
      profile({ firstName: "A", lastName: null })
    );

    expect(Result.getOrThrow(outcome)).toBeNull();
  });

  test("keeps the profile creation failure", async () => {
    const create = mock(() =>
      Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "claimed",
        })
      )
    );
    const { outcome } = await runCurrent({ create }, (contacts) =>
      contacts.completeProfile(unlinkedAccount, profileInput)
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: "link-required", linkReason: "claimed" },
    });
  });
});
