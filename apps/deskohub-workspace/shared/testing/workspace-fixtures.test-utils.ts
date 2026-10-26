import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  type FulfillmentState,
  type PaymentState,
  type ReservationState,
  workspaceReservations,
} from "@/db/schema";
import { accountRoleGrants } from "@/db/schema/account-role-grants";
import { authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { AccountRole } from "@/features/administrators/account-role";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";

/** A synthetic login: the customer account id and its login email. */
export type FixtureAccount = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
};

export type FixtureAccountOptions = {
  /** The account id; a fresh one by default. */
  readonly id?: CustomerAccountId;
  /** The login email; a synthetic address built from the label by default. */
  readonly email?: string;
  readonly name?: string;
  /** Whether the login email is verified; it is by default. */
  readonly verified?: boolean;
  /** Whether the login awaits deletion, requested now; it doesn't by default. */
  readonly deletionRequested?: boolean;
  /** Marks an app-directory review account, which never links a customer. */
  readonly review?: boolean;
  /** The Dotypos customer a completed profile links the account to. */
  readonly linkedCustomer?: DotyposCustomerId;
  /** Marks an existing customer's account, created before records began. */
  readonly legacy?: boolean;
  readonly roles?: readonly AccountRole[];
  readonly locale?: Locale;
  /** When the account was created; now by default. */
  readonly createdAt?: Temporal.Instant;
  /** When the login was created; when the account was by default. */
  readonly loginCreatedAt?: Temporal.Instant;
};

/** A customer account without a login, such as a reservation's author. */
export type FixtureCustomerAccountOptions = {
  /** The account id; a fresh one by default. */
  readonly id?: CustomerAccountId;
  /** The Dotypos customer the account is linked to. */
  readonly linkedCustomer?: DotyposCustomerId;
  readonly review?: boolean;
  readonly legacy?: boolean;
  /** When the account was created; now by default. */
  readonly createdAt?: Temporal.Instant;
  /** When the account was deleted, leaving a tombstone. */
  readonly deletedAt?: Temporal.Instant;
};

/**
 * The lifecycle stage a fixture reservation is in, one state of each schema
 * state machine. Payment and fulfillment have not started unless named.
 */
export type ReservationFixtureStage = {
  readonly reservation: ReservationState;
  readonly payment?: PaymentState;
  readonly fulfillment?: FulfillmentState;
};

type ReservationRow = typeof workspaceReservations.$inferInsert;
type StageColumns = Partial<ReservationRow>;

export type ReservationFixtureInput = {
  readonly stage: ReservationFixtureStage;
  /** The Dotypos customer; a fresh synthetic one by default. */
  readonly customer?: DotyposCustomerId;
  /** The stored reservation details; a basic cowork entry without coffee by default. */
  readonly details?: StoredWorkspaceReservationDetails;
  /** When the stage's events happened; now by default. */
  readonly at?: Temporal.Instant;
  /**
   * The authoring customer account; by default the one the Workspace test
   * database always holds. Other databases, such as an E2E preview database,
   * name it.
   */
  readonly author?: CustomerAccountId;
  readonly locale?: Locale;
  /**
   * Columns the test sets itself, applied after the stage's columns. They can
   * contradict the stage, as a test of a constraint violation needs.
   */
  readonly overrides?: Partial<Omit<ReservationRow, "authorAccountId">>;
};

/**
 * The customer account that authors a fixture reservation naming no author of
 * its own. Every reservation has an author, and the Workspace test database
 * always holds this one.
 */
export const fixtureReservationAuthorId = customerAccountIdSchema.make(
  "fixture-reservation-author"
);

const syntheticId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const withDotyposReservation = (): StageColumns => ({
  dotyposReservationId: DotyposReservationIdSchema.make(
    syntheticId("fixture-dotypos-reservation")
  ),
});

type StateColumns<State extends string> = {
  readonly [Key in State]: (at: Temporal.Instant) => StageColumns;
};

