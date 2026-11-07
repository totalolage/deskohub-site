import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import { HttpApi } from "effect/unstable/httpapi";
import { customerRequestBudgetClasses } from "./customer-request-budget";

const contractEndpoints = () => {
  const endpoints: string[] = [];
  HttpApi.reflect(WorkspaceCustomerApi, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint }) => {
      endpoints.push(`${group.identifier}.${endpoint.name}`);
    },
  });
  return endpoints.toSorted();
};

describe("customer request budget classes", () => {
  test("classify exactly the endpoints the contract has", () => {
    const classified = Object.entries(customerRequestBudgetClasses)
      .flatMap(([group, endpoints]) =>
        Object.keys(endpoints).map((endpoint) => `${group}.${endpoint}`)
      )
      .toSorted();

    expect(contractEndpoints()).toHaveLength(12);
    expect(classified).toEqual(contractEndpoints());
  });

  test("keep only the endpoints that never reach Dotypos general", () => {
    expect(customerRequestBudgetClasses.account).toMatchObject({
      listPasskeys: "general",
      listAssistantConnections: "general",
    });
    expect(
      Object.values(customerRequestBudgetClasses.account).filter(
        (budgetClass) => budgetClass === "dotypos"
      )
    ).toHaveLength(10);
  });
});
