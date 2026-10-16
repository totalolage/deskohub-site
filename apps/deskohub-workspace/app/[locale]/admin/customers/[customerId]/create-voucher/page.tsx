import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerVoucherCreationForm } from "@/features/discounts/admin/customer-voucher-creation";
import { loadDiscountAdminCustomerVoucherCreationPageData } from "@/features/discounts/admin/page-data.server";

export default function CustomerVoucherCreationPage({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  return (
    <AdministrationPage>
      <Suspense fallback={<AdministrationDetailLoading label="voucher form" />}>
        <CustomerVoucherCreationContent params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CustomerVoucherCreationContent({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const { customerId } = await params;
  const { customer } = await loadDiscountAdminCustomerVoucherCreationPageData(
    requireDotyposCustomerRouteId(customerId)
  );

  return (
    <>
      <AdministrationPageHeader
        description="Issue promotional credit that only this customer can spend."
        eyebrow="Voucher"
        title={`Create a voucher for ${customer.displayName}`}
      />
      <div className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
        <CustomerVoucherCreationForm
          completion="customer"
          customer={{ displayName: customer.displayName, id: customer.id }}
        />
      </div>
    </>
  );
}
