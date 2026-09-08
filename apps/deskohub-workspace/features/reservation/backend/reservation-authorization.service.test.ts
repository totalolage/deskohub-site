import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CustomerAccountAccessError } from "@/features/account";
import { CustomerAccountReservationOwnership } from "@/features/account/backend/customer-account-reservation-ownership";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { createReservationAccessToken } from "./reservation-access-token";
import {
  type ReservationAuthorizationInput,
  ReservationAuthorizationService,
} from "./reservation-authorization.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

const orderId = workspaceReservationIdSchema.make("reservation-1");
const otherOrderId = workspaceReservationIdSchema.make("reservation-2");
const accountCustomerId = "customer-owner";

const makeReservation = (
  dotyposCustomerId = accountCustomerId
): Pick<WorkspaceReservation, "dotyposCustomerId"> => ({
  dotyposCustomerId,
});

const runAuthorization = async (options: {
  readonly input?: Partial<ReservationAuthorizationInput>;
  readonly owner?: "matches" | "different" | "unavailable";
  readonly reservation?: Pick<WorkspaceReservation, "dotyposCustomerId"> | null;
}) => {
  const findById = mock(() =>
    Effect.succeed(
      options.reservation === undefined
        ? makeReservation()
        : options.reservation
    )
  );
  const resolve =
    options.owner === "unavailable"
      ? () =>
          Effect.fail(new CustomerAccountAccessError({ reason: "unavailable" }))
      : () =>
          Effect.succeed({
            accountId: "account-id",
            dotyposCustomerId:
              options.owner === "different"
                ? "another-customer"
                : accountCustomerId,
          });
  const input: ReservationAuthorizationInput = {
    locale: "en-US",
    orderId,
    ...options.input,
  };

  const authorized = await Effect.gen(function* () {
    const service = yield* ReservationAuthorizationService;
    return yield* service.isAuthorized(input);
  }).pipe(
    Effect.provide(ReservationAuthorizationService.Default),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerAccountReservationOwnership, {
          resolve: resolve(),
        }),
        Layer.mock(WorkspaceReservationRepository, { findById })
      )
    ),
    Effect.runPromise
  );

  return { authorized, findById, resolve };
};

const makeAccessToken = async (tokenOrderId = orderId) =>
  Effect.runPromise(
    createReservationAccessToken({ orderId: tokenOrderId, locale: "en-US" })
  );

describe("ReservationAuthorizationService", () => {
  test("accepts a valid capability before account or private reservation reads", async () => {
    const accessToken = await makeAccessToken();
    const result = await runAuthorization({
      input: { accessToken },
      owner: "unavailable",
    });

    expect(result.authorized).toBe(true);
    expect(result.findById).not.toHaveBeenCalled();
  });

  test.each(["missing", "bad", "wrong-order"] as const)(
    "rejects a %s capability without private reads when no account is available",
    async (kind) => {
      let accessToken: ReservationAccessToken | undefined;
      if (kind === "bad") {
        accessToken =
          `${await makeAccessToken()}tampered` as ReservationAccessToken;
      } else if (kind === "wrong-order") {
        accessToken = await makeAccessToken(otherOrderId);
      }
      const result = await runAuthorization({
        input: { accessToken },
        owner: "unavailable",
      });

      expect(result.authorized).toBe(false);
      expect(result.findById).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["wrong customer", { owner: "different" as const }, false],
    ["missing reservation", { reservation: null }, false],
    ["matching owner", { owner: "matches" as const }, true],
  ] as const)(
    "checks exact local reservation ownership for %s",
    async (_label, options, expected) => {
      const result = await runAuthorization(options);

      expect(result.authorized).toBe(expected);
      expect(result.findById).toHaveBeenCalledWith(orderId);
    }
  );

  test("keeps owner authorization independent of the route locale", async () => {
    const result = await runAuthorization({
      input: { locale: "cs-CZ" },
      owner: "matches",
    });

    expect(result.authorized).toBe(true);
  });
});
