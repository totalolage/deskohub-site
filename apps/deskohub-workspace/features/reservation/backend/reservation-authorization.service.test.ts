import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer } from "effect";
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
const queryFailure = new EffectDrizzleQueryError({
  query: "select 1",
  params: [],
  cause: Cause.die(new Error("connection reset")),
});

type AuthorizedReservation = Pick<
  WorkspaceReservation,
  "dotyposCustomerId" | "authorAccountId"
>;

const makeReservation = (
  dotyposCustomerId = accountCustomerId,
  authorAccountId: string = fixtureReservationAuthorId
): AuthorizedReservation =>
  ({ dotyposCustomerId, authorAccountId }) as AuthorizedReservation;

type AuthorizationOptions = {
  readonly input?: Partial<ReservationAuthorizationInput>;
  /**
   * The signed-in account: linked to the reservation's customer, linked to
   * another one, unlinked, signed out, unreadable altogether, or readable
   * with an unreadable customer link.
   */
  readonly owner?:
    | "matches"
    | "different"
    | "unlinked"
    | "signed-out"
    | "unavailable"
    | "link-unavailable";
  readonly reservation?: AuthorizedReservation | null | "unreadable";
  /** Whether the order is one of the signed-in review account's sandbox orders. */
  readonly sandboxOrder?: boolean | "unreadable";
};

const resolveLinkedAccount = (owner: AuthorizationOptions["owner"]) => {
  switch (owner) {
    case "link-unavailable":
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "unavailable" })
      );
    case "unavailable":
    case "unlinked":
    case "signed-out":
      return Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "not-found",
        })
      );
    default:
      return Effect.succeed({
        accountId: customerAccountIdSchema.make("account-id"),
        dotyposCustomerId:
          owner === "different" ? "another-customer" : accountCustomerId,
      });
  }
};

const prepareAuthorization = (options: AuthorizationOptions) => {
  const findById = mock(() =>
    options.reservation === "unreadable"
      ? Effect.fail(queryFailure)
      : Effect.succeed(
          options.reservation === undefined
            ? makeReservation()
            : options.reservation
        )
  );
  const activeAccountId =
    options.owner === "unavailable" || options.owner === "signed-out"
      ? Effect.fail(
          new CustomerAccountAccessError({
            reason:
              options.owner === "signed-out"
                ? "unauthenticated"
                : "unavailable",
          })
        )
      : Effect.succeed(customerAccountIdSchema.make("account-id"));
  const resolve = mock(() => resolveLinkedAccount(options.owner));
  const input: ReservationAuthorizationInput = {
    locale: "en-US",
    orderId,
    permission: "view-status",
    ...options.input,
  };

  const layer = ReservationAuthorizationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerAccountReservationOwnership, {
          activeAccountId,
          resolve: Effect.suspend(resolve),
        }),
        Layer.mock(WorkspaceReservationRepository, { findById }),
        Layer.mock(ReviewSandbox, {
          isOrderOf: () =>
            options.sandboxOrder === "unreadable"
              ? Effect.fail(queryFailure)
              : Effect.succeed(options.sandboxOrder ?? false),
        })
      )
    )
  );

  return { layer, input, findById, resolve };
};

/** Runs the fail-closed check every reservation page uses. */
const runAuthorization = async (options: AuthorizationOptions) => {
  const { layer, input, findById, resolve } = prepareAuthorization(options);
  const authorized = await ReservationAuthorizationService.pipe(
    Effect.flatMap((service) => service.isAuthorized(input)),
    Effect.provide(layer),
    Effect.runPromise
  );

  return { authorized, findById, resolve };
};

/** Runs the check that reports a failed read instead of denying. */
const runAuthorize = (options: AuthorizationOptions) => {
  const { layer, input } = prepareAuthorization(options);
  return ReservationAuthorizationService.pipe(
    Effect.flatMap((service) => service.authorize(input)),
    Effect.result,
    Effect.provide(layer),
    Effect.runPromise
  );
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

  test("denies an account when the reservation can't be read", async () => {
    const result = await runAuthorization({
      owner: "matches",
      reservation: "unreadable",
    });

    expect(result.authorized).toBe(false);
    expect(result.resolve).not.toHaveBeenCalled();
  });

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
    "decides the access code and invoice for %s by customer ownership only",
    async (_label, options, expected) => {
      const accessCode = await runAuthorization({
        ...options,
        input: { permission: "view-access-code" },
      });
      const invoice = await runAuthorization({
        ...options,
        input: { permission: "view-invoice" },
      });

      expect(accessCode.authorized).toBe(expected);
      expect(invoice.authorized).toBe(expected);
    }
  );

  test.each(["view-status", "view-access-code", "view-invoice"] as const)(
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

describe("authorizing without failing closed", () => {
  test.each([
    ["account", "view-invoice", { owner: "unavailable" }],
    ["customer link", "view-invoice", { owner: "link-unavailable" }],
    [
      "reservation",
      "view-invoice",
      { owner: "matches", reservation: "unreadable" },
    ],
    // Only a permission the author holds reaches the sandbox lookup.
    [
      "review sandbox",
      "view-status",
      { owner: "matches", reservation: null, sandboxOrder: "unreadable" },
    ],
  ] as const)(
    "reports an unreadable %s instead of denying %s",
    async (_label, permission, options) => {
      const result = await runAuthorize({ ...options, input: { permission } });
      const failClosed = await runAuthorization({
        ...options,
        input: { permission },
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ReservationAuthorizationUnavailableError", orderId },
      });
      expect(failClosed.authorized).toBe(false);
    }
  );

  test.each([
    ["grants the linked customer", { owner: "matches" }, true],
    ["denies a signed-out visitor", { owner: "signed-out" }, false],
    ["denies an unlinked account", { owner: "unlinked" }, false],
    ["denies a missing order", { owner: "matches", reservation: null }, false],
  ] as const)("%s", async (_label, options, expected) => {
    const result = await runAuthorize({
      ...options,
      input: { permission: "view-invoice" },
    });

    expect(result).toMatchObject({ _tag: "Success", success: expected });
  });

  test("accepts a valid capability while the account is unreadable", async () => {
    const result = await runAuthorize({
      owner: "unavailable",
      input: {
        accessToken: await makeAccessToken(),
        permission: "view-invoice",
      },
    });

    expect(result).toMatchObject({ _tag: "Success", success: true });
  });
});

describe("a review account's sandbox order", () => {
  test("shows its status to the account but never its access code or invoice", async () => {
    const status = await runAuthorization({
      reservation: null,
      sandboxOrder: true,
    });
    const accessCode = await runAuthorization({
      input: { permission: "view-access-code" },
      reservation: null,
      sandboxOrder: true,
    });
    const invoice = await runAuthorization({
      input: { permission: "view-invoice" },
      reservation: null,
      sandboxOrder: true,
    });

    expect(status.authorized).toBe(true);
    expect(accessCode.authorized).toBe(false);
    expect(invoice.authorized).toBe(false);
  });

  test("stays hidden from every other account", async () => {
    const result = await runAuthorization({
      reservation: null,
      sandboxOrder: false,
    });

    expect(result.authorized).toBe(false);
  });

  test("stays hidden when the sandbox lookup fails", async () => {
    const result = await runAuthorization({
      reservation: null,
      sandboxOrder: "unreadable",
    });

    expect(result.authorized).toBe(false);
  });
});
