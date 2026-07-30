import { SalesAdministrationPage } from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminPageData,
} from "@/features/discounts/admin/page-data.server";

export const dynamic = "force-dynamic";

export default async function SalesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { dashboard, notice } = await loadDiscountAdminPageData(searchParams);

  return <SalesAdministrationPage dashboard={dashboard} notice={notice} />;
}
