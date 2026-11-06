"use client";

import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  type AdministrationHref,
  administrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import {
  CustomerPromotionCodeAction,
  CustomerSearch,
} from "./customer-admin-client";
import { formatDiscountAdminCustomerName } from "./customer-display-name";
import type { CustomerPromotionCode } from "./customer-promotion-dialog";

/**
 * Finds Dotypos customers and adds each one to a code or voucher, or removes
 * them from it. The confirmation explains how the change moves the audience,
 * including limiting an unrestricted promotion and removing its last customer.
 */
export function PromotionCustomerPicker({
  audienceCustomerIds,
  code,
  deleteRedirect,
  promotion,
}: {
  readonly audienceCustomerIds: readonly DotyposCustomerId[];
  readonly code: string;
  /** Where to go if removing the last customer deletes the promotion. */
  readonly deleteRedirect?: AdministrationHref;
  readonly promotion: CustomerPromotionCode;
}) {
  const locale = useRouteLocale();
  return (
    <CustomerSearch
      renderCustomerAction={(customer) => {
        const eligible = audienceCustomerIds.includes(customer.id);
        return (
          <div className="flex flex-wrap items-center gap-2">
            {eligible && (
              <StatusBadge tone="positive">
                {m.discountsCustomerInAudience({}, { locale })}
              </StatusBadge>
            )}
            <CustomerPromotionCodeAction
              audienceSize={audienceCustomerIds.length}
              code={code}
              customerId={customer.id}
              customerName={formatDiscountAdminCustomerName(customer, locale)}
              deleteRedirect={deleteRedirect}
              eligible={eligible}
              labeled
              promotion={promotion}
            />
          </div>
        );
      }}
      variant="inline"
    />
  );
}

/**
 * The customers part of a code or voucher row on the list pages: who may use
 * the promotion, a way to add or remove customers in place, and the detail
 * page that lists every customer.
 */
export function PromotionCustomersPanel({
  audienceCustomerIds,
  code,
  promotion,
}: {
  readonly audienceCustomerIds: readonly DotyposCustomerId[];
  readonly code: string;
  readonly promotion: CustomerPromotionCode;
}) {
  const locale = useRouteLocale();
  const count = audienceCustomerIds.length;
  const copy = {
    "discount-code": {
      unrestricted: m.discountsCodeAudienceUnrestricted,
      count: m.discountsCodeAudienceCount,
      addDescription: m.discountsCodeAddCustomerDescription,
    },
    voucher: {
      unrestricted: m.discountsVoucherAudienceUnrestricted,
      count: m.discountsVoucherAudienceCount,
      addDescription: m.discountsVoucherAddCustomerDescription,
    },
  }[promotion.kind];
  const detailHref =
    promotion.kind === "voucher"
      ? administrationHref("/[locale]/admin/vouchers/[voucherId]", {
          voucherId: promotion.id,
        })
      : administrationHref("/[locale]/admin/codes/[codeId]", {
          codeId: promotion.id,
        });
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {m.discountsColumnAudience({}, { locale })}
          </h3>
          <p className="mt-1 text-sm text-navy-blue/65">
            {count === 0
              ? copy.unrestricted({}, { locale })
              : copy.count({ count }, { locale })}
          </p>
          {count === 0 && (
            <p className="mt-1 text-sm text-navy-blue/65">
              {copy.addDescription({}, { locale })}
            </p>
          )}
        </div>
        {count > 0 && (
          <Link
            className="text-sm font-semibold underline underline-offset-4"
            href={detailHref}
          >
            {m.discountsShowAudienceCustomers({}, { locale })}
          </Link>
        )}
      </div>
      <PromotionCustomerPicker
        audienceCustomerIds={audienceCustomerIds}
        code={code}
        promotion={promotion}
      />
    </section>
  );
}
