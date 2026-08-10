import { CodesAdministrationPage } from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminPageData,
} from "@/features/discounts/admin/page-data.server";

export default async function DiscountCodesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { dashboard, notice } = await loadDiscountAdminPageData(searchParams);

  return <CodesAdministrationPage dashboard={dashboard} notice={notice} />;
}
