import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  CustomerAccountReservationOwnership,
  CustomerAccountResolver,
} from "@/features/account";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerDotyposAdapter } from "@/features/account/backend/customer-dotypos-adapter.service";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import {
  type CheckoutStatusViewModel,
  type ICheckoutStatusService,
  loadCheckoutStatusPage,
} from "@/features/checkout/backend/checkout";
import {
  type ReservationAuthorizationInput,
  ReservationAuthorizationService,
} from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type Fixture = {
  readonly accountId: CustomerAccountId;
  readonly accountEmail: ReturnType<typeof testEmailAddress>;
  readonly customerId: DotyposCustomerId;
  readonly reservationId: WorkspaceReservationId;
};

const makeFixture = (): Fixture => {
  const id = crypto.randomUUID();
  return {
    accountId: customerAccountIdSchema.make(id),
    accountEmail: testEmailAddress(`reservation-authorization-${id}`),
    customerId: DotyposCustomerIdSchema.make(`customer-${id}`),
    reservationId: workspaceReservationIdSchema.make(`reservation-${id}`),
  };
};

/** Inserts the fixture's login, linked to its customer unless `unlinked`. */
const insertAccount = async (
  postgres: WorkspacePostgresTestDatabase,
  fixture: Fixture,
  { unlinked = false }: { readonly unlinked?: boolean } = {}
) => {
  await Effect.runPromise(
    workspaceFixtures(postgres.db).account("reservation-authorization", {
      id: fixture.accountId,
      email: fixture.accountEmail,
      linkedCustomer: unlinked ? undefined : fixture.customerId,
    })
  );
};

const insertReservation = async (
  postgres: WorkspacePostgresTestDatabase,
  fixture: Fixture,
  customerId: DotyposCustomerId = fixture.customerId,
  options: { readonly authoredByAccount?: boolean } = {}
) => {
  await Effect.runPromise(
    workspaceFixtures(postgres.db).reservation({
      stage: { reservation: "confirmed" },
      customer: customerId,
      author: options.authoredByAccount ? fixture.accountId : undefined,
      overrides: { id: fixture.reservationId },
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
  await postgres.pool.query(`delete from customer_accounts where id = $1`, [
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

/**
 * Wires the real account resolver over the fixture's signed-in session. An
 * account without a Dotypos customer id resolves through an exact-email lookup
 * that finds no customer, as for an author who never linked one.
 */
const makeAuthorization = (
  postgres: WorkspacePostgresTestDatabase,
  fixture: Fixture
) => {
  const databaseLayer = Layer.mergeAll(
    postgres.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(postgres.pool)
  );
  const linksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(databaseLayer)
  );
  const authenticationLayer = Layer.succeed(CustomerAuthentication, {
    currentUser: Effect.succeed({
      accountId: fixture.accountId,
      email: fixture.accountEmail,
      deletionRequested: false,
    }),
  });
  const resolverLayer = CustomerAccountResolver.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        authenticationLayer,
        linksLayer,
        Layer.mock(CustomerDotyposAdapter, {
          classifyExactEmailCustomers: () =>
            Effect.succeed({ kind: "not-found" }),
        }),
        ReviewAccounts.Default.pipe(Layer.provide(postgres.layer))
      )
    )
  );
  const ownershipLayer = CustomerAccountReservationOwnership.Default.pipe(
    Layer.provide(
      Layer.mergeAll(authenticationLayer, resolverLayer, linksLayer)
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
          Layer.provide(
            Layer.mergeAll(
              ownershipLayer,
              reservationsLayer,
              ReviewSandbox.Default.pipe(Layer.provide(postgres.layer))
            )
          )
        )
      )
    )
  );
};

const runStatusLoad = async (options: {
  readonly postgres: WorkspacePostgresTestDatabase;
  readonly fixture: Fixture;
  readonly reservationCustomerId?: DotyposCustomerId;
  readonly authoredByAccount?: boolean;
  readonly deletionRequestedAt?: Date;
  readonly removeAuthUser?: boolean;
  readonly unlinked?: boolean;
  readonly expectedAuthorized: boolean;
}) => {
  const {
    fixture,
    postgres,
    reservationCustomerId,
    authoredByAccount,
    deletionRequestedAt,
    removeAuthUser,
    unlinked,
    expectedAuthorized,
  } = options;
  const authorizationInput: Omit<ReservationAuthorizationInput, "permission"> =
    {
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

  await insertAccount(postgres, fixture, { unlinked });
  if (reservationCustomerId !== undefined) {
    await insertReservation(postgres, fixture, reservationCustomerId, {
      authoredByAccount,
    });
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

  const authorization = await makeAuthorization(postgres, fixture);
  const result = await Effect.runPromise(
    loadCheckoutStatusPage(statusService, authorization, {
      ...authorizationInput,
      requestHeaders: new Headers(),
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

    test("allows the author's session to another customer's reservation", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: DotyposCustomerIdSchema.make(
            `booked-for-customer-${crypto.randomUUID()}`
          ),
          authoredByAccount: true,
          expectedAuthorized: true,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test("allows an unlinked author's session to the reservation it booked", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: DotyposCustomerIdSchema.make(
            `booked-for-customer-${crypto.randomUUID()}`
          ),
          authoredByAccount: true,
          unlinked: true,
          expectedAuthorized: true,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test("denies an unlinked account's session to a reservation it did not author", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: fixture.customerId,
          unlinked: true,
          expectedAuthorized: false,
        });
      } finally {
        await cleanupFixture(postgres, fixture);
      }
    });

    test.each([
      ["the author booking for another customer", false, false],
      ["the customer's linked account", true, true],
    ] as const)(
      "decides the access code for %s by customer ownership",
      async (_label, ownsCustomer, expected) => {
        const fixture = makeFixture();
        try {
          await insertAccount(postgres, fixture);
          await insertReservation(
            postgres,
            fixture,
            ownsCustomer
              ? fixture.customerId
              : DotyposCustomerIdSchema.make(
                  `booked-for-customer-${crypto.randomUUID()}`
                ),
            { authoredByAccount: !ownsCustomer }
          );
          const authorization = await makeAuthorization(postgres, fixture);
          const input = {
            locale: "en-US",
            orderId: fixture.reservationId,
          } as const;

          await expect(
            Effect.runPromise(
              authorization.isAuthorized({
                ...input,
                permission: "view-access-code",
              })
            )
          ).resolves.toBe(expected);
          await expect(
            Effect.runPromise(
              authorization.isAuthorized({
                ...input,
                permission: "view-status",
              })
            )
          ).resolves.toBe(true);
        } finally {
          await cleanupFixture(postgres, fixture);
        }
      }
    );

    test("denies an author whose auth activity has a deletion marker", async () => {
      const fixture = makeFixture();
      try {
        await runStatusLoad({
          fixture,
          postgres,
          reservationCustomerId: DotyposCustomerIdSchema.make(
            `booked-for-customer-${crypto.randomUUID()}`
          ),
          authoredByAccount: true,
          deletionRequestedAt: new Date("2026-09-07T10:00:00.000Z"),
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
