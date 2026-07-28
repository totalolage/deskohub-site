import { CustomerAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCustomerPageData,
} from "@/features/discounts/admin/page-data.server";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export const dynamic = "force-dynamic";

export default async function DiscountCustomerAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { customerId } = await params;
  const { notice, profile } = await loadDiscountAdminCustomerPageData(
    customerId as DotyposCustomerId,
    searchParams
  );

  return <CustomerAdministrationDetailPage notice={notice} profile={profile} />;
}
