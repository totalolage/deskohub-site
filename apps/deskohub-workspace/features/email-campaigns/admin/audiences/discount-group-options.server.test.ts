import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";

const access = mockAdministratorAccess("discount-group-options");

let discountGroupsResult: Effect.Effect<unknown, unknown> = Effect.succeed([]);
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: async () => "en-US",
}));
const getDiscountGroups = mock(() => discountGroupsResult);
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getDiscountGroups,
  } as never),
}));

const { DotyposRejected, DotyposService } = await import("@deskohub/dotypos");
const { loadDiscountGroupOptions } = await import(
  "./discount-group-options.server"
);

let readsBefore = 0;

beforeEach(() => {
  access.set("administrator");
  discountGroupsResult = Effect.succeed([]);
  getDiscountGroups.mockClear();
  readsBefore = access.reads();
});

describe("loadDiscountGroupOptions", () => {
  test("maps active groups, supplies blank names, drops incomplete entries, and sorts by name", async () => {
    discountGroupsResult = Effect.succeed([
      { id: "10", name: " Zulu ", deleted: false, discountPercent: "10" },
      { id: "2", name: "   ", deleted: false, discountPercent: null },
      { id: "3", name: "Alpha", deleted: false, discountPercent: "5" },
      { name: "No ID", deleted: false, discountPercent: null },
      { id: "4", name: "Deleted", deleted: true, discountPercent: "2" },
    ]);

    const result = await loadDiscountGroupOptions();

    expect(result).toEqual([
      { id: "3", name: "Alpha" },
      { id: "2", name: "Group 2" },
      { id: "10", name: "Zulu" },
    ]);
    expect(access.reads() - readsBefore).toBe(1);
    expect(getDiscountGroups).toHaveBeenCalledTimes(1);
  });

  test("resolves to undefined when Dotypos returns a rejection", async () => {
    discountGroupsResult = Effect.fail(
      new DotyposRejected({
        operation: "getDiscountGroups",
        reason: "invalid-response",
        message: "Synthetic provider outage",
      })
    );

    await expect(loadDiscountGroupOptions()).resolves.toBeUndefined();

    expect(access.reads() - readsBefore).toBe(1);
    expect(getDiscountGroups).toHaveBeenCalledTimes(1);
  });

  test("doesn't read Dotypos for an account without the grant", async () => {
    access.set("not-administrator");

    await expect(loadDiscountGroupOptions()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });

    expect(getDiscountGroups).not.toHaveBeenCalled();
  });
});