/**
 * The columns each state needs beside itself and nothing more: the Dotypos
 * reservation every state from `held` on names, and the state's own
 * timestamp, such as a hold's expiry. Other history, such as when the Dotypos
 * reservation was created, stays unset until a test names it. Keyed by every
 * schema state, so a new state fails to compile here until it has its
 * columns.
 */
const reservationStateColumns = {
  draft: () => ({}),
  creating_hold: () => ({}),
  held: (at) => ({
    ...withDotyposReservation(),
    reservationHoldExpiresAt: at.add({ hours: 1 }),
  }),
  hold_expired: (at) => ({ reservationHoldExpiredAt: at }),
  confirming: withDotyposReservation,
  confirmed: (at) => ({
    ...withDotyposReservation(),
    reservationConfirmedAt: at,
  }),
  cancelling: withDotyposReservation,
  cancelled: (at) => ({
    ...withDotyposReservation(),
    reservationCancelledAt: at,
  }),
  cancellation_failed: withDotyposReservation,
} satisfies StateColumns<ReservationState>;

const paymentStateColumns = {
  not_started: () => ({}),
  pending: () => ({}),
  paid: (at) => ({ paidAt: at }),
  failed: () => ({}),
  cancelled: () => ({}),
  expired: () => ({}),
} satisfies StateColumns<PaymentState>;

const fulfillmentStateColumns = {
  not_started: () => ({}),
  processing: () => ({}),
  awaiting_delivery: () => ({
    activeCustomerEmailDeliveryId: EmailDeliveryIdSchema.make(
      syntheticId("fixture-email-delivery")
    ),
  }),
  fulfilled: (at) => ({ fulfilledAt: at }),
  failed: (at) => ({
    fulfillmentFailedAt: at,
    fulfillmentFailureCode: "fixture_fulfillment_failure",
  }),
} satisfies StateColumns<FulfillmentState>;

const defaultReservationDetails = {
  kind: "cowork",
  entryTier: "basic",
  coffee: false,
} as const satisfies StoredWorkspaceReservationDetails;

const reservationRow = ({
  stage,
  customer,
  details = defaultReservationDetails,
  at = Temporal.Now.instant(),
  author = fixtureReservationAuthorId,
  locale = "en-US",
  overrides,
}: ReservationFixtureInput): ReservationRow => {
  const {
    reservation,
    payment = "not_started",
    fulfillment = "not_started",
  } = stage;
  return {
    checkoutAttemptKey: checkoutAttemptKeySchema.make(
      syntheticId("fixture-attempt")
    ),
    dotyposCustomerId:
      customer ?? DotyposCustomerIdSchema.make(syntheticId("fixture-customer")),
    authorAccountId: author,
    reservationState: reservation,
    paymentState: payment,
    fulfillmentState: fulfillment,
    reservationDetails: details,
    locale,
    ...reservationStateColumns[reservation](at),
    ...paymentStateColumns[payment](at),
    ...fulfillmentStateColumns[fulfillment](at),
    ...overrides,
  };
};

/** Leaves a column to its schema default. */
const databaseDefault = sql`default`;

/** Rows per insert statement, well inside Postgres's bind-parameter limit. */
const reservationsPerStatement = 1000;

/**
 * Builds Workspace records at valid lifecycle stages in a test database:
 * synthetic logins and reservations whose columns satisfy the schema's
 * pairings of state, timestamps, and provider ids.
 */
