import { describe, expect, test } from "bun:test";
import {
  type EmailCustomerSelection,
  EmailCustomerSelectionInvalid,
  inspectEmailCustomerSelection,
} from "./email-customer-selection";

const reservations = ["activity", "reservations"];

const problem = (selection: Omit<EmailCustomerSelection, "kind">) => {
  const result = inspectEmailCustomerSelection({
    kind: "customer",
    ...selection,
  });
  return result instanceof EmailCustomerSelectionInvalid
    ? { path: result.path, reason: result.reason }
    : undefined;
};

describe("inspectEmailCustomerSelection", () => {
  test("returns the selected field for a valid selection", () => {
    expect(
      inspectEmailCustomerSelection({
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      })
    ).toEqual({
      kind: "scalar",
      type: "string",
      nullable: true,
      optional: false,
    });
    expect(
      inspectEmailCustomerSelection({
        kind: "customer",
        path: reservations,
        fields: [["type"], ["status", "label"]],
        sort: { path: ["createdAt"], direction: "desc" },
        limit: 3,
      })
    ).toMatchObject({ kind: "list", element: { kind: "record" } });
  });

  test("rejects a path outside the catalogue or across a list", () => {
    expect(problem({ path: ["profile", "unknown"] })).toEqual({
      path: ["profile", "unknown"],
      reason: "unknown-path",
    });
    expect(problem({ path: [...reservations, "type"] })?.reason).toBe(
      "unknown-path"
    );
  });

  test("requires fields when the selection is a record or a list of records", () => {
    expect(problem({ path: ["profile", "customer"] })?.reason).toBe(
      "fields-required"
    );
    expect(problem({ path: reservations, fields: [] })?.reason).toBe(
      "fields-required"
    );
  });

  test("rejects fields of a scalar, repeated fields and non-scalar fields", () => {
    const customer = ["profile", "customer"];

    expect(
      problem({ path: [...customer, "email"], fields: [["email"]] })?.reason
    ).toBe("invalid-fields");
    expect(
      problem({ path: customer, fields: [["email"], ["email"]] })?.reason
    ).toBe("invalid-fields");
    expect(problem({ path: reservations, fields: [["status"]] })?.reason).toBe(
      "invalid-fields"
    );
    expect(problem({ path: customer, fields: [["missing"]] })?.reason).toBe(
      "invalid-fields"
    );
  });

  test("accepts sort and limit only on lists", () => {
    const email = ["profile", "customer", "email"];

    expect(problem({ path: email, limit: 1 })?.reason).toBe("list-only");
    expect(
      problem({ path: email, sort: { path: [], direction: "asc" } })?.reason
    ).toBe("list-only");
  });

  test("sorts a list only by one of its scalar fields", () => {
    const fields = [["type"]];

    expect(
      problem({
        path: reservations,
        fields,
        sort: { path: ["status"], direction: "asc" },
      })?.reason
    ).toBe("invalid-sort");
    expect(
      problem({
        path: reservations,
        fields,
        sort: { path: ["status", "label"], direction: "asc" },
      })
    ).toBeUndefined();
  });

  test("checks the selection rules in order", () => {
    expect(
      problem({
        path: ["profile", "customer", "email"],
        fields: [["email"]],
        limit: 1,
      })?.reason
    ).toBe("invalid-fields");
    expect(
      problem({
        path: ["profile", "customer"],
        fields: [["email"]],
        sort: { path: ["missing"], direction: "asc" },
      })?.reason
    ).toBe("list-only");
  });
});
