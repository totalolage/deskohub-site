import { expect, test } from "bun:test";
import { webSignInFailureReason } from "./web-sign-in-failure";

test("maps each operation's Better Auth errors to a reason", () => {
  const cases: ReadonlyArray<
    readonly [
      Parameters<typeof webSignInFailureReason>[0],
      { readonly status?: number; readonly code?: string },
      ReturnType<typeof webSignInFailureReason>,
    ]
  > = [
    ["send-email", { status: 403, code: "BOT_DETECTED" }, "automated"],
    [
      "send-email",
      { status: 429, code: "SIGN_IN_EMAIL_LIMIT_REACHED" },
      "address-limit",
    ],
    ["send-email", { status: 429 }, "rate-limited"],
    ["send-email", { status: 400, code: "INVALID_EMAIL" }, "failed"],
    ["verify-code", { status: 403, code: "BOT_DETECTED" }, "automated"],
    ["verify-code", { status: 400, code: "INVALID_OTP" }, "wrong-code"],
    ["verify-code", { status: 400, code: "OTP_EXPIRED" }, "expired-code"],
    [
      "verify-code",
      { status: 403, code: "TOO_MANY_ATTEMPTS" },
      "too-many-attempts",
    ],
    ["verify-code", { status: 429 }, "rate-limited"],
    ["verify-link", { status: 400, code: "INVALID_TOKEN" }, "link-rejected"],
    ["verify-link", { status: 500 }, "failed"],
    [
      "verify-link",
      { status: 403, code: "ACCOUNT_SWITCH_REFUSED" },
      "account-switch",
    ],
    ["verify-link", { status: 403 }, "failed"],
    [
      "mint-handoff",
      { status: 403, code: "SESSION_NOT_FRESH" },
      "session-not-fresh",
    ],
    ["mint-handoff", { status: 401, code: "UNAUTHORIZED" }, "signed-out"],
    ["mint-handoff", { status: 429 }, "rate-limited"],
    ["mint-handoff", { status: 400, code: "INVALID_RETURN_URI" }, "failed"],
  ];
  for (const [operation, error, reason] of cases) {
    expect([
      operation,
      error,
      webSignInFailureReason(operation, error),
    ]).toEqual([operation, error, reason]);
  }
});
