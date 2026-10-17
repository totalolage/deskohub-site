import { AdministrationPageHeader } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerDiscountCodeCreationForm } from "@/features/discounts/admin/customer-code-creation";
import { formatDiscountAdminCustomerName } from "@/features/discounts/admin/customer-display-name";
import { loadDiscountAdminCustomerCodeCreationPageData } from "@/features/discounts/admin/page-data.server";
import { CustomerDiscountCodeCreationScreen } from "@/features/discounts/admin/screens";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function CustomerDiscountCodeCreationPage({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  return (
    <CustomerDiscountCodeCreationScreen>
      <CustomerDiscountCodeCreationContent params={params} />
    </CustomerDiscountCodeCreationScreen>
  );
}

async function CustomerDiscountCodeCreationContent({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const locale = await getRequestLocale();
  const { customerId } = await params;
  const { customer, discounts } =
    await loadDiscountAdminCustomerCodeCreationPageData(
      requireDotyposCustomerRouteId(customerId)
    );
  const customerName = formatDiscountAdminCustomerName(customer, locale);

  return (
    <>
      <AdministrationPageHeader
        description={m.discountsCustomerCodeCreateDescription({}, { locale })}
        eyebrow={m.discountsDiscountCodeEyebrow({}, { locale })}
        title={m.discountsCustomerCodeCreateTitle({ customerName }, { locale })}
      />
      <div className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
        <CustomerDiscountCodeCreationForm
          completion="customer"
          customerId={customer.id}
          customerName={customerName}
          discounts={discounts}
        />
      </div>
    </>
  );
}
