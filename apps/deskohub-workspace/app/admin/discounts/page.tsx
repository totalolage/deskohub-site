import { DiscountsAdministrationPage } from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminPageData,
} from "@/features/discounts/admin/page-data.server";

export const dynamic = "force-dynamic";

type DiscountAdminPageProps = {
  readonly searchParams: DiscountAdminSearchParams;
};

export default async function DiscountAdminPage({
  searchParams,
}: DiscountAdminPageProps) {
  const { dashboard, notice } = await loadDiscountAdminPageData(searchParams);

  return <DiscountsAdministrationPage dashboard={dashboard} notice={notice} />;
}
