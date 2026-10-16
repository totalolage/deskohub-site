import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";

const authorizeAdministratorPage = mock(async () => "Fixture Operator");
mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({ authorizeAdministratorPage })
);

let discountGroupsResult: Effect.Effect<unknown, unknown> = Effect.succeed([]);
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: async () => "en-US",
}));
const getDiscountGroups = mock(() => discountGroupsResult);
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getDiscountGroups,
  } as never),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (
      _operation: string,
      _options?: {
        readonly boundary?: "action" | "page" | "route" | "run" | "task";
        readonly signal?: AbortSignal;
      }
    ) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));

const { DotyposService, ExternalAPIError } = await import("@deskohub/dotypos");
const { loadDiscountGroupOptions } = await import(
  "./discount-group-options.server"
);

beforeEach(() => {
  discountGroupsResult = Effect.succeed([]);
  getDiscountGroups.mockClear();
  authorizeAdministratorPage.mockClear();
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
    expect(authorizeAdministratorPage).toHaveBeenCalledTimes(1);
    expect(getDiscountGroups).toHaveBeenCalledTimes(1);
  });

  test("resolves to undefined when Dotypos returns an ExternalAPIError", async () => {
    discountGroupsResult = Effect.fail(
      new ExternalAPIError({
        service: "dotypos",
        operation: "getDiscountGroups",
        message: "Synthetic provider outage",
      })
    );

    await expect(loadDiscountGroupOptions()).resolves.toBeUndefined();

    expect(authorizeAdministratorPage).toHaveBeenCalledTimes(1);
    expect(getDiscountGroups).toHaveBeenCalledTimes(1);
  });
});
