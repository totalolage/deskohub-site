import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodesPageData,
} from "@/features/discounts/admin/page-data.server";
import { DiscountCodesAdministrationScreen } from "@/features/discounts/admin/screens";

export default function DiscountCodesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <DiscountCodesAdministrationScreen
      data={loadDiscountAdminCodesPageData(searchParams)}
    />
  );
}
