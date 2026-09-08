import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { workspaceReservations } from "@/db/schema";
import {
  CustomerAccountReservationOwnership,
  CustomerAccountResolver,
  type LinkedCustomerAccount,
} from "@/features/account";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  type CheckoutStatusViewModel,
  type ICheckoutStatusService,
  loadCheckoutStatusPage,
} from "@/features/checkout/backend/checkout";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type ReservationAuthorizationInput,
  ReservationAuthorizationService,
} from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type Fixture = {
  readonly accountId: string;
  readonly accountEmail: string;
  readonly customerId: DotyposCustomerId;
  readonly reservationId: WorkspaceReservationId;
  readonly dotyposReservationId: string;
};

const makeFixture = (): Fixture => {
  const id = crypto.randomUUID();
  return {
    accountId: customerAccountIdSchema.make(id),
    accountEmail: `reservation-authorization-${id}@deskohub.test`,
    customerId: DotyposCustomerIdSchema.make(`customer-${id}`),
    reservationId: workspaceReservationIdSchema.make(`reservation-${id}`),
    dotyposReservationId: `dotypos-reservation-${id}`,
  };
};

const insertAuthUser = async (
  postgres: WorkspacePostgresTestDatabase,
  fixture: Fixture
) => {
  await postgres.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [fixture.accountId, fixture.accountEmail]
  );
};

const insertReservation = async (
  postgres: WorkspacePostgresTestDatabase,
  fixture: Fixture,
  customerId: DotyposCustomerId = fixture.customerId
) => {
  await Effect.runPromise(
    postgres.db.insert(workspaceReservations).values({
      id: fixture.reservationId,
      checkoutAttemptKey: checkoutAttemptKeySchema.make(
        `attempt-${crypto.randomUUID()}`
      ),
      dotyposCustomerId: customerId,
      dotyposReservationId: DotyposReservationIdSchema.make(
        fixture.dotyposReservationId
      ),
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

const cleanupFixture = async (
  postgres: WorkspacePostgresTestDatabase,
  fixture: Fixture
) => {
  await postgres.pool.query(
    `delete from workspace_reservations where id = $1`,
    [fixture.reservationId]
  );
  await postgres.pool.query(`delete from auth."user" where id = $1`, [
    fixture.accountId,
  ]);

  const remaining = await postgres.pool.query(
    `select
       (select count(*) from workspace_reservations where id = $1) as reservations,
       (select count(*) from auth."user" where id = $2) as users`,
    [fixture.reservationId, fixture.accountId]
  );
  const row = remaining.rows[0] as
    | { readonly reservations: string; readonly users: string }
    | undefined;
  if (!row) {
    throw new Error(
      "Reservation authorization fixture cleanup did not converge."
    );
  }
  if (row.reservations !== "0" || row.users !== "0") {
    throw new Error(
      "Reservation authorization fixture cleanup did not converge."
    );
  }
};

const makeAuthorization = (
  postgres: WorkspacePostgresTestDatabase,
  account: LinkedCustomerAccount
) => {
  const databaseLayer = Layer.mergeAll(
    postgres.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(postgres.pool)
  );
  const linksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(databaseLayer)
  );
  const ownershipLayer = CustomerAccountReservationOwnership.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerAccountResolver, {
          resolve: Effect.succeed(account),
        }),
        linksLayer
      )
    )
  );
  const reservationsLayer = WorkspaceReservationRepository.Default.pipe(
    Layer.provide(postgres.layer)
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ReservationAuthorizationService;
    }).pipe(
      Effect.provide(
        ReservationAuthorizationService.Default.pipe(
          Layer.provide(Layer.mergeAll(ownershipLayer, reservationsLayer))
        )
      )
    )
  );
};

const runStatusLoad = async (options: {
  readonly postgres: WorkspacePostgresTestDatabase;
  readonly fixture: Fixture;
  readonly reservationCustomerId?: DotyposCustomerId;
  readonly deletionRequestedAt?: Date;
  readonly removeAuthUser?: boolean;
  readonly expectedAuthorized: boolean;
}) => {
  const {
    fixture,
    postgres,
    reservationCustomerId,
    deletionRequestedAt,
    removeAuthUser,
    expectedAuthorized,
  } = options;
  const account: LinkedCustomerAccount = {
    accountId: customerAccountIdSchema.make(fixture.accountId),
    dotyposCustomerId: fixture.customerId,
  };
  const authorizationInput: ReservationAuthorizationInput = {
    locale: "en-US",
    orderId: fixture.reservationId,
  };
  const fulfilledStatus: CheckoutStatusViewModel = {
    orderId: fixture.reservationId,
    returnOutcome: "success",
    status: "fulfilled",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    kind: "cowork",
  };
  const refreshStatus = mock(() => Effect.succeed(fulfilledStatus));
  const getStatus = mock(() => Effect.succeed(fulfilledStatus));
  const statusService: ICheckoutStatusService = {
    getStatus,
    refreshStatus,
  };

  await insertAuthUser(postgres, fixture);
  if (reservationCustomerId !== undefined) {
    await insertReservation(postgres, fixture, reservationCustomerId);
  }
  if (deletionRequestedAt) {
    await postgres.pool.query(
      `update auth."user" set deletion_requested_at = $1 where id = $2`,
      [deletionRequestedAt, fixture.accountId]
    );
  }
  if (removeAuthUser) {
    await postgres.pool.query(`delete from auth."user" where id = $1`, [
      fixture.accountId,
    ]);
  }

  const authorization = await makeAuthorization(postgres, account);
  const result = await Effect.runPromise(
    loadCheckoutStatusPage(statusService, authorization, {
      ...authorizationInput,
      returnOutcome: "success",
    })
  );

  if (expectedAuthorized) {
    expect(result).toBe(fulfilledStatus);
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    expect(getStatus).not.toHaveBeenCalled();
  } else {
    expect(result).toEqual({
      orderId: fixture.reservationId,
      returnOutcome: "success",
      status: "not_found",
    });
    expect(refreshStatus).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  }
};

describe.skipIf(!testDatabase)(
  "reservation authorization and checkout status ordering on disposable Postgres",
  () => {
    const postgres = testDatabase as WorkspacePostgresTestDatabase;

    afterAll(async () => {
      await postgres.close();
    });

    test("allows an active owner with a matching reservation through status refresh", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: fixture.customerId,
          expectedAuthorized: true,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test("denies a different customer's reservation before status reads", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: DotyposCustomerIdSchema.make(
            `foreign-customer-${crypto.randomUUID()}`
          ),
          expectedAuthorized: false,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test("denies an absent reservation before status reads", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          expectedAuthorized: false,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test("denies an owner whose auth activity has a deletion marker", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: fixture.customerId,
          deletionRequestedAt: new Date("2026-09-07T10:00:00.000Z"),
          expectedAuthorized: false,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test("denies a stale resolver identity after its auth user is removed", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: fixture.customerId,
          removeAuthUser: true,
          expectedAuthorized: false,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });
  }
);
