import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CustomerAccountAccessError } from "@/features/account";
import { CustomerAccountReservationOwnership } from "@/features/account/backend/customer-account-reservation-ownership";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { ReviewSandbox } from "@/features/review-accounts";
import { fixtureReservationAuthorId } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  createReservationAccessCookieCapability,
  reservationAccessCookieMaxAgeMilliseconds,
  sealReservationAccessCookie,
} from "./reservation-access-cookie";
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

type AuthorizedReservation = Pick<
  WorkspaceReservation,
  "dotyposCustomerId" | "authorAccountId"
>;

const makeReservation = (
  dotyposCustomerId = accountCustomerId,
  authorAccountId: string = fixtureReservationAuthorId
): AuthorizedReservation =>
  ({ dotyposCustomerId, authorAccountId }) as AuthorizedReservation;

const runAuthorization = async (options: {
  readonly input?: Partial<ReservationAuthorizationInput>;
  readonly owner?: "matches" | "different" | "unlinked" | "unavailable";
  readonly reservation?: AuthorizedReservation | null;
  /** Whether the order is one of the signed-in review account's sandbox orders. */
  readonly sandboxOrder?: boolean;
}) => {
  const findById = mock(() =>
    Effect.succeed(
      options.reservation === undefined
        ? makeReservation()
        : options.reservation
    )
  );
  const activeAccountId =
    options.owner === "unavailable"
      ? Effect.fail(new CustomerAccountAccessError({ reason: "unavailable" }))
      : Effect.succeed(customerAccountIdSchema.make("account-id"));
  const resolve =
    options.owner === "unavailable" || options.owner === "unlinked"
      ? mock(() =>
          Effect.fail(
            new CustomerAccountAccessError({
              reason: "link-required",
              linkReason: "not-found",
            })
          )
        )
      : mock(() =>
          Effect.succeed({
            accountId: customerAccountIdSchema.make("account-id"),
            dotyposCustomerId:
              options.owner === "different"
                ? "another-customer"
                : accountCustomerId,
          })
        );
  const input: ReservationAuthorizationInput = {
    locale: "en-US",
    orderId,
    permission: "view-status",
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
          activeAccountId,
          resolve: Effect.suspend(resolve),
        }),
        Layer.mock(WorkspaceReservationRepository, { findById }),
        Layer.mock(ReviewSandbox, {
          isOrderOf: () => Effect.succeed(options.sandboxOrder ?? false),
        })
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

const makeAccessCookie = async (
  cookieOrderId = orderId,
  issuedAtEpochMilliseconds = Date.now()
) => {
  const options = { now: () => issuedAtEpochMilliseconds };
  const capability = await Effect.runPromise(
    createReservationAccessCookieCapability(
      { orderId: cookieOrderId, locale: "en-US" },
      options
    )
  );
  return Effect.runPromise(
    sealReservationAccessCookie({ orderId: cookieOrderId, capability }, options)
  );
};

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

  test.each(["en-US", "cs-CZ"] as const)(
    "accepts a valid access cookie on the %s route before account or private reservation reads",
    async (locale) => {
      const result = await runAuthorization({
        input: { accessCookie: await makeAccessCookie(), locale },
        owner: "unavailable",
      });

      expect(result.authorized).toBe(true);
      expect(result.findById).not.toHaveBeenCalled();
    }
  );

  test.each(["tampered", "for another order", "expired"] as const)(
    "rejects an access cookie that is %s without private reads when no account is available",
    async (kind) => {
      let accessCookie: string;
      if (kind === "tampered") {
        accessCookie = `${await makeAccessCookie()}tampered`;
      } else if (kind === "for another order") {
        accessCookie = await makeAccessCookie(otherOrderId);
      } else {
        accessCookie = await makeAccessCookie(
          orderId,
          Date.now() - reservationAccessCookieMaxAgeMilliseconds - 1000
        );
      }
      const result = await runAuthorization({
        input: { accessCookie },
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
    [
      "the author booking for another customer",
      {
        owner: "different" as const,
        reservation: makeReservation("booked-for-customer", "account-id"),
      },
      true,
    ],
    [
      "another account's authored reservation",
      {
        owner: "different" as const,
        reservation: makeReservation("booked-for-customer", "other-account"),
      },
      false,
    ],
  ] as const)(
    "checks exact local reservation ownership for %s",
    async (_label, options, expected) => {
      const result = await runAuthorization(options);

      expect(result.authorized).toBe(expected);
      expect(result.findById).toHaveBeenCalledWith(orderId);
    }
  );

  test("allows the status to an author whose account has no linked customer", async () => {
    const result = await runAuthorization({
      owner: "unlinked",
      reservation: makeReservation("booked-for-customer", "account-id"),
    });

    expect(result.authorized).toBe(true);
    expect(result.resolve).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the author booking for another customer",
      {
        owner: "different" as const,
        reservation: makeReservation("booked-for-customer", "account-id"),
      },
      false,
    ],
    [
      "an unlinked author",
      {
        owner: "unlinked" as const,
        reservation: makeReservation("booked-for-customer", "account-id"),
      },
      false,
    ],
    ["the customer's linked account", { owner: "matches" as const }, true],
    [
      "the customer's linked account that also authored it",
      {
        owner: "matches" as const,
        reservation: makeReservation(accountCustomerId, "account-id"),
      },
      true,
    ],
  ] as const)(
    "decides the access code for %s by customer ownership only",
    async (_label, options, expected) => {
      const result = await runAuthorization({
        ...options,
        input: { permission: "view-access-code" },
      });

      expect(result.authorized).toBe(expected);
    }
  );

  test.each(["view-status", "view-access-code"] as const)(
    "accepts a valid capability for %s without an account",
    async (permission) => {
      const result = await runAuthorization({
        input: { accessToken: await makeAccessToken(), permission },
        owner: "unavailable",
      });

      expect(result.authorized).toBe(true);
    }
  );
});

describe("a review account's sandbox order", () => {
  test("shows its status to the account but never its access code", async () => {
    const status = await runAuthorization({
      reservation: null,
      sandboxOrder: true,
    });
    const accessCode = await runAuthorization({
      input: { permission: "view-access-code" },
      reservation: null,
      sandboxOrder: true,
    });

    expect(status.authorized).toBe(true);
    expect(accessCode.authorized).toBe(false);
  });

  test("stays hidden from every other account", async () => {
    const result = await runAuthorization({
      reservation: null,
      sandboxOrder: false,
    });

    expect(result.authorized).toBe(false);
  });
});
