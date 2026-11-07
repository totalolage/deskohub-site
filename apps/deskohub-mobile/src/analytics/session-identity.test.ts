import { expect, test } from "bun:test";
import { analyticsDistinctId } from "./identity";
import { analyticsIdentityOf } from "./session-identity";

const signedInAt = new Date(Date.UTC(2026, 10, 7, 12));

test("follows the session from restoring to signed in to signed out", () => {
  expect(analyticsIdentityOf({ status: "restoring" })).toEqual({
    kind: "pending",
  });
  expect(
    analyticsIdentityOf({
      status: "signed-in",
      user: { id: "acct-1", email: "ada@example.test" },
      signedInAt,
    })
  ).toEqual({ kind: "authenticated", accountId: "acct-1", testAccount: false });
  expect(analyticsIdentityOf({ status: "signed-out" })).toEqual({
    kind: "anonymous",
  });
});

test("marks the site's test recipients as test accounts", () => {
  expect(
    analyticsIdentityOf({
      status: "signed-in",
      user: { id: "acct-2", email: "qa@deskohub.test" },
      signedInAt,
    })
  ).toEqual({ kind: "authenticated", accountId: "acct-2", testAccount: true });
});

test("identifies as the workspace account the site uses", () => {
  expect(analyticsDistinctId("acct-1")).toBe("workspace-account:acct-1");
});
