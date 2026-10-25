import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { HttpApi } from "effect/unstable/httpapi";

const contractMethods = () => {
  const methods = new Set<string>();
  HttpApi.reflect(WorkspaceAdminApi, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => {
      methods.add(endpoint.method);
    },
  });
  return [...methods];
};

describe("admin CLI API route", () => {
  // Next.js answers a method the route module doesn't export with 405 before
  // the API handler runs, so every method the contract uses needs an export.
  test("exports a handler for every method the admin API contract uses", async () => {
    const exported = new Set(Object.keys(await import("./route")));
    const methods = contractMethods();

    expect(methods).not.toHaveLength(0);
    const missing = methods.filter((method) => !exported.has(method));

    expect(missing).toEqual([]);
  });
});
