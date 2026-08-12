import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerDiscountCodeCreationForm } from "@/features/discounts/admin/customer-code-creation";
import { loadDiscountAdminCustomerCodeCreationPageData } from "@/features/discounts/admin/page-data.server";

export default function CustomerDiscountCodeCreationPage({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  return (
    <AdministrationPage>
      <Suspense
        fallback={<AdministrationDetailLoading label="discount code form" />}
      >
        <CustomerDiscountCodeCreationContent params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CustomerDiscountCodeCreationContent({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const { customerId } = await params;
  const { customer, discounts } =
    await loadDiscountAdminCustomerCodeCreationPageData(
      requireDotyposCustomerRouteId(customerId)
    );

  return (
    <>
      <AdministrationPageHeader
        description="Create a code restricted to this customer and choose the discount it applies."
        eyebrow="Discount code"
        title={`Create a code for ${customer.displayName}`}
      />
      <div className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
        <CustomerDiscountCodeCreationForm
          completion="customer"
          customerId={customer.id}
          customerName={customer.displayName}
          discounts={discounts}
        />
      </div>
    </>
  );
}
