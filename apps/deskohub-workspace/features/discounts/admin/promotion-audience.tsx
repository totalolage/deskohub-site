import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import { EmptyState } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { DiscountAdminMutation } from "./contracts";
import { AdminMutationButton } from "./customer-admin-client";
import { formatDiscountAdminCustomerContact } from "./customer-contact";
import { formatDiscountAdminCustomerName } from "./customer-display-name";
import type { AdminDiscountCodeDetail } from "./discount-administration.service";

type ConfirmedMutation = {
  readonly confirmation: string;
  readonly mutation: DiscountAdminMutation;
};

/**
 * The customers a code or voucher is limited to. Operators remove customers
 * one at a time down to the last one, which only opening the promotion to
 * everyone removes.
 */
export function PromotionAudienceSection({
  customers,
  locale,
  makeUnrestricted,
  removeCustomer,
  summary,
}: {
  readonly customers: AdminDiscountCodeDetail["customers"];
  readonly locale: Locale;
  readonly makeUnrestricted: ConfirmedMutation;
  /** Removes one customer, whom the confirmation names. */
  readonly removeCustomer: (
    customerId: DotyposCustomerId,
    customerName: string
  ) => ConfirmedMutation;
  readonly summary: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-blue/10 px-5 py-4">
        <div>
          <h2 className="font-semibold">
            {m.discountsColumnAudience({}, { locale })}
          </h2>
          <p className="mt-1 text-sm text-navy-blue/65">{summary}</p>
        </div>
        {customers.length > 0 && (
          <AdminMutationButton
            confirmation={makeUnrestricted.confirmation}
            mutation={makeUnrestricted.mutation}
          >
            {m.discountsMakeUnrestricted({}, { locale })}
          </AdminMutationButton>
        )}
      </div>
      {customers.length === 0 ? (
        <EmptyState message={m.discountsAudienceEmpty({}, { locale })} />
      ) : (
        <ul className="divide-y divide-navy-blue/10">
          {customers.map(({ customer, customerId }) => (
            <PromotionAudienceCustomer
              customer={customer}
              customerId={customerId}
              key={customerId}
              locale={locale}
              removeCustomer={customers.length > 1 ? removeCustomer : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PromotionAudienceCustomer({
  customer,
  customerId,
  locale,
  removeCustomer,
}: {
  readonly customer: AdminDiscountCodeDetail["customers"][number]["customer"];
  readonly customerId: DotyposCustomerId;
  readonly locale: Locale;
  /** Unset for the last customer, whom only opening the promotion removes. */
  readonly removeCustomer?: (
    customerId: DotyposCustomerId,
    customerName: string
  ) => ConfirmedMutation;
}) {
  const customerName = customer
    ? formatDiscountAdminCustomerName(customer, locale)
    : null;
  const removal = removeCustomer?.(customerId, customerName ?? customerId);
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div>
        <Link
          className="font-semibold underline decoration-navy-blue/25 underline-offset-4"
          href={administrationHref("/[locale]/admin/customers/[customerId]", {
            customerId,
          })}
        >
          {customerName ??
            m.discountsCustomerDetailsUnavailable({}, { locale })}
        </Link>
        <p className="mt-1 text-sm text-navy-blue/65">
          {customer
            ? formatDiscountAdminCustomerContact(customer, locale)
            : customerId}
        </p>
      </div>
      {removal ? (
        <AdminMutationButton
          confirmation={removal.confirmation}
          mutation={removal.mutation}
        >
          {m.discountsRemove({}, { locale })}
        </AdminMutationButton>
      ) : (
        <span className="text-xs text-navy-blue/65">
          {m.discountsUseMakeUnrestricted({}, { locale })}
        </span>
      )}
    </li>
  );
}
