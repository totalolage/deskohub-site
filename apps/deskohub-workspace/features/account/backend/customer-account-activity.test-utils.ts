import { Effect, Layer } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import {
  guardOptionalAccountStateCreation,
  OptionalAccountActivityGuard,
} from "./customer-account-activity";
import type { CustomerAccountActivityState } from "./customer-account-link.repository";

export type OptionalAccountActivityFixture = {
  readonly session?: {
    readonly deletionRequested?: boolean;
  } | null;
  readonly activityState?: "active" | "deletion-requested" | "missing";
  /** Fails the session authority with the fail-closed `unavailable` reason. */
  readonly sessionUnavailable?: boolean;
  /** Mutated by the fake advisory lock so tests can sample lock state mid-section. */
  readonly lockProbe?: { held: boolean };
};

/**
 * Builds the real optional-activity guard over injected authority fakes so
 * seam tests exercise the actual anonymous-pass-through, lock, marker, and
 * missing-row decisions and can observe which authority reads happened and
 * when the account lock is held.
 */
export const makeOptionalAccountActivityGuard = (
  fixture: OptionalAccountActivityFixture = {}
): {
  readonly layer: Layer.Layer<OptionalAccountActivityGuard>;
  readonly events: string[];
} => {
  const events: string[] = [];
  const accountId = customerAccountIdSchema.make(
    "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
  );
  const session =
    fixture.session === undefined || fixture.session === null
      ? null
      : ({
          accountId: customerAccountIdSchema.make(
            "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
          ),
          email: reservationCustomerEmailSchema.make("ada@example.test"),
          deletionRequested: fixture.session.deletionRequested ?? false,
        } as const);
  const deletionRequestedAt = new Date("2026-09-01T10:00:00.000Z");
  const activityState: CustomerAccountActivityState = (() => {
    if (fixture.activityState === "missing") return { kind: "missing" };
    if (fixture.activityState === "deletion-requested") {
      return { kind: "active", deletionRequestedAt };
    }
    return { kind: "active", deletionRequestedAt: null };
  })();
  const currentUser: Effect.Effect<
    { readonly accountId: typeof accountId } | null,
    CustomerAccountAccessError
  > = (() => {
    if (fixture.sessionUnavailable === true) {
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "unavailable" })
      );
    }
    if (session === null) return Effect.succeed(null);
    return Effect.succeed(session).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          events.push("account-session");
        })
      )
    );
  })();

  const guardDependencies = {
    currentUser,
    findActivityState: () =>
      Effect.succeed(activityState).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            events.push("account-activity");
          })
        )
      ),
    withAccountLock: <A, E, R>(
      _lockedAccountId: typeof accountId,
      effect: Effect.Effect<A, E, R>
    ) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          events.push("account-lock-acquired");
          if (fixture.lockProbe) fixture.lockProbe.held = true;
        }),
        () => effect,
        () =>
          Effect.sync(() => {
            if (fixture.lockProbe) fixture.lockProbe.held = false;
            events.push("account-lock-released");
          })
      ),
  };

  const guardStateCreation = <A, E, R>(stateCreation: Effect.Effect<A, E, R>) =>
    guardOptionalAccountStateCreation(guardDependencies, stateCreation);

  return {
    events,
    layer: Layer.mock(OptionalAccountActivityGuard, { guardStateCreation }),
  };
};
