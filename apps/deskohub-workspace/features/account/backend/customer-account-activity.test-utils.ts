import { Effect, Layer } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import {
  OptionalAccountActivityGuard,
  requireOptionalAccountActivity,
} from "./customer-account-activity";
import type { CustomerAccountActivityState } from "./customer-account-link.repository";

export type OptionalAccountActivityFixture = {
  readonly session?: {
    readonly deletionRequested?: boolean;
  } | null;
  readonly activityState?: "active" | "deletion-requested" | "missing";
  readonly sessionUnavailable?: boolean;
};

/**
 * Builds the real optional-activity guard over injected authority fakes so
 * seam tests exercise the actual anonymous-pass-through, marker, and
 * missing-row decisions and can observe which authority reads happened.
 */
export const makeOptionalAccountActivityGuard = (
  fixture: OptionalAccountActivityFixture = {}
): {
  readonly layer: Layer.Layer<OptionalAccountActivityGuard>;
  readonly events: string[];
} => {
  const events: string[] = [];
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
  const currentUser = (() => {
    if (fixture.sessionUnavailable === true) {
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "not-configured" })
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

  const require = requireOptionalAccountActivity(
    { currentUser },
    {
      findActivityState: () =>
        Effect.succeed(activityState).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              events.push("account-activity");
            })
          )
        ),
    }
  );

  return {
    events,
    layer: Layer.mock(OptionalAccountActivityGuard, { require }),
  };
};
