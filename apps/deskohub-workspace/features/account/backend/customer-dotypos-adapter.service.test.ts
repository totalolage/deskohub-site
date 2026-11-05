import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerProfile,
  type DotyposCustomerWriteRecord,
  DotyposService,
  DotyposUnavailable,
  DotyposUncertain,
  DotyposVersionConflict,
  FindCustomerResult,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import type { CustomerProfileInput } from "../contracts";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

const customerEmail = testEmailAddress("ada");

const makeCustomer = (
  overrides: Partial<DotyposCustomer> = {}
): DotyposCustomer =>
  ({
    id: "60111",
    _cloudId: "cloud",
    firstName: "Ada",
    lastName: null,
    email: null,
    phone: null,
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    expireDate: null,
    ...overrides,
  }) as DotyposCustomer;

/** A customer as a create may return it, without the id Dotypos assigned. */
const createdCustomerWithoutId = (): DotyposCustomerWriteRecord => {
  const { id: _id, ...customer } = makeCustomer();
  return customer;
};

const activeCustomer = makeCustomer();

const expiredCustomer = makeCustomer({
  id: "60222",
  expireDate: "2020-01-01T00:00:00Z",
});

type DotyposServicePartial = Partial<DotyposService["Service"]>;

const runWithDotypos = <A, E>(
  dotypos: DotyposServicePartial,
  run: (
    adapter: CustomerDotyposAdapter["Service"]
  ) => Effect.Effect<A, E, never>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const adapter = yield* CustomerDotyposAdapter;
      return yield* run(adapter);
    }).pipe(
      Effect.provide(
        CustomerDotyposAdapter.Default.pipe(
          Layer.provide(Layer.mock(DotyposService, dotypos))
        )
      )
    )
  );

