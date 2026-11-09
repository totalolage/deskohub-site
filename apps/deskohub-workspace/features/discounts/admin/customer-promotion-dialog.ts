import { m } from "@/features/administration/i18n";
import type {
  DiscountCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { DiscountAdminMutation } from "./contracts";

/** The code or voucher whose audience a customer page edits. */
export type CustomerPromotionCode =
  | { readonly kind: "discount-code"; readonly id: DiscountCodeId }
  | { readonly kind: "voucher"; readonly id: VoucherId };

/** The audience mutations a customer page can run on one code or voucher. */
export const customerPromotionCodeMutations = (
  promotion: CustomerPromotionCode,
  customerId: DotyposCustomerId
) =>
  promotion.kind === "voucher"
    ? ({
        add: {
          kind: "add-voucher-customer",
          voucherId: promotion.id,
          customerId,
        },
        remove: {
          kind: "remove-voucher-customer",
          voucherId: promotion.id,
          customerId,
        },
        makeUnrestricted: {
          kind: "make-voucher-unrestricted",
          voucherId: promotion.id,
        },
        delete: { kind: "delete-voucher", id: promotion.id },
      } satisfies Record<string, DiscountAdminMutation>)
    : ({
        add: { kind: "add-code-customer", codeId: promotion.id, customerId },
        remove: {
          kind: "remove-code-customer",
          codeId: promotion.id,
          customerId,
        },
        makeUnrestricted: {
          kind: "make-code-unrestricted",
          codeId: promotion.id,
        },
        delete: { kind: "delete-code", id: promotion.id },
      } satisfies Record<string, DiscountAdminMutation>);

export type CustomerPromotionCodeMutations = ReturnType<
  typeof customerPromotionCodeMutations
>;

const discountCodeEligibilityCopy = {
  addLabel: m.discountsCodeAddCustomerLabel,
  removeLabel: m.discountsCodeRemoveCustomerLabel,
  limitTitle: m.discountsCodeLimitTitle,
  limitDescription: m.discountsCodeLimitDescription,
  removeOnlyCustomerDescription: m.discountsCodeRemoveOnlyCustomerDescription,
  removeDescription: m.discountsCodeRemoveCustomerDescription,
  addTitle: m.discountsCodeAddCustomerTitle,
  addDescription: m.discountsCodeAddCustomerDialogDescription,
  deleteLabel: m.discountsDeleteCode,
};

const voucherEligibilityCopy = {
  addLabel: m.discountsVoucherAddCustomerLabel,
  removeLabel: m.discountsVoucherRemoveCustomerLabel,
  limitTitle: m.discountsVoucherLimitTitle,
  limitDescription: m.discountsVoucherLimitDescription,
  removeOnlyCustomerDescription:
    m.discountsVoucherRemoveOnlyCustomerDescription,
  removeDescription: m.discountsVoucherRemoveCustomerDescription,
  addTitle: m.discountsVoucherAddCustomerTitle,
  addDescription: m.discountsVoucherAddCustomerDialogDescription,
  deleteLabel: m.discountsDeleteVoucher,
};

export type CustomerPromotionEligibilityCopy =
  typeof discountCodeEligibilityCopy;

export const customerPromotionEligibilityCopy = (
  kind: CustomerPromotionCode["kind"]
): CustomerPromotionEligibilityCopy =>
  kind === "voucher" ? voucherEligibilityCopy : discountCodeEligibilityCopy;

/**
 * What the eligibility dialog offers: removing the code's only customer,
 * removing one of several, adding the customer to an existing audience, or
 * limiting an unrestricted code to the customer.
 */
export type CustomerPromotionDialogMode =
  | "remove-only-customer"
  | "remove"
  | "add"
  | "limit";

export const customerPromotionDialogMode = (
  eligible: boolean,
  audienceSize: number
): CustomerPromotionDialogMode => {
  if (!eligible) return audienceSize > 0 ? "add" : "limit";
  return audienceSize === 1 ? "remove-only-customer" : "remove";
};

type DialogTextInput = {
  readonly audienceSize: number;
  readonly copy: CustomerPromotionEligibilityCopy;
  readonly locale: Locale;
  readonly names: { readonly code: string; readonly customerName: string };
};

const dialogTextByMode = {
  "remove-only-customer": ({ copy, locale, names }) => ({
    title: m.discountsRemoveOnlyCustomerTitle({}, { locale }),
    description: copy.removeOnlyCustomerDescription(names, { locale }),
  }),
  remove: ({ copy, locale, names }) => ({
    title: m.discountsRemoveCustomerTitle(
      { customerName: names.customerName },
      { locale }
    ),
    description: copy.removeDescription(names, { locale }),
  }),
  add: ({ audienceSize, copy, locale, names }) => ({
    title: copy.addTitle(names, { locale }),
    description: copy.addDescription(
      { ...names, count: audienceSize, total: audienceSize + 1 },
      { locale }
    ),
  }),
  limit: ({ copy, locale, names }) => ({
    title: copy.limitTitle(names, { locale }),
    description: copy.limitDescription(names, { locale }),
  }),
} satisfies Record<
  CustomerPromotionDialogMode,
  (input: DialogTextInput) => {
    readonly title: string;
    readonly description: string;
  }
>;

/** The eligibility dialog's title and description for its mode. */
export const customerPromotionDialogText = (
  mode: CustomerPromotionDialogMode,
  input: DialogTextInput
) => dialogTextByMode[mode](input);

/**
 * The cancel and confirm buttons of every mode except removing the only
 * customer, which instead offers deleting the code or opening it to everyone.
 */
export const customerPromotionDialogConfirmation = {
  remove: {
    cancelLabel: m.discountsCancel,
    confirmLabel: m.discountsRemoveCustomer,
    mutation: "remove",
  },
  add: {
    cancelLabel: m.discountsCancel,
    confirmLabel: m.discountsAddCustomer,
    mutation: "add",
  },
  limit: {
    cancelLabel: m.discountsKeepAvailableToAll,
    confirmLabel: m.discountsLimitToCustomer,
    mutation: "add",
  },
} as const;
