import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { actionRuntimeFailureMessages } from "@/shared/utils/action-runtime-failure";
import { getDiscountAdminActionFailureMessage } from "./action-failure-message";

describe("getDiscountAdminActionFailureMessage", () => {
  test("shows a timeout in the operator's language", () => {
    expect(
      getDiscountAdminActionFailureMessage(
        actionRuntimeFailureMessages.timeout,
        {
          fallback: m.discountsSaveFailedCheckForm({}, { locale: "cs-CZ" }),
          locale: "cs-CZ",
        }
      )
    ).toBe("Server neodpověděl včas. Zkuste to znovu.");
  });

  test("shows an unexpected failure in the operator's language", () => {
    expect(
      getDiscountAdminActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.discountsSaveFailedCheckForm({}, { locale: "en-US" }),
          locale: "en-US",
        }
      )
    ).toBe("Something went wrong on the server. Try again.");
  });

  test("keeps the action's localized message", () => {
    const message = m.discountsErrorPromotionCodeTaken({}, { locale: "cs-CZ" });
    expect(
      getDiscountAdminActionFailureMessage(message, {
        fallback: m.discountsSaveFailedCheckForm({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(message);
  });

  test("uses the fallback without a server message", () => {
    expect(
      getDiscountAdminActionFailureMessage(undefined, {
        fallback: m.discountsSaveFailedCheckForm({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(m.discountsSaveFailedCheckForm({}, { locale: "cs-CZ" }));
  });
});