export const workspaceFixtures = (db: WorkspaceDatabaseClient) => {
  const insertCustomerAccount = (
    executor: WorkspaceDatabaseClient,
    {
      id = customerAccountIdSchema.make(crypto.randomUUID()),
      linkedCustomer,
      review = false,
      legacy = false,
      createdAt,
      deletedAt,
    }: FixtureCustomerAccountOptions
  ) =>
    executor
      .insert(customerAccounts)
      .values({
        id,
        dotyposCustomerId: linkedCustomer ?? null,
        review,
        legacy,
        deletedAt: deletedAt ?? null,
        createdAt: createdAt ?? databaseDefault,
      })
      .pipe(Effect.as(id));

  const insertRoleGrant = (
    executor: WorkspaceDatabaseClient,
    accountId: CustomerAccountId,
    role: AccountRole,
    grantedBy?: CustomerAccountId
  ) =>
    executor
      .insert(accountRoleGrants)
      .values({ accountId, role, grantedByAccountId: grantedBy ?? null })
      .pipe(Effect.asVoid);

  const insertReservations = (inputs: readonly ReservationFixtureInput[]) =>
    Effect.forEach(
      Array.from(
        { length: Math.ceil(inputs.length / reservationsPerStatement) },
        (_, chunk) =>
          inputs.slice(
            chunk * reservationsPerStatement,
            (chunk + 1) * reservationsPerStatement
          )
      ),
      (chunk) =>
        db
          .insert(workspaceReservations)
          .values(chunk.map(reservationRow))
          .returning()
    ).pipe(Effect.map((chunks) => chunks.flat()));

  return {
    /**
     * Inserts a customer account and its login, verified and not awaiting
     * deletion unless the options say otherwise, with its role grants. The
     * email is marked sensitive in query logs.
     */
    account: (
      label: string,
      {
        id = customerAccountIdSchema.make(crypto.randomUUID()),
        email = testEmailAddress(`${label}-${id}`),
        name = "",
        verified = true,
        deletionRequested = false,
        review = false,
        legacy = false,
        linkedCustomer,
        roles = [],
        locale,
        createdAt,
        loginCreatedAt = createdAt,
      }: FixtureAccountOptions = {}
    ) =>
      db
        .transaction(
          Effect.fn(function* (tx) {
            yield* insertCustomerAccount(tx, {
              id,
              linkedCustomer,
              review,
              legacy,
              createdAt,
            });
            yield* tx.insert(authUser).values({
              id,
              name,
              email: email,
              emailVerified: verified,
              deletionRequestedAt: deletionRequested ? new Date() : null,
              locale: locale ?? null,
              createdAt: loginCreatedAt
                ? new Date(loginCreatedAt.epochMilliseconds)
                : databaseDefault,
            });
            yield* Effect.forEach(roles, (role) =>
              insertRoleGrant(tx, id, role)
            );
          })
        )
        .pipe(Effect.as<FixtureAccount>({ accountId: id, email })),

    /**
     * Grants a role to an account that already has a login, as an
     * administrator does; `grantedBy` names that administrator.
     */
    grantRole: (
      accountId: CustomerAccountId,
      role: AccountRole,
      { grantedBy }: { readonly grantedBy?: CustomerAccountId } = {}
    ) => insertRoleGrant(db, accountId, role, grantedBy),

    /** Inserts a customer account without a login and returns its id. */
    customerAccount: (options: FixtureCustomerAccountOptions = {}) =>
      insertCustomerAccount(db, options),

    /**
     * Deletes the accounts' logins; their grants and sessions cascade, and the
     * customer accounts stay as records do in production.
     */
    deleteAccounts: (accounts: readonly FixtureAccount[]) =>
      accounts.length === 0
        ? Effect.void
        : db
            .delete(authUser)
            .where(
              inArray(
                authUser.id,
                accounts.map(({ accountId }) => accountId)
              )
            )
            .pipe(Effect.asVoid),

    /** Inserts a reservation at the stage and returns the stored row. */
    reservation: (input: ReservationFixtureInput) =>
      insertReservations([input]).pipe(
        Effect.map(([reservation]) => reservation!)
      ),

    /**
     * Inserts many reservations in as few statements as the database allows
     * and returns the stored rows in input order. The statements aren't one
     * transaction; a caller that needs all or nothing passes a transaction as
     * the database.
     */
    reservations: insertReservations,
  };
};
