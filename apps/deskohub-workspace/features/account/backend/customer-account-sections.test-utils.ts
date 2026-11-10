import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import {
  type CustomerAccountActivityState,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import { CustomerAccountSections } from "./customer-account-sections";
import { CustomerAuthentication } from "./customer-authentication.service";
import { testSessionProfile } from "./customer-authentication.test-utils";

export const sectionAccountId = customerAccountIdSchema.make(
  "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
);
export const sectionAccountEmail = reservationCustomerEmailSchema.make(
  testEmailAddress("ada")
);

export type CustomerAccountSectionsFixture = {
  /** The session's account; null or omitted is anonymous. */
  readonly session?: {
    readonly accountId?: typeof sectionAccountId;
    readonly deletionRequested?: boolean;
  } | null;
  readonly activityState?: "active" | "deletion-requested" | "missing";
  /** Fails the session authority with the fail-closed `unavailable` reason. */
  readonly sessionUnavailable?: boolean;
  /** Fails the session authority as Better Auth not being configured. */
  readonly authenticationNotConfigured?: boolean;
  /** Fails taking the lock with the advisory lock's SqlError. */
  readonly lockUnavailable?: boolean;
  /** Mutated by the fake advisory lock so tests can sample lock state mid-section. */
  readonly lockProbe?: { held: boolean };
};

/**
 * The real `CustomerAccountSections` over an in-memory session, account
 * activity row, and advisory lock, so unit tests exercise the real recheck,
 * reuse, and error mapping and can observe which authority reads happened and
 * when the account lock is held. Events: `account-session`,
 * `account-activity`, `account-lock-acquired`, `account-lock-released`.
 */
export const makeCustomerAccountSections = (
  fixture: CustomerAccountSectionsFixture = {}
): {
  readonly layer: Layer.Layer<CustomerAccountSections>;
  readonly events: string[];
} => {
  const events: string[] = [];
  const record = (event: string) =>
    Effect.sync(() => {
      events.push(event);
    });

  const session =
    fixture.session === undefined || fixture.session === null
      ? null
      : {
          accountId: fixture.session.accountId ?? sectionAccountId,
          email: sectionAccountEmail,
          deletionRequested: fixture.session.deletionRequested ?? false,
          ...testSessionProfile,
        };
  const activityState: CustomerAccountActivityState = (() => {
    if (fixture.activityState === "missing") return { kind: "missing" };
    return {
      kind: "active",
      email: sectionAccountEmail,
      deletionRequestedAt:
        fixture.activityState === "deletion-requested"
          ? new Date("2026-09-01T10:00:00.000Z")
          : null,
    };
  })();

  const currentUser = (() => {
    if (fixture.sessionUnavailable === true) {
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "unavailable" })
      );
    }
    if (fixture.authenticationNotConfigured === true) {
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "not-configured" })
      );
    }
    return Effect.succeed(session).pipe(
      Effect.tap((current) =>
        current === null ? Effect.void : record("account-session")
      )
    );
  })();

  const holdLock = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | SqlError.SqlError, R> =>
    fixture.lockUnavailable === true
      ? Effect.fail(
          new SqlError.SqlError({
            reason: new SqlError.ConnectionError({
              cause: new Error("advisory lock unavailable"),
              message: "advisory lock unavailable",
              operation: "connect",
            }),
          })
        )
      : Effect.acquireUseRelease(
          Effect.sync(() => {
            if (fixture.lockProbe) fixture.lockProbe.held = true;
          }).pipe(Effect.andThen(record("account-lock-acquired"))),
          () => effect,
          () =>
            Effect.sync(() => {
              if (fixture.lockProbe) fixture.lockProbe.held = false;
            }).pipe(Effect.andThen(record("account-lock-released")))
        );

  return {
    events,
    layer: CustomerAccountSections.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CustomerAuthentication, { currentUser }),
          Layer.mock(CustomerAccountLinkRepository, {
            findActivityState: () =>
              Effect.succeed(activityState).pipe(
                Effect.tap(() => record("account-activity"))
              ),
          }),
          Layer.succeed(WorkspaceDatabaseAdvisoryLock, {
            withTransactionPermit: (effect) => effect,
            withLock: (_key, effect) => holdLock(effect),
            withLocks: (_keys, effect) => holdLock(effect),
          })
        )
      )
    ),
  };
};
