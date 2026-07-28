import { CustomersAdministrationPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminShellPageData,
} from "@/features/discounts/admin/page-data.server";

export const dynamic = "force-dynamic";

export default async function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { notice } = await loadDiscountAdminShellPageData(searchParams);

  return <CustomersAdministrationPage notice={notice} />;
}
