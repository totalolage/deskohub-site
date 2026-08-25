import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import { Pool } from "pg";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { deleteCustomerIdentity } from "./customer-account-deletion";
import {
  type CustomerAccountLinkClaim,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import { resolveCustomerAccount } from "./customer-account-resolver.service";
import type { CustomerAuthUser } from "./customer-authentication.service";

const databaseTestsEnabled =
  process.env.WORKSPACE_ACCOUNT_DATABASE_TESTS === "true";
const databasePool = databaseTestsEnabled
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

const accountId = (value: string) =>
  Schema.decodeUnknownSync(customerAccountIdSchema)(value);
const customerId = (value: string) =>
  Schema.decodeUnknownSync(DotyposCustomerIdSchema)(value);

const accountA = accountId("database-test-account-a");
const accountB = accountId("database-test-account-b");
const customerA = customerId("database-test-customer-a");
const customerB = customerId("database-test-customer-b");

const withRepository = <A, E>(
  effect: Effect.Effect<A, E, CustomerAccountLinkRepository>
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(CustomerAccountLinkRepository.Live))
  );

const resolvedCustomerId = (
  claim: CustomerAccountLinkClaim
): DotyposCustomerId | null =>
  claim.kind === "linked" ? claim.customerId : null;

describe.skipIf(!databaseTestsEnabled)(
  "customer account link database concurrency",
  () => {
    beforeEach(async () => {
      await databasePool?.query("delete from customer_account_links");
    });

    afterAll(async () => {
      await databasePool?.end();
    });

    test("serializes one account so concurrent resolutions converge", async () => {
      let active = 0;
      let maxActive = 0;

      const results = await withRepository(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const resolve = (requestedCustomerId: DotyposCustomerId) =>
            links.withAccountLock(
              accountA,
              Effect.gen(function* () {
                active += 1;
                maxActive = Math.max(maxActive, active);
                const existing = yield* links.find(accountA);
                yield* Effect.sleep("20 millis");
                if (existing) return existing;
                return resolvedCustomerId(
                  yield* links.claim(accountA, requestedCustomerId)
                );
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    active -= 1;
                  })
                )
              )
            );

          return yield* Effect.all([resolve(customerA), resolve(customerB)], {
            concurrency: "unbounded",
          });
        })
      );

      expect(maxActive).toBe(1);
      expect(new Set(results).size).toBe(1);
      expect(results[0]).not.toBeNull();
    });

    test("allows only one account to claim a customer", async () => {
      const { claims, links } = await withRepository(
        Effect.gen(function* () {
          const repository = yield* CustomerAccountLinkRepository;
          const claims = yield* Effect.all(
            [
              repository.claim(accountA, customerA),
              repository.claim(accountB, customerA),
            ],
            { concurrency: "unbounded" }
          );
          const links = yield* Effect.all([
            repository.find(accountA),
            repository.find(accountB),
          ]);
          return { claims, links };
        })
      );

      expect(claims.map(({ kind }) => kind).sort()).toEqual([
        "claimed",
        "linked",
      ]);
      expect(links.filter((link) => link === customerA)).toHaveLength(1);
      const rowCount = await databasePool?.query<{ readonly count: string }>(
        "select count(*) as count from customer_account_links"
      );
      expect(rowCount?.rows[0]?.count).toBe("1");
    });

    test("does not relink an identity while its deletion holds the account lock", async () => {
      const deletionAtProvider = Promise.withResolvers<void>();
      const finishDeletion = Promise.withResolvers<void>();
      const initialResolutionSession = Promise.withResolvers<void>();
      let identityExists = true;
      let sessionReads = 0;
      let lookups = 0;
      let claims = 0;

      await withRepository(
        Effect.flatMap(CustomerAccountLinkRepository, (links) =>
          links.claim(accountA, customerA)
        )
      );

      const deletion = withRepository(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          yield* deleteCustomerIdentity(
            accountA,
            links.withAccountLock,
            Effect.sync(() => (identityExists ? accountA : null)),
            links.unlink,
            Effect.promise(async () => {
              deletionAtProvider.resolve();
              await finishDeletion.promise;
              identityExists = false;
            })
          );
        })
      );
      await deletionAtProvider.promise;

      const user: CustomerAuthUser = {
        email: "database-test@example.test",
        emailVerified: true,
        id: accountA,
        name: "Database Test",
      };
      const resolution = withRepository(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* Effect.flip(
            resolveCustomerAccount({
              currentUser: () =>
                Effect.sync(() => {
                  sessionReads += 1;
                  if (sessionReads === 1) initialResolutionSession.resolve();
                  return identityExists ? user : null;
                }),
              findLink: links.find,
              findCustomer: () =>
                Effect.sync(() => {
                  lookups += 1;
                  return { kind: "matched" as const, customerId: customerB };
                }),
              claimLink: (account, customer) =>
                Effect.sync(() => {
                  claims += 1;
                  return links.claim(account, customer);
                }).pipe(Effect.flatten),
              withAccountLock: links.withAccountLock,
            })
          );
        })
      );
      await initialResolutionSession.promise;
      finishDeletion.resolve();

      const [error] = await Promise.all([resolution, deletion]);
      expect(error).toBeInstanceOf(CustomerAccountAccessError);
      expect(error.reason).toBe("unauthenticated");
      expect(sessionReads).toBe(2);
      expect(lookups).toBe(0);
      expect(claims).toBe(0);
      expect(
        await withRepository(
          Effect.flatMap(CustomerAccountLinkRepository, (links) =>
            links.find(accountA)
          )
        )
      ).toBeNull();
    });
  }
);
