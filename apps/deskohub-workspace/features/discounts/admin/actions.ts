"use server";

import { Effect } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import { startCalendarDiscountSourceRefresh } from "./calendar-discount-source-maintenance.server";
import {
  type DiscountAdminCustomerSearch,
  type DiscountAdminMutation,
  discountAdminCustomerSearchStandardSchema,
  discountAdminMutationStandardSchema,
} from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";
import { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";
import { getDiscountAdminMutationErrorMessage } from "./mutation-error-message";

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.discountsActionTimedOut,
  unexpected: m.discountsActionFailedUnexpectedly,
};

const discountAdminMutationNotices = {
  "create-discount": m.discountsNoticeDiscountCreated,
  "update-discount": m.discountsNoticeDiscountUpdated,
  "delete-discount": m.discountsNoticeDiscountDeleted,
  "create-code": m.discountsNoticeCodeCreated,
  "create-customer-code": m.discountsNoticeCustomerCodeCreated,
  "update-code": m.discountsNoticeCodeUpdated,
  "delete-code": m.discountsNoticeCodeDeleted,
  "add-code-customer": m.discountsNoticeCodeCustomerAdded,
  "remove-code-customer": m.discountsNoticeCodeCustomerRemoved,
  "make-code-unrestricted": m.discountsNoticeCodeMadeUnrestricted,
  "create-voucher": m.discountsNoticeVoucherCreated,
  "create-customer-voucher": m.discountsNoticeCustomerVoucherCreated,
  "update-voucher": m.discountsNoticeVoucherUpdated,
  "delete-voucher": m.discountsNoticeVoucherDeleted,
  "add-voucher-customer": m.discountsNoticeVoucherCustomerAdded,
  "remove-voucher-customer": m.discountsNoticeVoucherCustomerRemoved,
  "make-voucher-unrestricted": m.discountsNoticeVoucherMadeUnrestricted,
  "set-customer-discount-group": m.discountsNoticeCustomerDiscountGroupUpdated,
} satisfies Record<
  DiscountAdminMutation["kind"],
  typeof m.discountsNoticeDiscountCreated
>;

const executeDiscountAdminActionMutation = Effect.fn(
  "DiscountAdministration.executeActionMutation"
)(function* (input: DiscountAdminMutation, locale: Locale) {
  const result = yield* executeDiscountAdminMutation(input);

  return {
    ...(result.createdDiscountId && {
      createdDiscountId: result.createdDiscountId,
    }),
    notice: discountAdminMutationNotices[input.kind]({}, { locale }),
  };
});

const getMutatedCustomerPaths = (input: DiscountAdminMutation) => {
  if (input.kind === "create-customer-code") {
    return [
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId: input.customerId,
      }),
    ];
  }
  if (input.kind === "create-customer-voucher") {
    return [
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId: input.voucher.customerId,
      }),
    ];
  }
  return [];
};

const discountAdminMutationAction = defineAdministrationAction(
  {
    operation: "discount-administration.mutate",
    failureCopy,
    schema: discountAdminMutationStandardSchema,
    capabilities: DiscountAdministration.Live,
    publicFailure: getDiscountAdminMutationErrorMessage,
    revalidates: getMutatedCustomerPaths,
    refreshes: startCalendarDiscountSourceRefresh,
  },
  (input, { locale }) => executeDiscountAdminActionMutation(input, locale)
);

export const mutateDiscountAdmin: typeof discountAdminMutationAction = async (
  ...args: Parameters<typeof discountAdminMutationAction>
) => {
  "use server";
  return await discountAdminMutationAction(...args);
};

const executeCustomerSearch = Effect.fn(
  "DiscountAdministration.executeCustomerSearch"
)(function* (input: DiscountAdminCustomerSearch) {
  const administration = yield* DiscountAdministration;
  return yield* administration.searchCustomers(input);
});

const discountAdminCustomerSearchAction = defineAdministrationAction(
  {
    operation: "discount-administration.search-customers",
    failureCopy,
    schema: discountAdminCustomerSearchStandardSchema,
    logInput: false,
    capabilities: DiscountAdministration.Live,
    publicFailure: (_, locale) =>
      m.discountsErrorCustomerSearchUnavailable({}, { locale }),
  },
  executeCustomerSearch
);

export const searchDiscountAdminCustomers: typeof discountAdminCustomerSearchAction =
  async (...args: Parameters<typeof discountAdminCustomerSearchAction>) => {
    "use server";
    return await discountAdminCustomerSearchAction(...args);
  };
