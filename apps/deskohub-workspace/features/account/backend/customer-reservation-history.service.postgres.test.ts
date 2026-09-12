import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;

const makeDotyposReservation = (
  overrides: Partial<DotyposReservation> = {}
): DotyposReservation =>
  Schema.decodeUnknownSync(DotyposReservationSchema)({
    _branchId: "branch",
    _cloudId: "cloud",
    startDate: "2000-01-01T10:00:00.000Z",
    endDate: "2000-01-01T11:00:00.000Z",
    seats: "2",
    status: "CONFIRMED",
    ...overrides,
  });

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const insertWorkspaceReservation = async (input: {
  readonly id: WorkspaceReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
}) => {
  await Effect.runPromise(
    testDatabase!.db.insert(workspaceReservations).values({
      id: input.id,
      checkoutAttemptKey: checkoutAttemptKeySchema.make(
        `attempt-${uniqueId()}`
      ),
      dotyposCustomerId: input.dotyposCustomerId,
      dotyposReservationId: input.dotyposReservationId,
      reservationState: "confirmed",
      paymentState: "not_started",
      fulfillmentState: "not_started",
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      locale: "en-US",
    })
  );
};

const makeHistoryLayer = (reservations: readonly DotyposReservation[]) =>
  CustomerReservationHistoryService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.of({ db: testDatabase!.db })
        ),
        Layer.mock(DotyposService, {
          listReservations: () => Effect.succeed([...reservations]),
        } as Partial<DotyposService["Service"]>),
        CustomerAccountLinkRepository.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: testDatabase!.db })
              ),
              WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
            )
          )
        )
      )
    )
  );

describe.skipIf(!testDatabase)(
  "CustomerReservationHistoryService on disposable Postgres",
  () => {
    test("blocks reservation activity for a deletion marker or a removed account, never for anonymous flows", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, `h-${account}@deskohub.test`);
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [account, dotyposCustomerId]
      );

      const layer = makeHistoryLayer([]);

      const runLoad = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const history = yield* CustomerReservationHistoryService;
            return yield* history.load({
              accountId: account,
              dotyposCustomerId,
            });
          }).pipe(Effect.provide(layer), Effect.result)
        );

      const active = await runLoad();
      expect(active._tag).toBe("Success");

      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [account]
      );
      const marked = await runLoad();
      expect(marked._tag).toBe("Failure");
      if (marked._tag === "Failure") {
        const error = marked.failure as {
          reason?: string;
          linkReason?: string;
        };
        expect(error.reason).toBe("link-required");
        expect(error.linkReason).toBe("deletion-requested");
      }

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);
      const removed = await runLoad();
      expect(removed._tag).toBe("Failure");
      if (removed._tag === "Failure") {
        const error = removed.failure as { reason?: string };
        expect(error.reason).toBe("unauthenticated");
      }
    });

    test("exposes a workspace ID only for an owner-matched local reservation", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      const foreignCustomerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      const matchedWorkspaceReservationId = workspaceReservationIdSchema.make(
        `workspace-${uniqueId()}`
      );
      const foreignWorkspaceReservationId = workspaceReservationIdSchema.make(
        `workspace-${uniqueId()}`
      );
      const matchedDotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${uniqueId()}`
      );
      const providerOnlyDotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${uniqueId()}`
      );
      const foreignDotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${uniqueId()}`
      );

      await insertAuthUser(account, `h-${account}@deskohub.test`);
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [account, dotyposCustomerId]
      );
      await insertWorkspaceReservation({
        id: matchedWorkspaceReservationId,
        dotyposCustomerId,
        dotyposReservationId: matchedDotyposReservationId,
      });
      await insertWorkspaceReservation({
        id: foreignWorkspaceReservationId,
        dotyposCustomerId: foreignCustomerId,
        dotyposReservationId: foreignDotyposReservationId,
      });

      const history = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerReservationHistoryService;
          return yield* service.load({ accountId: account, dotyposCustomerId });
        }).pipe(
          Effect.provide(
            makeHistoryLayer([
              makeDotyposReservation({
                id: matchedDotyposReservationId,
                startDate: "2000-01-01T10:00:00.000Z",
                endDate: "2000-01-01T11:00:00.000Z",
              }),
              makeDotyposReservation({
                id: providerOnlyDotyposReservationId,
                startDate: "2000-01-02T10:00:00.000Z",
                endDate: "2000-01-02T11:00:00.000Z",
              }),
              makeDotyposReservation({
                startDate: "2000-01-03T10:00:00.000Z",
                endDate: "2000-01-03T11:00:00.000Z",
              }),
              makeDotyposReservation({
                id: foreignDotyposReservationId,
                startDate: "2000-01-04T10:00:00.000Z",
                endDate: "2000-01-04T11:00:00.000Z",
              }),
            ])
          )
        )
      );

      expect(history.kind).toBe("available");
      if (history.kind !== "available") throw new Error("History unavailable");

      const summaries = history.groups.past;
      expect(summaries).toHaveLength(4);
      expect(summaries[0]).toMatchObject({
        id: matchedWorkspaceReservationId,
        workspaceReservationId: matchedWorkspaceReservationId,
      });
      expect(summaries[1].id).toBe(providerOnlyDotyposReservationId);
      expect("workspaceReservationId" in summaries[1]).toBe(false);
      expect(summaries[2].id).toBe("2000-01-03T10:00:00.000Z:2");
      expect("workspaceReservationId" in summaries[2]).toBe(false);
      expect(summaries[3].id).toBe(foreignDotyposReservationId);
      expect("workspaceReservationId" in summaries[3]).toBe(false);
    });
  }
);
