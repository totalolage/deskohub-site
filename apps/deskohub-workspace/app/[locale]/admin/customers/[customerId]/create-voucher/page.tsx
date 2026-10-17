import { AdministrationPageHeader } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { formatDiscountAdminCustomerName } from "@/features/discounts/admin/customer-display-name";
import { CustomerVoucherCreationForm } from "@/features/discounts/admin/customer-voucher-creation";
import { loadDiscountAdminCustomerVoucherCreationPageData } from "@/features/discounts/admin/page-data.server";
import { CustomerVoucherCreationScreen } from "@/features/discounts/admin/screens";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function CustomerVoucherCreationPage({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  return (
    <CustomerVoucherCreationScreen>
      <CustomerVoucherCreationContent params={params} />
    </CustomerVoucherCreationScreen>
  );
}

async function CustomerVoucherCreationContent({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const locale = await getRequestLocale();
  const { customerId } = await params;
  const { customer } = await loadDiscountAdminCustomerVoucherCreationPageData(
    requireDotyposCustomerRouteId(customerId)
  );
  const customerName = formatDiscountAdminCustomerName(customer, locale);

  return (
    <>
      <AdministrationPageHeader
        description={m.discountsCustomerVoucherCreateDescription(
          {},
          { locale }
        )}
        eyebrow={m.discountsVoucherEyebrow({}, { locale })}
        title={m.discountsCustomerVoucherCreateTitle(
          { customerName },
          { locale }
        )}
      />
      <div className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
        <CustomerVoucherCreationForm
          completion="customer"
          customer={{ displayName: customerName, id: customer.id }}
        />
      </div>
    </>
  );
}