describe("CustomerDotyposAdapter", () => {
  describe("exact-email classification", () => {
    test("reports a unique expired profile as matched and expired", async () => {
      const result = await runWithDotypos(
        {
          findCustomer: () =>
            Effect.succeed(
              FindCustomerResult.Matched({
                customer: expiredCustomer,
                matches: [expiredCustomer],
              })
            ),
        },
        (adapter) => adapter.classifyExactEmailCustomers(customerEmail)
      );

      expect(result).toEqual({
        kind: "matched",
        state: "expired",
        customerId: "60222",
      });
    });

    test("reports a deleted exact-email profile as unusable instead of not-found", async () => {
      const deleted = makeCustomer({ id: "60333", deleted: true });

      const result = await runWithDotypos(
        {
          findCustomer: () =>
            Effect.succeed(FindCustomerResult.Deleted({ matches: [deleted] })),
        },
        (adapter) => adapter.classifyExactEmailCustomers(customerEmail)
      );

      expect(result).toEqual({ kind: "unusable" });
    });
  });

  describe("profile mapping", () => {
    test("maps optional provider fields onto the closed profile shape", async () => {
      const customer = makeCustomer({
        lastName: "Lovelace",
        phone: "+420 601 111 222",
        companyName: "Analytical Engines",
        companyId: "12345678",
        vatId: "CZ12345678",
        addressLine1: "Pražská 1",
        city: "Praha",
        zip: "11000",
        country: "CZ",
      });

      const profile = await runWithDotypos(
        { getCustomer: () => Effect.succeed(Option.some(customer)) },
        (adapter) => adapter.readCustomerProfile("60111")
      );

      expect(profile).toEqual({
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "+420 601 111 222",
        billing: {
          kind: "business",
          addressLine1: "Pražská 1",
          addressLine2: null,
          city: "Praha",
          zip: "11000",
          country: "CZ",
          companyName: "Analytical Engines",
          companyId: "12345678",
          vatId: "CZ12345678",
        },
      });
    });

    test("maps a provider profile without any billing data to billing null", async () => {
      const profile = await runWithDotypos(
        {
          getCustomer: () =>
            Effect.succeed(
              Option.some(
                makeCustomer({
                  lastName: "Lovelace",
                  companyName: "   ",
                  addressLine1: "",
                })
              )
            ),
        },
        (adapter) => adapter.readCustomerProfile("60111")
      );

      expect(profile).toEqual({
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      });
    });

    test("preserves personal billing when address data exists", async () => {
      const profile = await runWithDotypos(
        {
          getCustomer: () =>
            Effect.succeed(
              Option.some(makeCustomer({ addressLine1: "Pražská 1" }))
            ),
        },
        (adapter) => adapter.readCustomerProfile("60111")
      );

      expect(profile?.billing).toEqual({
        kind: "personal",
        addressLine1: "Pražská 1",
        addressLine2: null,
        city: null,
        zip: null,
        country: null,
        companyName: null,
        companyId: null,
        vatId: null,
      });
    });

    test("keeps a legacy unparseable phone visible instead of normalizing or clearing it", async () => {
      const profile = await runWithDotypos(
        {
          getCustomer: () =>
            Effect.succeed(Option.some(makeCustomer({ phone: "555-ALPHA" }))),
        },
        (adapter) => adapter.readCustomerProfile("60111")
      );

      expect(profile?.phone).toBe("555-ALPHA");
    });

    test("treats definitively missing and deleted profiles as absent", async () => {
      const missing = await runWithDotypos(
        {
          getCustomer: () => Effect.succeed(Option.none()),
        },
        (adapter) => adapter.readCustomerProfile("60111")
      );
      expect(missing).toBeNull();

      const deleted = await runWithDotypos(
        {
          getCustomer: () =>
            Effect.succeed(Option.some(makeCustomer({ deleted: true }))),
        },
        (adapter) => adapter.readCustomerProfile("60111")
      );
      expect(deleted).toBeNull();
    });
  });

  describe("profile and lifecycle writes", () => {
    const missingCustomer = Effect.succeed(Option.none<DotyposCustomer>());
    const conflict = (operation: AccountWriteOperation) =>
      new DotyposVersionConflict({ operation, request: "customer.patch" });
    const uncertain = (operation: AccountWriteOperation) =>
      new DotyposUncertain({
        operation,
        request: "customer.patch",
        reason: "conflict-after-replay",
        httpStatus: 412,
      });

    type AccountWriteOperation =
      | "updateCustomerProfile"
      | "expireCustomer"
      | "reactivateCustomer";

    /** Runs one account write against a package operation that answers `outcomes` in order. */
    const runAccountWrite = async (
      operation: AccountWriteOperation,
      outcomes: ReadonlyArray<
        Effect.Effect<
          Option.Option<DotyposCustomer>,
          DotyposVersionConflict | DotyposUncertain | DotyposUnavailable
        >
      >
    ) => {
      let calls = 0;
      const answer = () => {
        const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
        calls += 1;
        return outcome ?? missingCustomer;
      };
      const reads: string[] = [];
      const result = await runWithDotypos(
        {
          [operation]: answer,
          getCustomer: () => {
            reads.push("read");
            return Effect.succeed(Option.some(activeCustomer));
          },
        },
        (adapter) => {
          switch (operation) {
            case "updateCustomerProfile":
              return adapter
                .updateCustomerProfile("60111", { firstName: "Ada" })
                .pipe(Effect.result);
            case "expireCustomer":
              return adapter.expireCustomer("60111").pipe(Effect.result);
            case "reactivateCustomer":
              return adapter.reactivateCustomer("60222").pipe(Effect.result);
          }
        }
      );
      return { result, calls, reads };
    };

    const accountWriteOperations = [
      "updateCustomerProfile",
      "expireCustomer",
      "reactivateCustomer",
    ] as const;

    test.each(accountWriteOperations)(
      "%s refreshes once after a genuine version conflict",
      async (operation) => {
        const { result, calls, reads } = await runAccountWrite(operation, [
          Effect.fail(conflict(operation)),
          Effect.succeed(Option.some(activeCustomer)),
        ]);

        expect(result._tag).toBe("Success");
        expect(calls).toBe(2);
        expect(reads).toEqual([]);
      }
    );

    test.each(accountWriteOperations)(
      "%s fails the second genuine version conflict without a third attempt",
      async (operation) => {
        const { result, calls } = await runAccountWrite(operation, [
          Effect.fail(conflict(operation)),
          Effect.fail(conflict(operation)),
          Effect.succeed(Option.some(activeCustomer)),
        ]);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposVersionConflict" },
        });
        expect(calls).toBe(2);
      }
    );

    test.each(accountWriteOperations)(
      "%s keeps an uncertain write uncertain without retrying or rereading",
      async (operation) => {
        const failure = uncertain(operation);
        const { result, calls, reads } = await runAccountWrite(operation, [
          Effect.fail(failure),
          Effect.succeed(Option.some(activeCustomer)),
        ]);

        expect(result).toMatchObject({ _tag: "Failure", failure });
        expect(calls).toBe(1);
        expect(reads).toEqual([]);
      }
    );

    test.each(accountWriteOperations)(
      "%s keeps an uncertain refresh uncertain without a third attempt",
      async (operation) => {
        const failure = uncertain(operation);
        const { result, calls } = await runAccountWrite(operation, [
          Effect.fail(conflict(operation)),
          Effect.fail(failure),
          Effect.succeed(Option.some(activeCustomer)),
        ]);

        expect(result).toMatchObject({ _tag: "Failure", failure });
        expect(calls).toBe(2);
      }
    );

    test.each(accountWriteOperations)(
      "%s fails an unavailable write without retrying",
      async (operation) => {
        const failure = new DotyposUnavailable({
          operation,
          request: "customer.patch",
          reason: "server",
          httpStatus: 503,
        });
        const { result, calls } = await runAccountWrite(operation, [
          Effect.fail(failure),
          Effect.succeed(Option.some(activeCustomer)),
        ]);

        expect(result).toMatchObject({ _tag: "Failure", failure });
        expect(calls).toBe(1);
      }
    );

    test("reports an already missing customer as none when expiring", async () => {
      const { result } = await runAccountWrite("expireCustomer", [
        missingCustomer,
      ]);

      expect(result).toMatchObject({ _tag: "Success" });
      if (result._tag === "Success") {
        expect(Option.isNone(result.success as Option.Option<unknown>)).toBe(
          true
        );
      }
    });

    test("returns the expired customer the package answers", async () => {
      const expired = makeCustomer({ expireDate: "2020-01-01T00:00:00Z" });
      const outcome = await runWithDotypos(
        { expireCustomer: () => Effect.succeed(Option.some(expired)) },
        (adapter) => adapter.expireCustomer("60111")
      );

      expect(outcome).toEqual(Option.some(expired));
    });

    test.each(["updateCustomerProfile", "reactivateCustomer"] as const)(
      "%s fails a missing customer as DotyposCustomerMissing",
      async (operation) => {
        const { result } = await runAccountWrite(operation, [missingCustomer]);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "DotyposCustomerMissing",
            customerId: expect.any(String),
          },
        });
      }
    );
  });

  describe("profile updates", () => {
    const writeProfile = async (input: CustomerProfileInput) => {
      const profiles: DotyposCustomerProfile[] = [];
      await runWithDotypos(
        {
          updateCustomerProfile: (_id, profile) => {
            profiles.push(profile);
            return Effect.succeed(Option.some(makeCustomer()));
          },
        },
        (adapter) => adapter.updateCustomerProfile("60111", input)
      );
      return profiles;
    };

    test("sends explicit clearing values, a blank phone included, instead of omitting optional fields", async () => {
      const profiles = await writeProfile({
        firstName: "Ada",
        lastName: undefined,
        phone: undefined,
        billing: undefined,
      });

      expect(profiles).toEqual([
        {
          firstName: "Ada",
          lastName: "",
          phone: "",
          addressLine1: "",
          addressLine2: "",
          city: "",
          zip: "",
          country: "",
          companyName: "",
          companyId: "",
          vatId: "",
        },
      ]);
    });

    test("passes the validated phone for the package to normalize", async () => {
      const profiles = await writeProfile({
        firstName: "Ada",
        phone: "+420 601 111 222",
      });

      expect(profiles[0]?.phone).toBe("+420 601 111 222");
    });

    test("clears business billing when the profile switches to personal", async () => {
      const profiles = await writeProfile({
        firstName: "Ada",
        billing: {
          kind: "personal",
          addressLine1: "Pražská 1",
          addressLine2: undefined,
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
      });

      expect(profiles[0]).toMatchObject({
        addressLine1: "Pražská 1",
        addressLine2: "",
        companyName: "",
        companyId: "",
        vatId: "",
      });
    });

    test("sends business billing fields", async () => {
      const profiles = await writeProfile({
        firstName: "Ada",
        billing: {
          kind: "business",
          companyName: "Analytical Engines",
          companyId: "12345678",
          vatId: undefined,
          addressLine1: undefined,
          addressLine2: undefined,
          city: undefined,
          zip: undefined,
          country: undefined,
        },
      });

      expect(profiles[0]).toMatchObject({
        companyName: "Analytical Engines",
        companyId: "12345678",
        vatId: "",
        addressLine1: "",
      });
    });
  });

  describe("profile creation", () => {
    test("returns the created id and mapped create response without an extra provider read", async () => {
      const calls: string[] = [];
      const details: unknown[] = [];

      const created = await runWithDotypos(
        {
          createCustomer: (input) => {
            calls.push("create");
            details.push(input);
            return Effect.succeed(
              makeCustomer({
                id: "60999",
                lastName: "Lovelace",
                phone: "+420 601 111 222",
                companyName: "Analytical Engines",
                companyId: "12345678",
                vatId: "CZ12345678",
                addressLine1: "Pražská 1",
                city: "Praha",
                zip: "11000",
                country: "CZ",
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(makeCustomer()));
          },
        },
        (adapter) =>
          adapter.createCustomerProfile({
            email: customerEmail,
            profile: {
              firstName: "Ada",
              lastName: "Lovelace",
              phone: "+420601111222",
              billing: {
                kind: "business",
                companyName: "Analytical Engines",
                companyId: "12345678",
                vatId: "CZ12345678",
                addressLine1: "Pražská 1",
              },
            },
          })
      );

      expect(created).toEqual({
        customerId: "60999",
        profile: {
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "+420 601 111 222",
          billing: {
            kind: "business",
            addressLine1: "Pražská 1",
            addressLine2: null,
            city: "Praha",
            zip: "11000",
            country: "CZ",
            companyName: "Analytical Engines",
            companyId: "12345678",
            vatId: "CZ12345678",
          },
        },
      });
      expect(calls).toEqual(["create"]);
      expect(details[0]).toMatchObject({
        firstName: "Ada",
        lastName: "Lovelace",
        email: customerEmail,
      });
    });

    test("recovers the id and profile from the exact-email match when creation returns no id", async () => {
      const calls: string[] = [];
      const matched = makeCustomer({
        id: "60777",
        lastName: "Lovelace",
        phone: "+420601111222",
      });

      const created = await runWithDotypos(
        {
          createCustomer: () => {
            calls.push("create");
            return Effect.succeed(createdCustomerWithoutId());
          },
          findCustomer: () => {
            calls.push("find");
            return Effect.succeed(
              FindCustomerResult.Matched({
                customer: matched,
                matches: [matched],
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(makeCustomer()));
          },
        },
        (adapter) =>
          adapter.createCustomerProfile({
            email: customerEmail,
            profile: { firstName: "Ada" },
          })
      );

      expect(created).toEqual({
        customerId: "60777",
        profile: {
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "+420601111222",
          billing: null,
        },
      });
      expect(calls).toEqual(["create", "find"]);
    });

    test("fails with the unusable-create error when the exact-email fallback has no match", async () => {
      const outcome = await runWithDotypos(
        {
          createCustomer: () => Effect.succeed(createdCustomerWithoutId()),
          findCustomer: () =>
            Effect.succeed(FindCustomerResult.NotFound({ matches: [] })),
        },
        (adapter) =>
          adapter
            .createCustomerProfile({
              email: customerEmail,
              profile: { firstName: "Ada" },
            })
            .pipe(Effect.result)
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "MissingDotyposId", entity: "customer" },
      });
    });
  });
});
