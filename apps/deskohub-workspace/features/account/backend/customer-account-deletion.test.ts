import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  DotyposCustomerSchema,
  DotyposRejected,
  DotyposService,
  DotyposUnavailable,
  DotyposUncertain,
  DotyposVersionConflict,
} from "@deskohub/dotypos";
import { Effect, Layer, Logger, Option, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";
import { customerAccountIdSchema } from "../customer-account";
import {
  type CustomerAccountDeletionDependencies,
  expireLinkedDotyposProfile,
} from "./customer-account-deletion";
import { CustomerAccountSections } from "./customer-account-sections";
import {
  type CustomerAccountSectionsFixture,
  makeCustomerAccountSections,
} from "./customer-account-sections.test-utils";
import { CustomerAvatarProviderError } from "./customer-avatar.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

const accountId = customerAccountIdSchema.make("auth-user-1");

const makeDependencies = (
  overrides: {
    readonly link?: string | null;
    readonly reviewAccount?: boolean;
    readonly expireOutcome?: ReturnType<
      CustomerAccountDeletionDependencies["expireCustomer"]
    >;
    readonly avatarOutcome?: Effect.Effect<void, unknown>;
    readonly account?: CustomerAccountSectionsFixture;
  } & Partial<CustomerAccountDeletionDependencies> = {}
) => {
  // The real sections, whose lock and recheck events share the call log.
  const { layer, events: calls } = makeCustomerAccountSections(
    overrides.account
  );
  const sections = Effect.runSync(
    Effect.service(CustomerAccountSections).pipe(Effect.provide(layer))
  );
  const dependencies: CustomerAccountDeletionDependencies = {
    isReviewAccount: () => {
      calls.push("review-check");
      return Effect.succeed(overrides.reviewAccount ?? false);
    },
    markDeletionRequested: () => {
      calls.push("marker");
      return Effect.void;
    },
    findLink: () => {
      calls.push("find-link");
      return Effect.succeed(
        "link" in overrides ? (overrides.link ?? null) : "60111"
      );
    },
    expireCustomer: () => {
      calls.push("expire");
      return (overrides.expireOutcome ??
        Effect.succeed(Option.some({} as never))) as ReturnType<
        CustomerAccountDeletionDependencies["expireCustomer"]
      >;
    },
    destroyAvatar: () => {
      calls.push("destroy-avatar");
      return (overrides.avatarOutcome ?? Effect.void) as Effect.Effect<
        void,
        never
      >;
    },
    tombstone: () => {
      calls.push("tombstone");
      return Effect.void;
    },
    withActiveAccount: sections.withActiveAccount,
    anonymiseAnalyticsPerson: () => {
      calls.push("anonymise-analytics-person");
      return Effect.void;
    },
    ...overrides,
  };
  return { dependencies, calls };
};

describe("Customer account deletion", () => {
  test("marks, expires the provider profile, and leaves the tombstone last under the lock", async () => {
    const { dependencies, calls } = makeDependencies();

    await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId)
    );

    expect(calls).toEqual([
      "review-check",
      "account-lock-acquired",
      "account-activity",
      "marker",
      "find-link",
      "expire",
      "destroy-avatar",
      "tombstone",
      "account-lock-released",
      "anonymise-analytics-person",
    ]);
  });

  test("refuses a review account before it marks, expires, or tombstones anything", async () => {
    const { dependencies, calls } = makeDependencies({
      link: null,
      reviewAccount: true,
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.flip)
    );

    expect(outcome._tag).toBe("ReviewAccountDeletionRefusedError");
    expect(calls).toEqual(["review-check"]);
  });

  test("keeps the durable marker when the provider call fails retryably", async () => {
    const { dependencies, calls } = makeDependencies({
      expireOutcome: Effect.fail(
        new DotyposUncertain({
          operation: "expireCustomer",
          reason: "transport",
        })
      ),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).toEqual([
      "review-check",
      "account-lock-acquired",
      "account-activity",
      "marker",
      "find-link",
      "expire",
      "account-lock-released",
    ]);
  });

  test("leaves no tombstone while the avatar cleanup can still be retried", async () => {
    const { dependencies, calls } = makeDependencies({
      avatarOutcome: Effect.fail(new CustomerAvatarProviderError({})),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).not.toContain("tombstone");
    expect(calls).not.toContain("anonymise-analytics-person");
  });

  test("requests no PostHog person anonymisation when the provider cleanup fails", async () => {
    const { dependencies, calls } = makeDependencies({
      expireOutcome: Effect.fail(
        new DotyposUnavailable({
          operation: "expireCustomer",
          reason: "server",
        })
      ),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).not.toContain("anonymise-analytics-person");
  });

  test("completes the deletion and logs no identifier when the PostHog person anonymisation dies or throws", async () => {
    for (const failure of ["dies", "throws"] as const) {
      let anonymisationRequests = 0;
      const logged: unknown[] = [];
      const { dependencies, calls } = makeDependencies({
        anonymiseAnalyticsPerson: (id) => {
          anonymisationRequests += 1;
          const defect = new Error(`synthetic defect for ${id}`);
          if (failure === "throws") throw defect;
          return Effect.die(defect);
        },
      });

      const outcome = await Effect.runPromise(
        expireLinkedDotyposProfile(dependencies)(accountId).pipe(
          Effect.result,
          Effect.provide(
            Logger.layer([
              Logger.make(({ message }) => {
                logged.push(message);
              }),
            ])
          )
        )
      );

      expect(outcome._tag).toBe("Success");
      expect(anonymisationRequests).toBe(1);
      expect(calls.slice(-2)).toEqual(["tombstone", "account-lock-released"]);
      expect(JSON.stringify(logged)).toContain(
        "account.deletion.analytics-person-not-scheduled"
      );
      expect(JSON.stringify(logged)).not.toContain(accountId);
    }
  });

  test("tolerates a definitively missing provider profile", async () => {
    const { dependencies, calls } = makeDependencies({
      expireOutcome: Effect.succeed(Option.none()),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Success");
    expect(calls).toContain("expire");
  });

  test("skips the provider when no link exists yet", async () => {
    const { dependencies, calls } = makeDependencies({ link: null });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Success");
    expect(calls).toEqual([
      "review-check",
      "account-lock-acquired",
      "account-activity",
      "marker",
      "find-link",
      "destroy-avatar",
      "tombstone",
      "account-lock-released",
      "anonymise-analytics-person",
    ]);
  });

  test("retries with the deletion marker already set", async () => {
    const { dependencies, calls } = makeDependencies({
      account: { activityState: "deletion-requested" },
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Success");
    expect(calls).toEqual([
      "review-check",
      "account-lock-acquired",
      "account-activity",
      "marker",
      "find-link",
      "expire",
      "destroy-avatar",
      "tombstone",
      "account-lock-released",
      "anonymise-analytics-person",
    ]);
  });

  test("fails unauthenticated before it marks anything when the account is gone", async () => {
    const { dependencies, calls } = makeDependencies({
      account: { activityState: "missing" },
    });

    const failure = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.flip)
    );

    expect(failure).toMatchObject({
      _tag: "CustomerAccountAccessError",
      reason: "unauthenticated",
    });
    expect(calls).toEqual([
      "review-check",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
  });

  test("fails retryably as an unavailable account lock before it marks anything", async () => {
    const { dependencies, calls } = makeDependencies({
      account: { lockUnavailable: true },
    });

    const failure = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.flip)
    );

    expect(failure).toMatchObject({
      _tag: "CustomerAccountAccessError",
      reason: "unavailable",
      cause: { code: "account-link.lock" },
    });
    expect(calls).toEqual(["review-check"]);
  });

  describe("with the Dotypos adapter", () => {
    const tokenNotFound = new DotyposRejected({
      operation: "expireCustomer",
      request: "customer.version",
      reason: "unauthorized",
      httpStatus: 404,
    });
    const expiredCustomer = Schema.decodeSync(DotyposCustomerSchema)({
      id: "60111",
      _cloudId: "cloud",
      firstName: "Ada",
      points: "0",
      flags: "0",
      display: true,
      deleted: false,
      expireDate: "2020-01-01T00:00:00Z",
    });
    const replayConflict = new DotyposUncertain({
      operation: "expireCustomer",
      request: "customer.patch",
      reason: "conflict-after-replay",
      httpStatus: 412,
    });

    const deleteWithDotypos = async (
      dotypos: Partial<DotyposService["Service"]>
    ) => {
      const logCodes: unknown[] = [];
      const capturingLogger = Logger.make(({ message }) => {
        const [, annotations] = Array.isArray(message) ? message : [];
        logCodes.push((annotations as { code?: unknown } | undefined)?.code);
      });
      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* CustomerDotyposAdapter;
          const { dependencies, calls } = makeDependencies({
            expireCustomer: (customerId) => {
              calls.push("expire");
              return adapter.expireCustomer(customerId);
            },
          });
          const result = yield* expireLinkedDotyposProfile(dependencies)(
            accountId
          ).pipe(Effect.result);
          return { result, calls };
        }).pipe(
          Effect.provide(
            CustomerDotyposAdapter.Default.pipe(
              Layer.provide(Layer.mock(DotyposService, dotypos))
            )
          ),
          Effect.provide(Logger.layer([capturingLogger]))
        )
      );
      return { ...outcome, logCodes };
    };

    test("keeps deletion retryable when an access-token 404 ends the expiration", async () => {
      const { result, calls, logCodes } = await deleteWithDotypos({
        expireCustomer: () => Effect.fail(tokenNotFound),
      });

      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).not.toContain("dotypos.customer-expiration.missing");
      expect(logCodes).toContain("account.deletion.retryable");
    });

    test("completes deletion once the expiration finds the customer missing", async () => {
      const { result, calls, logCodes } = await deleteWithDotypos({
        expireCustomer: () => Effect.succeed(Option.none<DotyposCustomer>()),
      });

      expect(result._tag).toBe("Success");
      expect(calls).toContain("destroy-avatar");
      expect(calls).toContain("tombstone");
      expect(logCodes).toContain("dotypos.customer-expiration.missing");
      expect(logCodes).not.toContain("account.deletion.retryable");
    });

    test("keeps deletion retryable while the expiration stays uncertain, without repeating it", async () => {
      const dotyposCalls: string[] = [];
      const { result, calls, logCodes } = await deleteWithDotypos({
        expireCustomer: () => {
          dotyposCalls.push("expire");
          return Effect.fail(replayConflict);
        },
        getCustomer: () => {
          dotyposCalls.push("read");
          return Effect.succeed(Option.none<DotyposCustomer>());
        },
      });

      expect(dotyposCalls).toEqual(["expire"]);
      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).not.toContain("dotypos.customer-expiration.missing");
      expect(logCodes).toContain("account.deletion.retryable");
    });

    test("expires again once after a genuine version conflict and completes deletion", async () => {
      const dotyposCalls: string[] = [];
      const { result, calls } = await deleteWithDotypos({
        expireCustomer: () => {
          dotyposCalls.push("expire");
          return dotyposCalls.length === 1
            ? Effect.fail(
                new DotyposVersionConflict({
                  operation: "expireCustomer",
                  request: "customer.patch",
                  httpStatus: 412,
                })
              )
            : Effect.succeed(Option.some(expiredCustomer));
        },
      });

      expect(dotyposCalls).toEqual(["expire", "expire"]);
      expect(result._tag).toBe("Success");
      expect(calls).toContain("tombstone");
    });

    test("keeps deletion retryable when the expiration fails with a 503", async () => {
      const { result, calls, logCodes } = await deleteWithDotypos({
        expireCustomer: () =>
          Effect.fail(
            new DotyposUnavailable({
              operation: "expireCustomer",
              request: "customer.patch",
              reason: "server",
              httpStatus: 503,
            })
          ),
      });

      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).toContain("account.deletion.retryable");
    });
  });

  describe("the retryable deletion warning", () => {
    const retryableWarning = Schema.Struct({
      code: Schema.Literal("account.deletion.retryable"),
    });
    // Decoding fails on any annotation value that isn't a string.
    const fixedFields = Schema.Record(Schema.String, Schema.String);

    const retryableWarningsOf = async (
      program: Effect.Effect<void, { readonly _tag: string }>
    ) => {
      const logged: unknown[] = [];
      const capturingLogger = Logger.make(({ message }) => {
        const [, annotations] = Array.isArray(message) ? message : [];
        logged.push(annotations);
      });
      const result = await Effect.runPromise(
        program.pipe(
          Effect.result,
          Effect.provide(Logger.layer([capturingLogger]))
        )
      );
      return { result, warnings: logged.filter(Schema.is(retryableWarning)) };
    };

    const expectFixedFields = (
      warnings: readonly unknown[],
      keys: readonly string[],
      rawTexts: readonly string[]
    ) => {
      expect(warnings).toHaveLength(1);
      const fields = Schema.decodeUnknownSync(fixedFields)(warnings[0]);
      expect(Object.keys(fields).sort()).toEqual([...keys].sort());
      for (const value of Object.values(fields)) {
        for (const rawText of rawTexts) {
          expect(rawText.length).toBeGreaterThan(0);
          expect(value).not.toContain(rawText);
        }
      }
    };

    test("logs only fixed fields when a Dotypos failure keeps deletion retryable", async () => {
      const providerOutage = new DotyposUnavailable({
        operation: "expireCustomer",
        request: "customer.patch",
        reason: "server",
        httpStatus: 503,
        message: "synthetic provider detail 4c1e",
        cause: new Error("synthetic provider cause 4c1e"),
      });
      const { result, warnings } = await retryableWarningsOf(
        Effect.gen(function* () {
          const adapter = yield* CustomerDotyposAdapter;
          const { dependencies } = makeDependencies({
            expireCustomer: adapter.expireCustomer,
          });
          yield* expireLinkedDotyposProfile(dependencies)(accountId);
        }).pipe(
          Effect.provide(
            CustomerDotyposAdapter.Default.pipe(
              Layer.provide(
                Layer.mock(DotyposService, {
                  expireCustomer: () => Effect.fail(providerOutage),
                })
              )
            )
          )
        )
      );

      expect(result._tag).toBe("Failure");
      expectFixedFields(
        warnings,
        ["code", "failure"],
        ["synthetic provider detail 4c1e", "synthetic provider cause 4c1e"]
      );
    });

    test("logs only fixed fields when a database failure keeps deletion retryable", async () => {
      const databaseOutage = new SqlError.SqlError({
        reason: new SqlError.UnknownError({
          cause: new Error("synthetic database cause 9b2d"),
          message: "synthetic database detail 9b2d",
          operation: "query",
        }),
      });
      const { dependencies } = makeDependencies({
        markDeletionRequested: () => Effect.fail(databaseOutage),
      });
      const { result, warnings } = await retryableWarningsOf(
        expireLinkedDotyposProfile(dependencies)(accountId)
      );

      expect(result._tag).toBe("Failure");
      expectFixedFields(
        warnings,
        ["code", "failure"],
        [
          databaseOutage.message,
          "synthetic database detail 9b2d",
          "synthetic database cause 9b2d",
        ]
      );
    });

    test("logs the access reason and failure code when the account lock is unavailable", async () => {
      const { dependencies } = makeDependencies({
        account: { lockUnavailable: true },
      });
      const { result, warnings } = await retryableWarningsOf(
        expireLinkedDotyposProfile(dependencies)(accountId)
      );

      expect(result._tag).toBe("Failure");
      expectFixedFields(
        warnings,
        ["code", "failure", "failureCode", "reason"],
        ["advisory lock unavailable"]
      );
    });
  });
});
