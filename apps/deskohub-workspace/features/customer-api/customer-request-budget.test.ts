import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import { HttpApi } from "effect/unstable/httpapi";
import { customerRequestBudgetClasses } from "./customer-request-budget";

/** Each contract endpoint's method, by `group.endpoint`. */
const contractMethods = () => {
  const methods = new Map<string, string>();
  HttpApi.reflect(WorkspaceCustomerApi, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint }) => {
      methods.set(`${group.identifier}.${endpoint.name}`, endpoint.method);
    },
  });
  return methods;
};

const contractEndpoints = () => [...contractMethods().keys()].toSorted();

describe("customer request budget classes", () => {
  test("classify exactly the endpoints the contract has", () => {
    const classified = Object.entries(customerRequestBudgetClasses)
      .flatMap(([group, endpoints]) =>
        Object.keys(endpoints).map((endpoint) => `${group}.${endpoint}`)
      )
      .toSorted();

    expect(contractEndpoints()).toHaveLength(16);
    expect(classified).toEqual(contractEndpoints());
  });

  test("classify the endpoints that never reach Dotypos as workspace-only", () => {
    expect(customerRequestBudgetClasses.account).toMatchObject({
      listPasskeys: "workspace-only",
      listAssistantConnections: "workspace-only",
    });
  });

  test("give each Dotypos-backed endpoint the budget of its method: GET reads, every other method mutates", () => {
    const methods = contractMethods();
    const mismatched = Object.entries(customerRequestBudgetClasses).flatMap(
      ([group, endpoints]) =>
        Object.entries(endpoints)
          .filter(([, budgetClass]) => budgetClass !== "workspace-only")
          .filter(
            ([endpoint, budgetClass]) =>
              (methods.get(`${group}.${endpoint}`) === "GET") !==
              (budgetClass === "dotypos-read")
          )
          .map(
            ([endpoint, budgetClass]) => `${group}.${endpoint}: ${budgetClass}`
          )
    );

    expect(mismatched).toEqual([]);
    expect(
      Object.values(customerRequestBudgetClasses.account).filter(
        (budgetClass) => budgetClass === "dotypos-read"
      )
    ).toHaveLength(3);
    expect(
      Object.values(customerRequestBudgetClasses.reservations).filter(
        (budgetClass) => budgetClass === "dotypos-read"
      )
    ).toHaveLength(4);
  });
});
