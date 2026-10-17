import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { actionRuntimeFailureMessages } from "@/shared/utils/action-runtime-failure";
import { getAccessCodeAdminActionFailureMessage } from "./action-failure-message";

describe("getAccessCodeAdminActionFailureMessage", () => {
  test("shows a timeout in the operator's language", () => {
    expect(
      getAccessCodeAdminActionFailureMessage(
        actionRuntimeFailureMessages.timeout,
        {
          fallback: m.accessCodesCreateFailed({}, { locale: "cs-CZ" }),
          locale: "cs-CZ",
        }
      )
    ).toBe("Server neodpověděl včas. Zkuste to znovu.");
  });

  test("shows an unexpected failure in the operator's language", () => {
    expect(
      getAccessCodeAdminActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.accessCodesCreateFailed({}, { locale: "en-US" }),
          locale: "en-US",
        }
      )
    ).toBe("Something went wrong on the server. Try again.");
  });

  test("keeps the action's localized message", () => {
    const message = m.accessCodesAuthenticationRequired(
      {},
      { locale: "cs-CZ" }
    );
    expect(
      getAccessCodeAdminActionFailureMessage(message, {
        fallback: m.accessCodesCreateFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(message);
  });

  test("uses the fallback without a server message", () => {
    expect(
      getAccessCodeAdminActionFailureMessage(undefined, {
        fallback: m.accessCodesCreateFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(m.accessCodesCreateFailed({}, { locale: "cs-CZ" }));
  });
});
