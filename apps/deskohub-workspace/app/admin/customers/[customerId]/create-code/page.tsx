import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { CustomerDiscountCodeCreationForm } from "@/features/discounts/admin/customer-code-creation";
import { loadDiscountAdminCustomerCodeCreationPageData } from "@/features/discounts/admin/page-data.server";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export default async function CustomerDiscountCodeCreationPage({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const { customerId } = await params;
  const { customer, discounts } =
    await loadDiscountAdminCustomerCodeCreationPageData(
      customerId as DotyposCustomerId
    );

  return (
    <AdministrationPage>
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
    </AdministrationPage>
  );
}
