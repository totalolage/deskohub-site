import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type {
  DiscountCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import {
  customerPromotionCodeMutations,
  customerPromotionDialogConfirmation,
  customerPromotionDialogMode,
  customerPromotionDialogText,
  customerPromotionEligibilityCopy,
} from "./customer-promotion-dialog";

const locale = "en-US";
const customerId = "dotypos-customer" as DotyposCustomerId;
const names = { code: "SUMMER10", customerName: "Test Customer" };

describe("customer promotion dialog", () => {
  test("picks the dialog from the customer's eligibility and the audience size", () => {
    expect(customerPromotionDialogMode(true, 1)).toBe("remove-only-customer");
    expect(customerPromotionDialogMode(true, 2)).toBe("remove");
    expect(customerPromotionDialogMode(false, 3)).toBe("add");
    expect(customerPromotionDialogMode(false, 0)).toBe("limit");
  });

  test("builds each audience mutation for the promotion's kind", () => {
    const codeId = "code-id" as DiscountCodeId;
    expect(
      customerPromotionCodeMutations(
        { kind: "discount-code", id: codeId },
        customerId
      )
    ).toEqual({
      add: { kind: "add-code-customer", codeId, customerId },
      remove: { kind: "remove-code-customer", codeId, customerId },
      makeUnrestricted: { kind: "make-code-unrestricted", codeId },
      delete: { kind: "delete-code", id: codeId },
    });

    const voucherId = "voucher-id" as VoucherId;
    expect(
      customerPromotionCodeMutations(
        { kind: "voucher", id: voucherId },
        customerId
      )
    ).toEqual({
      add: { kind: "add-voucher-customer", voucherId, customerId },
      remove: { kind: "remove-voucher-customer", voucherId, customerId },
      makeUnrestricted: { kind: "make-voucher-unrestricted", voucherId },
      delete: { kind: "delete-voucher", id: voucherId },
    });
  });

  test("uses the voucher or discount code wording for the promotion's kind", () => {
    expect(customerPromotionEligibilityCopy("voucher").deleteLabel).toBe(
      m.discountsDeleteVoucher
    );
    expect(customerPromotionEligibilityCopy("discount-code").deleteLabel).toBe(
      m.discountsDeleteCode
    );
  });

  test("titles and describes each dialog from the promotion and customer", () => {
    const copy = customerPromotionEligibilityCopy("voucher");
    const input = { audienceSize: 2, copy, locale, names } as const;

    expect(customerPromotionDialogText("remove-only-customer", input)).toEqual({
      title: m.discountsRemoveOnlyCustomerTitle({}, { locale }),
      description: copy.removeOnlyCustomerDescription(names, { locale }),
    });
    expect(customerPromotionDialogText("remove", input)).toEqual({
      title: m.discountsRemoveCustomerTitle(
        { customerName: names.customerName },
        { locale }
      ),
      description: copy.removeDescription(names, { locale }),
    });
    expect(customerPromotionDialogText("add", input)).toEqual({
      title: copy.addTitle(names, { locale }),
      description: copy.addDescription(
        { ...names, count: 2, total: 3 },
        { locale }
      ),
    });
    expect(customerPromotionDialogText("limit", input)).toEqual({
      title: copy.limitTitle(names, { locale }),
      description: copy.limitDescription(names, { locale }),
    });
  });

  test("confirms removals with the remove mutation and every addition with the add mutation", () => {
    expect(customerPromotionDialogConfirmation.remove.mutation).toBe("remove");
    expect(customerPromotionDialogConfirmation.add.mutation).toBe("add");
    expect(customerPromotionDialogConfirmation.limit.mutation).toBe("add");
    expect(customerPromotionDialogConfirmation.limit.cancelLabel).toBe(
      m.discountsKeepAvailableToAll
    );
  });
});
