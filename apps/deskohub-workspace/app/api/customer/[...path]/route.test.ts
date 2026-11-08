import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import { HttpApi } from "effect/unstable/httpapi";

const contractMethods = () => {
  const methods = new Set<string>();
  HttpApi.reflect(WorkspaceCustomerApi, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => {
      methods.add(endpoint.method);
    },
  });
  return [...methods];
};

describe("customer API route", () => {
  // Next.js answers a method the route module doesn't export with 405 before
  // the API handler runs, so every method the contract uses needs an export.
  test("exports a handler for every method the customer API contract uses", async () => {
    const exported = new Set(Object.keys(await import("./route")));
    const methods = contractMethods();

    expect(methods).not.toHaveLength(0);
    const missing = methods.filter((method) => !exported.has(method));

    expect(missing).toEqual([]);
  });

  // The handler decides what a disconnect stops (`runToCompletion`); a GET
  // route that interrupted its own runner would answer before a door code
  // or payment refresh finished.
  test("serves every method through the one route that waits for its handler", async () => {
    const route = await import("./route");

    expect(new Set([route.DELETE, route.PATCH, route.POST, route.PUT])).toEqual(
      new Set([route.GET])
    );
  });
});
