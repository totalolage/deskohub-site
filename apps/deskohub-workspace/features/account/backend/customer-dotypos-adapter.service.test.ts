import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  DotyposRejected,
  DotyposService,
  DotyposUnavailable,
  DotyposUncertain,
  DotyposVersionConflict,
  FindCustomerResult,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import {
  CustomerDotyposAdapter,
  customerProfileAppliesInput,
} from "./customer-dotypos-adapter.service";

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

const activeCustomer = makeCustomer();

const uncertainPatch = (reason: DotyposUncertain["reason"] = "transport") =>
  new DotyposUncertain({
    operation: "patchCustomer",
    request: "customer.patch",
    reason,
  });
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

  describe("expiration and reactivation", () => {
    test("expires with a fresh ETag and a past expireDate", async () => {
      const calls: string[] = [];
      const payloads: unknown[] = [];

      await runWithDotypos(
        {
          patchCustomer: (_id, payload) => {
            calls.push("patch");
            payloads.push(payload);
            return Effect.succeed(
              Option.some(makeCustomer({ expireDate: "2020-01-01T00:00:00Z" }))
            );
          },
        },
        (adapter) => adapter.expireCustomer("60111")
      );

      expect(calls).toEqual(["patch"]);
      expect(payloads).toHaveLength(1);
      const payload = payloads[0] as { expireDate: string };
      expect(payload.expireDate).not.toBeNull();
      expect(new Date(payload.expireDate).getTime()).toBeLessThan(Date.now());
    });

    test("reactivates by clearing expireDate", async () => {
      const payloads: unknown[] = [];

      await runWithDotypos(
        {
          patchCustomer: (_id, payload) => {
            payloads.push(payload);
            return Effect.succeed(Option.some(makeCustomer()));
          },
        },
        (adapter) => adapter.reactivateCustomer("60222")
      );

      expect(payloads).toEqual([{ expireDate: null }]);
    });

    test("does not treat an uncertain response followed by a missing profile as reactivated", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(uncertainPatch());
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.none());
          },
        },
        (adapter) => adapter.reactivateCustomer("60222").pipe(Effect.result)
      );

      expect(calls).toContain("read");
      expect(outcome._tag).toBe("Failure");
    });

    test("rereads after an uncertain response and retries only when unapplied", async () => {
      const calls: string[] = [];
      let patchCount = 0;

      await runWithDotypos(
        {
          patchCustomer: () => {
            patchCount += 1;
            calls.push("patch");
            if (patchCount === 1) {
              return Effect.fail(uncertainPatch());
            }
            return Effect.succeed(Option.some(makeCustomer()));
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.reactivateCustomer("60222")
      );

      expect(calls).toEqual(["patch", "read", "patch"]);
    });

    test("accepts an uncertain response once a reread shows it applied", async () => {
      const calls: string[] = [];

      await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(uncertainPatch());
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111")
      );

      expect(calls).toEqual(["patch", "read"]);
    });

    test("retries once on an ETag conflict and fails after a second conflict", async () => {
      const calls: string[] = [];
      const conflict = () =>
        new DotyposVersionConflict({
          operation: "patchCustomer",
          request: "customer.patch",
        });

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(conflict());
          },
        },
        (adapter) => adapter.reactivateCustomer("60222").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "patch"]);
      expect(outcome._tag).toBe("Failure");
    });

    test("rereads again after a second uncertain response and then fails with the patch error", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(uncertainPatch("server"));
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.reactivateCustomer("60222").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "read", "patch", "read", "read"]);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({
          _tag: "DotyposUncertain",
          operation: "patchCustomer",
          reason: "server",
        });
      }
    });

    test("accepts a second uncertain response once the final reread shows it applied", async () => {
      const calls: string[] = [];
      let reads = 0;

      await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(uncertainPatch());
          },
          getCustomer: () => {
            calls.push("read");
            reads += 1;
            return Effect.succeed(
              Option.some(reads < 3 ? activeCustomer : expiredCustomer)
            );
          },
        },
        (adapter) => adapter.expireCustomer("60111")
      );

      expect(calls).toEqual(["patch", "read", "patch", "read", "read"]);
    });

    test("fails with a reread failure without retrying the patch", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(uncertainPatch());
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.fail(
              new DotyposUnavailable({
                operation: "getCustomer",
                request: "customer.get",
                reason: "server",
              })
            );
          },
        },
        (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "read"]);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({ operation: "getCustomer" });
      }
    });

    test("fails a definitive rejection without rereading or retrying", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposRejected({
                operation: "patchCustomer",
                request: "customer.patch",
                reason: "invalid-request",
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch"]);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({
          _tag: "DotyposRejected",
          reason: "invalid-request",
        });
      }
    });

    test("accepts an exhausted rate limit once a reread shows it applied", async () => {
      const calls: string[] = [];

      await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposUnavailable({
                operation: "patchCustomer",
                request: "customer.patch",
                reason: "rate-limited",
                httpStatus: 429,
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111")
      );

      expect(calls).toEqual(["patch", "read"]);
    });

    test("rereads around the replay of an exhausted rate limit and then fails with it", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposUnavailable({
                operation: "patchCustomer",
                request: "customer.patch",
                reason: "rate-limited",
                httpStatus: 429,
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(activeCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "read", "patch", "read", "read"]);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({
          _tag: "DotyposUnavailable",
          reason: "rate-limited",
        });
      }
    });

    test("rereads around the replay of a failed version read and then fails with it", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposUnavailable({
                operation: "patchCustomer",
                request: "customer.version",
                reason: "server",
                httpStatus: 503,
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.reactivateCustomer("60222").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "read", "patch", "read", "read"]);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({
          _tag: "DotyposUnavailable",
          request: "customer.version",
        });
      }
    });

    // Malformed entity identifiers in the answer also fail without a status.
    for (const httpStatus of [undefined, 200]) {
      test(`fails an unreadable patch response (status ${httpStatus}) without rereading or retrying`, async () => {
        const calls: string[] = [];

        const outcome = await runWithDotypos(
          {
            patchCustomer: () => {
              calls.push("patch");
              return Effect.fail(
                new DotyposUncertain({
                  operation: "patchCustomer",
                  request: "customer.patch",
                  reason: "invalid-response",
                  ...(httpStatus !== undefined && { httpStatus }),
                })
              );
            },
            getCustomer: () => {
              calls.push("read");
              return Effect.succeed(Option.some(expiredCustomer));
            },
          },
          (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
        );

        expect(calls).toEqual(["patch"]);
        expect(outcome._tag).toBe("Failure");
        if (outcome._tag === "Failure") {
          expect(outcome.failure).toMatchObject({
            _tag: "DotyposUncertain",
            reason: "invalid-response",
          });
        }
      });
    }

    test("fails a replayed patch whose last attempt was rejected without rereading", async () => {
      const calls: string[] = [];
      const lastAttempt = new DotyposRejected({
        operation: "patchCustomer",
        request: "customer.patch",
        reason: "invalid-request",
        httpStatus: 400,
      });

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposUncertain({
                operation: "patchCustomer",
                request: "customer.patch",
                reason: "server",
                httpStatus: 400,
                cause: lastAttempt,
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch"]);
      expect(outcome._tag).toBe("Failure");
    });

    test("replays once without rereading when a replayed patch ends in a version conflict", async () => {
      const calls: string[] = [];
      const lastAttempt = new DotyposVersionConflict({
        operation: "patchCustomer",
        request: "customer.patch",
        httpStatus: 412,
      });

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposUncertain({
                operation: "patchCustomer",
                request: "customer.patch",
                reason: "conflict-after-replay",
                httpStatus: 412,
                cause: lastAttempt,
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "patch"]);
      expect(outcome._tag).toBe("Failure");
    });

    test("fails without replaying or rereading when the version read answers 409", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(
              new DotyposRejected({
                operation: "patchCustomer",
                request: "customer.version",
                reason: "invalid-request",
                httpStatus: 409,
              })
            );
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(Option.some(expiredCustomer));
          },
        },
        (adapter) => adapter.expireCustomer("60111").pipe(Effect.result)
      );

      expect(calls).toEqual(["patch"]);
      expect(outcome._tag).toBe("Failure");
    });

    test("reports an already missing customer as none when expiring", async () => {
      const outcome = await runWithDotypos(
        { patchCustomer: () => Effect.succeed(Option.none()) },
        (adapter) => adapter.expireCustomer("60111")
      );

      expect(Option.isNone(outcome)).toBe(true);
    });

    test("fails reactivation and profile updates of a missing customer", async () => {
      const dotypos = { patchCustomer: () => Effect.succeed(Option.none()) };

      const reactivation = await runWithDotypos(dotypos, (adapter) =>
        adapter.reactivateCustomer("60222").pipe(Effect.result)
      );
      const update = await runWithDotypos(dotypos, (adapter) =>
        adapter
          .updateCustomerProfile("60111", {
            firstName: "Ada",
            lastName: "Lovelace",
            billing: undefined,
          })
          .pipe(Effect.result)
      );

      for (const outcome of [reactivation, update]) {
        expect(outcome._tag).toBe("Failure");
        if (outcome._tag === "Failure") {
          expect(outcome.failure).toMatchObject({
            _tag: "DotyposCustomerMissing",
            customerId: expect.any(String),
          });
        }
      }
    });
  });

  describe("uncertain-response comparison", () => {
    test("treats clearing to no billing as applied", () => {
      expect(
        customerProfileAppliesInput(makeCustomer(), {
          firstName: "Ada",
          billing: undefined,
        })
      ).toBe(true);
      expect(
        customerProfileAppliesInput(
          makeCustomer({ lastName: "   ", phone: "  " }),
          { firstName: "Ada", billing: undefined }
        )
      ).toBe(true);
    });

    test("reconciles whitespace-only personal billing as cleared", () => {
      expect(
        customerProfileAppliesInput(makeCustomer(), {
          firstName: "Ada",
          billing: {
            kind: "personal",
            addressLine1: "   ",
            addressLine2: "",
            city: "",
            zip: "",
            country: "",
          },
        })
      ).toBe(true);
    });

    test("reports unapplied when billing data remains while the input clears billing", () => {
      expect(
        customerProfileAppliesInput(
          makeCustomer({ addressLine1: "Pražská 1" }),
          { firstName: "Ada", billing: undefined }
        )
      ).toBe(false);
    });

    test("reports unapplied when the input adds billing to a profile without billing data", () => {
      expect(
        customerProfileAppliesInput(makeCustomer(), {
          firstName: "Ada",
          billing: {
            kind: "personal",
            addressLine1: "Pražská 1",
          },
        })
      ).toBe(false);
    });
  });

  describe("profile updates", () => {
    test("sends explicit clearing values instead of omitting optional fields", async () => {
      const payloads: unknown[] = [];

      await runWithDotypos(
        {
          patchCustomer: (_id, payload) => {
            payloads.push(payload);
            return Effect.succeed(Option.some(makeCustomer()));
          },
        },
        (adapter) =>
          adapter.updateCustomerProfile("60111", {
            firstName: "Ada",
            lastName: undefined,
            phone: undefined,
            billing: undefined,
          })
      );

      expect(payloads).toEqual([
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

    test("clears business billing when the profile switches to personal", async () => {
      const payloads: unknown[] = [];

      await runWithDotypos(
        {
          patchCustomer: (_id, payload) => {
            payloads.push(payload);
            return Effect.succeed(Option.some(makeCustomer()));
          },
        },
        (adapter) =>
          adapter.updateCustomerProfile("60111", {
            firstName: "Ada",
            billing: {
              kind: "personal",
              addressLine1: "Pražská 1",
              addressLine2: undefined,
              city: "Praha",
              zip: "11000",
              country: "CZ",
            },
          })
      );

      expect(payloads[0]).toMatchObject({
        addressLine1: "Pražská 1",
        addressLine2: "",
        companyName: "",
        companyId: "",
        vatId: "",
      });
    });

    test("retries an uncertain optional-only update whose reread shows it unapplied", async () => {
      const calls: string[] = [];
      let patchCount = 0;

      await runWithDotypos(
        {
          patchCustomer: () => {
            patchCount += 1;
            calls.push("patch");
            return Effect.fail(uncertainPatch());
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(
              Option.some(
                makeCustomer({ lastName: "Old-name", phone: "+420601111222" })
              )
            );
          },
        },
        (adapter) =>
          adapter
            .updateCustomerProfile("60111", {
              firstName: "Ada",
              lastName: undefined,
              phone: undefined,
              billing: undefined,
            })
            .pipe(Effect.result)
      );

      expect(calls[0]).toBe("patch");
      expect(calls[1]).toBe("read");
      expect(patchCount).toBe(2);
    });

    test("accepts an uncertain optional-only clearing update once a reread shows it applied", async () => {
      const calls: string[] = [];

      const outcome = await runWithDotypos(
        {
          patchCustomer: () => {
            calls.push("patch");
            return Effect.fail(uncertainPatch());
          },
          getCustomer: () => {
            calls.push("read");
            return Effect.succeed(
              Option.some(makeCustomer({ lastName: "Lovelace" }))
            );
          },
        },
        (adapter) =>
          adapter
            .updateCustomerProfile("60111", {
              firstName: "Ada",
              lastName: "Lovelace",
              billing: undefined,
            })
            .pipe(Effect.result)
      );

      expect(calls).toEqual(["patch", "read"]);
      expect(outcome._tag).toBe("Success");
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
            return Effect.succeed(makeCustomer({ id: undefined }));
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
          createCustomer: () => Effect.succeed(makeCustomer({ id: undefined })),
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
