import { describe, expect, test } from "bun:test";
import { customerAccountIdSchema } from "../../customer-account";
import { getSavedCardCustomerReference } from "./saved-card-customer-reference";

describe("getSavedCardCustomerReference", () => {
  const accountId = customerAccountIdSchema.make(
    "0198c0de-0000-7000-8000-000000000001"
  );

  test("is deterministic for the same account", () => {
    expect(getSavedCardCustomerReference(accountId)).toEqual(
      getSavedCardCustomerReference(accountId)
    );
  });

  test("differs between accounts", () => {
    const other = customerAccountIdSchema.make(
      "0198c0de-0000-7000-8000-000000000002"
    );
    expect(getSavedCardCustomerReference(accountId)).not.toEqual(
      getSavedCardCustomerReference(other)
    );
  });

  test("is opaque, prefixed, lowercase hex, and within the provider bound", () => {
    const reference = getSavedCardCustomerReference(accountId);
    expect(reference).toMatch(/^dh[0-9a-f]+$/);
    expect(reference.length).toBeLessThanOrEqual(32);
    expect(reference).not.toContain(accountId);
  });

  test("does not embed the Dotypos customer identity", () => {
    const reference = getSavedCardCustomerReference(accountId);
    expect(reference).not.toContain("60111");
  });
});
