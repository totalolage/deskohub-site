import { describe, expect, test } from "bun:test";
import {
  DiscountAdminAudienceError,
  DiscountAdminConflictError,
  DiscountAdminNotFoundError,
} from "./discount-administration.service";
import { getDiscountAdminMutationErrorMessage } from "./mutation-error-message";

describe("discount mutation error messages", () => {
  test("localizes conflicts from their reason, not the API message", () => {
    const conflict = new DiscountAdminConflictError({
      reason: "promotion-code-taken",
      message: "A promotion code with this value already exists.",
    });

    expect(getDiscountAdminMutationErrorMessage(conflict, "cs-CZ")).toBe(
      "Propagační kód s touto hodnotou už existuje."
    );
    expect(getDiscountAdminMutationErrorMessage(conflict, "en-US")).toBe(
      "A promotion code with this value already exists."
    );
  });

  test("names the missing resource and the guarded audience", () => {
    expect(
      getDiscountAdminMutationErrorMessage(
        new DiscountAdminNotFoundError({
          resource: {
            kind: "voucher audience membership",
            id: "dotypos-customer",
          },
          message: "This customer is no longer in the voucher audience.",
        }),
        "cs-CZ"
      )
    ).toBe("Tento zákazník už do okruhu zákazníků poukazu nepatří.");
    expect(
      getDiscountAdminMutationErrorMessage(
        new DiscountAdminAudienceError({
          promotionKind: "discount-code",
          message:
            "Removing the final customer would make this code unrestricted. Use Make unrestricted instead.",
        }),
        "cs-CZ"
      )
    ).toBe(
      "Odebráním posledního zákazníka by kód přestal být omezený. Použijte místo toho „Zrušit omezení“."
    );
  });

  test("falls back to a generic message for other failures", () => {
    expect(
      getDiscountAdminMutationErrorMessage(new Error("database down"), "cs-CZ")
    ).toBe(
      "Změnu se nepodařilo uložit. Zkontrolujte hodnoty a existující odkazy a zkuste to znovu."
    );
  });
});
