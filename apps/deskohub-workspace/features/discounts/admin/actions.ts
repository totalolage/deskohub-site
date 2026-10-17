"use server";

import { Effect } from "effect";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { refreshCalendarDiscountSourceAfterMutation } from "./calendar-discount-source-maintenance.server";
import {
  type DiscountAdminCustomerSearch,
  type DiscountAdminMutation,
  discountAdminCustomerSearchStandardSchema,
  discountAdminMutationStandardSchema,
} from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";
import { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";
import { getDiscountAdminMutationErrorMessage } from "./mutation-error-message";

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
  yield* refreshCalendarDiscountSourceAfterMutation(input);

  return {
    ...(result.createdDiscountId && {
      createdDiscountId: result.createdDiscountId,
    }),
    notice: discountAdminMutationNotices[input.kind]({}, { locale }),
  };
});

const discountAdminMutationAction = defineWorkspaceAction(
  {
    operation: "discount-administration.mutate",
    schema: discountAdminMutationStandardSchema,
  },
  (input, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(executeDiscountAdminActionMutation(input, locale)),
      Effect.provide(DiscountAdministration.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: getDiscountAdminMutationErrorMessage(cause, locale),
            cause,
          })
      )
    )
);

const executeCustomerSearch = Effect.fn(
  "DiscountAdministration.executeCustomerSearch"
)(function* (input: DiscountAdminCustomerSearch) {
  const administration = yield* DiscountAdministration;
  return yield* administration.searchCustomers(input);
});

const discountAdminCustomerSearchAction = defineWorkspaceAction(
  {
    operation: "discount-administration.search-customers",
    schema: discountAdminCustomerSearchStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(executeCustomerSearch(input)),
      Effect.provide(DiscountAdministration.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: m.discountsErrorCustomerSearchUnavailable({}, { locale }),
            cause,
          })
      )
    )
);

const getMutatedCustomerPath = (
  input: Parameters<typeof discountAdminMutationAction>[0]
) => {
  if (input.kind === "create-customer-code") {
    return `/admin/customers/${input.customerId}`;
  }
  if (input.kind === "create-customer-voucher") {
    return `/admin/customers/${input.voucher.customerId}`;
  }
  return null;
};

export const mutateDiscountAdmin: typeof discountAdminMutationAction = async (
  ...args: Parameters<typeof discountAdminMutationAction>
) => {
  "use server";
  const result = await discountAdminMutationAction(...args);
  // Revalidate here rather than inside the Effect: a fiber resumed by a
  // database callback can run under another request's Next.js work store,
  // where revalidatePath throws because that request is rendering.
  const customerPath = result?.data ? getMutatedCustomerPath(args[0]) : null;
  if (customerPath) revalidateLocalizedPath(customerPath);
  return result;
};

export const searchDiscountAdminCustomers: typeof discountAdminCustomerSearchAction =
  async (...args: Parameters<typeof discountAdminCustomerSearchAction>) => {
    "use server";
    return await discountAdminCustomerSearchAction(...args);
  };
