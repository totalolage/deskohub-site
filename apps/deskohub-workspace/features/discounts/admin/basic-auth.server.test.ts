import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";
import { env } from "@/env";

let requestHeaders = new Headers();

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
}));

const loadAuthorization = async () =>
  await import("./basic-auth.server").then(
    ({ requireDiscountAdminAuthorization }) =>
      requireDiscountAdminAuthorization()
  );

describe("discount administration server authorization", () => {
  test("authorizes the configured Basic credentials at the operation boundary", async () => {
    requestHeaders = new Headers({
      authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}`,
    });

    const exit = await Effect.runPromiseExit(await loadAuthorization());

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("rejects direct operation calls without valid Basic credentials", async () => {
    for (const authorization of [
      undefined,
      "Basic malformed",
      `Basic ${Buffer.from("admin:wrong-password").toString("base64")}`,
    ]) {
      requestHeaders = new Headers(
        authorization ? { authorization } : undefined
      );

      const exit = await Effect.runPromiseExit(await loadAuthorization());

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain(
          "DiscountAdminUnauthorizedError"
        );
      }
    }
  });

  test("keeps operation authorization enabled during synthetic page previews", async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const previousFixtureSetting = env.ADMIN_PREVIEW_FIXTURES;
    process.env.NODE_ENV = "development";
    Object.assign(env, { ADMIN_PREVIEW_FIXTURES: "true" });
    requestHeaders = new Headers();

    try {
      const exit = await Effect.runPromiseExit(await loadAuthorization());

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain(
          "DiscountAdminUnauthorizedError"
        );
      }
    } finally {
      process.env.NODE_ENV = previousNodeEnvironment;
      Object.assign(env, { ADMIN_PREVIEW_FIXTURES: previousFixtureSetting });
    }
  });

  test("rejects direct invocations of every exported admin action", async () => {
    requestHeaders = new Headers({
      referer: "https://deskohub.test/admin/discounts",
    });
    const { mutateDiscountAdmin, searchDiscountAdminCustomers } = await import(
      "./actions"
    );
    const { getAdministrationReservation } = await import(
      "@/features/administration/actions"
    );

    const mutation = await mutateDiscountAdmin({
      kind: "delete-discount",
      id: "00000000-0000-0000-0000-000000000001",
    });
    const search = await searchDiscountAdminCustomers({
      query: "attacker-controlled-name",
    });
    const reservation = await getAdministrationReservation({
      identifier: "attacker-controlled-id",
    });

    expect(mutation).toHaveProperty("serverError");
    expect(mutation).not.toHaveProperty("data");
    expect(search).toHaveProperty("serverError");
    expect(search).not.toHaveProperty("data");
    expect(reservation).toHaveProperty("serverError");
    expect(reservation).not.toHaveProperty("data");
  });
});
