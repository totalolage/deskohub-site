import {
  type DiscountAdminSearchParams,
  loadDiscountAdminVouchersPageData,
} from "@/features/discounts/admin/page-data.server";
import { VouchersAdministrationScreen } from "@/features/discounts/admin/screens";

export default function VouchersAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <VouchersAdministrationScreen
      data={loadDiscountAdminVouchersPageData(searchParams)}
    />
  );
}
