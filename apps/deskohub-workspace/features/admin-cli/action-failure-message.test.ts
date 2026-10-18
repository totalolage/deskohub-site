import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { actionRuntimeFailureMessages } from "@/shared/utils/action-runtime-failure";
import { getAdminCliActionFailureMessage } from "./action-failure-message";

describe("getAdminCliActionFailureMessage", () => {
  test("shows a timeout in the operator's language", () => {
    expect(
      getAdminCliActionFailureMessage(actionRuntimeFailureMessages.timeout, {
        fallback: m.adminCliRenameFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe("Server neodpověděl včas. Zkuste to znovu.");
  });

  test("shows an unexpected failure in the operator's language", () => {
    expect(
      getAdminCliActionFailureMessage(actionRuntimeFailureMessages.unexpected, {
        fallback: m.adminCliRenameFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe("Na serveru se něco pokazilo. Zkuste to znovu.");
    expect(
      getAdminCliActionFailureMessage(actionRuntimeFailureMessages.unexpected, {
        fallback: m.adminCliRenameFailed({}, { locale: "en-US" }),
        locale: "en-US",
      })
    ).toBe("Something went wrong on the server. Try again.");
  });

  test("keeps the action's localized message", () => {
    const message = m.adminCliSessionsUnchangedNotice({}, { locale: "cs-CZ" });
    expect(
      getAdminCliActionFailureMessage(message, {
        fallback: m.adminCliRenameFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(message);
  });

  test("uses the fallback without a server message", () => {
    expect(
      getAdminCliActionFailureMessage(undefined, {
        fallback: m.adminCliRenameFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(m.adminCliRenameFailed({}, { locale: "cs-CZ" }));
  });
});
