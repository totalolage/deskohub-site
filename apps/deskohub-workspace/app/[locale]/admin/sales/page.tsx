import {
  type DiscountAdminSearchParams,
  loadDiscountAdminSalesPageData,
} from "@/features/discounts/admin/page-data.server";
import { SalesAdministrationScreen } from "@/features/discounts/admin/screens";

export default function SalesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <SalesAdministrationScreen
      data={loadDiscountAdminSalesPageData(searchParams)}
    />
  );
}
