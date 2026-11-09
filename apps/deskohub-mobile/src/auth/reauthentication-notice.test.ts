import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { NotSignedIn, SignInCancelled } from "./native-sign-in-errors";
import { reauthenticationNotice } from "./reauthentication-notice";

const user = { id: "user-ada", email: testEmailAddress("ada") };
const cancelled = new SignInCancelled();

describe("reauthenticationNotice", () => {
  test("shows nothing before a reauthentication", () => {
    expect(reauthenticationNotice({ status: "idle" }, undefined)).toBe(
      undefined
    );
  });

  test("shows a running reauthentication, whatever came before", () => {
    for (const outcome of [undefined, "reauthenticated", "failed"] as const) {
      expect(reauthenticationNotice({ status: "running" }, outcome)).toEqual({
        kind: "confirming",
      });
    }
  });

  test("asks for the action again once the customer is confirmed", () => {
    expect(
      reauthenticationNotice(
        { status: "succeeded", value: user },
        "reauthenticated"
      )
    ).toEqual({ kind: "confirmed" });
  });

  test("shows why a reauthentication failed", () => {
    expect(
      reauthenticationNotice({ status: "failed", failure: cancelled }, "failed")
    ).toEqual({ kind: "failed", failure: cancelled });
    const notSignedIn = new NotSignedIn();
    expect(
      reauthenticationNotice(
        { status: "failed", failure: notSignedIn },
        "failed"
      )
    ).toEqual({ kind: "failed", failure: notSignedIn });
  });

  test("drops a notice the caller cleared after the action was repeated", () => {
    expect(
      reauthenticationNotice({ status: "succeeded", value: user }, undefined)
    ).toBe(undefined);
    expect(
      reauthenticationNotice(
        { status: "failed", failure: cancelled },
        undefined
      )
    ).toBe(undefined);
  });

  test("adds nothing for a busy or redirected reauthentication", () => {
    expect(reauthenticationNotice({ status: "idle" }, "redirected")).toBe(
      undefined
    );
    expect(
      reauthenticationNotice({ status: "failed", failure: cancelled }, "busy")
    ).toBe(undefined);
  });
});
