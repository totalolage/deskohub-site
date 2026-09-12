import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Result } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  MarketingManagementError,
  MarketingManagementService,
} from "./marketing-management.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type StoredTokenRow = {
  readonly token_hash: string;
  readonly dotypos_customer_id: string;
  readonly purpose: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
};

const makeCustomerId = (): DotyposCustomerId =>
  DotyposCustomerIdSchema.make(`marketing-management-${crypto.randomUUID()}`);

const makeToken = (): string => randomBytes(32).toString("base64url");

const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const makeServiceLayer = () =>
  MarketingManagementService.Default.pipe(Layer.provide(testDatabase!.layer));

const runService = <A>(
  body: (
    service: MarketingManagementService["Service"]
  ) => Effect.Effect<A, MarketingManagementError>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* MarketingManagementService;
      return yield* body(service);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

const runServiceResult = <A>(
  body: (
    service: MarketingManagementService["Service"]
  ) => Effect.Effect<A, MarketingManagementError>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* MarketingManagementService;
      return yield* body(service).pipe(Effect.result);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

const readRows = async (customerId: DotyposCustomerId) => {
  const result = await testDatabase!.pool.query<StoredTokenRow>(
    `select token_hash, dotypos_customer_id, purpose, expires_at, revoked_at
       from customer_marketing_management_tokens
      where dotypos_customer_id = $1
      order by token_hash`,
    [customerId]
  );
  return result.rows;
};

const insertToken = async (input: {
  readonly token: string;
  readonly customerId: DotyposCustomerId;
  readonly purpose: "link" | "session";
  readonly expiresAt: Temporal.Instant;
}) => {
  await testDatabase!.pool.query(
    `insert into customer_marketing_management_tokens
       (token_hash, dotypos_customer_id, purpose, expires_at)
     values ($1, $2, $3, $4)`,
    [
      hashToken(input.token),
      input.customerId,
      input.purpose,
      new Date(input.expiresAt.epochMilliseconds),
    ]
  );
};

const cleanupCustomer = async (customerId: DotyposCustomerId) => {
  await testDatabase!.pool.query(
    `delete from customer_marketing_management_tokens where dotypos_customer_id = $1`,
    [customerId]
  );
};

const withCustomer = async <A>(
  body: (customerId: DotyposCustomerId) => Promise<A>
) => {
  const customerId = makeCustomerId();
  try {
    return await body(customerId);
  } finally {
    await cleanupCustomer(customerId);
  }
};

const withCurrentTime = async <A>(
  now: Temporal.Instant,
  body: () => Promise<A>
) => {
  const previousNow = Temporal.Now.instant;
  Temporal.Now.instant = () => now;
  try {
    return await body();
  } finally {
    Temporal.Now.instant = previousNow;
  }
};

const expectInvalidCredential = <A>(
  result: Result.Result<A, MarketingManagementError>
) => {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(MarketingManagementError);
    expect(result.failure._tag).toBe("MarketingManagementError");
    expect(result.failure.reason).toBe("invalid_credential");
    expect("cause" in result.failure).toBe(false);
  }
};

describe.skipIf(!testDatabase)(
  "MarketingManagementService over disposable Postgres",
  () => {
    test("rejects malformed, noncanonical, and wrong-length credentials", async () => {
      await withCustomer(async (customerId) => {
        const canonical = Buffer.alloc(32, 7).toString("base64url");
        const noncanonical = `${canonical.slice(0, -1)}B`;
        const malformed = `${canonical.slice(0, -1)}.`;
        const inputs = [
          "",
          canonical.slice(0, -1),
          `${canonical}A`,
          noncanonical,
          malformed,
        ];

        for (const input of inputs) {
          expectInvalidCredential(
            await runServiceResult((service) => service.exchange(input))
          );
          expectInvalidCredential(
            await runServiceResult((service) => service.resolve(input))
          );
          expectInvalidCredential(
            await runServiceResult((service) => service.revoke(input))
          );
        }

        expect(await readRows(customerId)).toHaveLength(0);
      });
    });

    test("issues unique link credentials and stores only lower-hex hashes", async () => {
      await withCustomer(async (customerId) => {
        const now = Temporal.Instant.from("2026-09-11T10:00:00Z");
        const issued = await withCurrentTime(now, () =>
          runService((service) =>
            Effect.all([service.issue(customerId), service.issue(customerId)], {
              concurrency: 2,
            })
          )
        );

        expect(issued[0]).not.toBe(issued[1]);
        for (const token of issued) {
          expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        }

        const rows = await readRows(customerId);
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.purpose)).toEqual(["link", "link"]);
        expect(rows.map((row) => row.dotypos_customer_id)).toEqual([
          customerId,
          customerId,
        ]);
        expect(
          rows.map((row) => new Date(row.expires_at).toISOString())
        ).toEqual(["2026-10-11T10:00:00.000Z", "2026-10-11T10:00:00.000Z"]);

        for (const row of rows) {
          expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
          expect(issued).not.toContain(row.token_hash);
          expect(issued.map(hashToken)).toContain(row.token_hash);
          expect(row.revoked_at).toBeNull();
        }
      });
    });

    test("exchanges once, preserves the customer, and rejects replay", async () => {
      await withCustomer(async (customerId) => {
        const now = Temporal.Instant.from("2026-09-11T10:00:00Z");
        const linkToken = await withCurrentTime(now, () =>
          runService((service) => service.issue(customerId))
        );
        const exchanged = await withCurrentTime(now, () =>
          runService((service) => service.exchange(linkToken))
        );

        expect(exchanged.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(exchanged.token).not.toBe(linkToken);
        expect(exchanged.expiresAt.toISOString()).toBe(
          "2026-09-12T10:00:00.000Z"
        );

        expect(
          await withCurrentTime(now, () =>
            runService((service) => service.resolve(exchanged.token))
          )
        ).toBe(customerId);

        expectInvalidCredential(
          await withCurrentTime(now, () =>
            runServiceResult((service) => service.exchange(linkToken))
          )
        );
        expectInvalidCredential(
          await withCurrentTime(now, () =>
            runServiceResult((service) => service.resolve(linkToken))
          )
        );

        const rows = await readRows(customerId);
        expect(rows).toHaveLength(2);
        const link = rows.find(
          (row) => row.token_hash === hashToken(linkToken)
        );
        const session = rows.find(
          (row) => row.token_hash === hashToken(exchanged.token)
        );
        expect(link?.purpose).toBe("link");
        expect(link?.revoked_at).not.toBeNull();
        expect(session).toMatchObject({
          token_hash: hashToken(exchanged.token),
          dotypos_customer_id: customerId,
          purpose: "session",
          revoked_at: null,
        });
        expect(session && new Date(session.expires_at).toISOString()).toBe(
          "2026-09-12T10:00:00.000Z"
        );
      });
    });

    test("allows at most one concurrent exchange success", async () => {
      await withCustomer(async (customerId) => {
        const now = Temporal.Instant.from("2026-09-11T10:00:00Z");
        const linkToken = await withCurrentTime(now, () =>
          runService((service) => service.issue(customerId))
        );

        const outcomes = await withCurrentTime(now, () =>
          runService((service) =>
            Effect.all(
              [service.exchange(linkToken), service.exchange(linkToken)].map(
                (exchange) => exchange.pipe(Effect.result)
              ),
              { concurrency: 2 }
            )
          )
        );

        expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
        expect(outcomes.filter(Result.isFailure)).toHaveLength(1);
        const failed = outcomes.find(Result.isFailure);
        if (failed && Result.isFailure(failed)) {
          expect(failed.failure.reason).toBe("invalid_credential");
        }
        expect(await readRows(customerId)).toHaveLength(2);
      });
    });

    test("caps sessions at 24 hours and never extends a short-lived link", async () => {
      await withCustomer(async (customerId) => {
        const now = Temporal.Instant.from("2026-09-11T10:00:00Z");
        const regularLink = await withCurrentTime(now, () =>
          runService((service) => service.issue(customerId))
        );
        const regularSession = await withCurrentTime(now, () =>
          runService((service) => service.exchange(regularLink))
        );
        expect(regularSession.expiresAt.toISOString()).toBe(
          "2026-09-12T10:00:00.000Z"
        );

        const shortLink = makeToken();
        const shortExpiry = now.add({ hours: 6 });
        await insertToken({
          token: shortLink,
          customerId,
          purpose: "link",
          expiresAt: shortExpiry,
        });
        const shortSession = await withCurrentTime(now, () =>
          runService((service) => service.exchange(shortLink))
        );
        expect(shortSession.expiresAt.toISOString()).toBe(
          "2026-09-11T16:00:00.000Z"
        );

        const rows = await readRows(customerId);
        const shortSessionRow = rows.find(
          (row) => row.token_hash === hashToken(shortSession.token)
        );
        expect(
          shortSessionRow && new Date(shortSessionRow.expires_at).toISOString()
        ).toBe("2026-09-11T16:00:00.000Z");
      });
    });

    test("rejects link credentials for revoke and revokes sessions idempotently", async () => {
      await withCustomer(async (customerId) => {
        const now = Temporal.Instant.from("2026-09-11T10:00:00Z");
        const linkToken = await withCurrentTime(now, () =>
          runService((service) => service.issue(customerId))
        );

        expectInvalidCredential(
          await withCurrentTime(now, () =>
            runServiceResult((service) => service.revoke(linkToken))
          )
        );
        expect((await readRows(customerId))[0]?.revoked_at).toBeNull();

        const session = await withCurrentTime(now, () =>
          runService((service) => service.exchange(linkToken))
        );
        await withCurrentTime(now, () =>
          runService((service) => service.revoke(session.token))
        );
        expectInvalidCredential(
          await withCurrentTime(now, () =>
            runServiceResult((service) => service.resolve(session.token))
          )
        );

        await withCurrentTime(now, () =>
          runService((service) => service.revoke(session.token))
        );
        await withCurrentTime(now, () =>
          runService((service) => service.revoke(makeToken()))
        );

        const rows = await readRows(customerId);
        expect(
          rows.find((row) => row.token_hash === hashToken(session.token))
            ?.revoked_at
        ).not.toBeNull();
      });
    });

    test("rolls back link consumption when session insertion fails", async () => {
      await withCustomer(async (customerId) => {
        const now = Temporal.Instant.from("2026-09-11T10:00:00Z");
        const linkToken = await withCurrentTime(now, () =>
          runService((service) => service.issue(customerId))
        );
        const triggerSuffix = crypto.randomUUID().replaceAll("-", "");
        const functionName = `marketing_mgmt_fail_${triggerSuffix}`;
        const triggerName = `${functionName}_trigger`;

        let createdFunction = false;
        let createdTrigger = false;
        try {
          await testDatabase!.pool.query(
            `create function ${functionName}() returns trigger
             language plpgsql as $$
             begin
               raise exception 'marketing management test insert failure';
             end;
             $$`
          );
          createdFunction = true;
          await testDatabase!.pool.query(
            `create trigger ${triggerName}
             before insert on customer_marketing_management_tokens
             for each row execute function ${functionName}()`
          );
          createdTrigger = true;

          const result = await withCurrentTime(now, () =>
            runServiceResult((service) => service.exchange(linkToken))
          );
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.reason).toBe("unavailable");
            expect("cause" in result.failure).toBe(false);
            expect(JSON.stringify(result.failure)).not.toContain(linkToken);
          }

          const rows = await readRows(customerId);
          expect(rows).toHaveLength(1);
          expect(rows[0]?.token_hash).toBe(hashToken(linkToken));
          expect(rows[0]?.revoked_at).toBeNull();
        } finally {
          if (createdTrigger) {
            await testDatabase!.pool.query(
              `drop trigger ${triggerName} on customer_marketing_management_tokens`
            );
          }
          if (createdFunction) {
            await testDatabase!.pool.query(`drop function ${functionName}()`);
          }
        }
      });
    });
  }
);
