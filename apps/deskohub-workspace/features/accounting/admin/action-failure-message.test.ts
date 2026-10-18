import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { actionRuntimeFailureMessages } from "@/shared/utils/action-runtime-failure";
import { getInvoiceAdminActionFailureMessage } from "./action-failure-message";

describe("getInvoiceAdminActionFailureMessage", () => {
  test("shows a timeout in the operator's language", () => {
    expect(
      getInvoiceAdminActionFailureMessage(
        actionRuntimeFailureMessages.timeout,
        {
          fallback: m.accountingInvoiceFormCreateError({}, { locale: "cs-CZ" }),
          locale: "cs-CZ",
        }
      )
    ).toBe("Server neodpověděl včas. Zkuste to znovu.");
  });

  test("shows an unexpected failure in the operator's language", () => {
    expect(
      getInvoiceAdminActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.accountingInvoiceFormCreateError({}, { locale: "en-US" }),
          locale: "en-US",
        }
      )
    ).toBe("Something went wrong on the server. Try again.");
  });

  test("keeps the action's localized message", () => {
    const message = m.accountingInvoiceCreateFailed({}, { locale: "cs-CZ" });
    expect(
      getInvoiceAdminActionFailureMessage(message, {
        fallback: m.accountingInvoiceFormCreateError({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(message);
  });

  test("uses the fallback without a server message", () => {
    expect(
      getInvoiceAdminActionFailureMessage(undefined, {
        fallback: m.accountingInvoiceFormCreateError({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(m.accountingInvoiceFormCreateError({}, { locale: "cs-CZ" }));
  });
});
