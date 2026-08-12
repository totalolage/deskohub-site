import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { CodesAdministrationPage } from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodesPageData,
} from "@/features/discounts/admin/page-data.server";

export default function DiscountCodesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <DiscountCodesAdminContent searchParams={searchParams} />
    </Suspense>
  );
}

export async function DiscountCodesAdminContent({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { dashboard, notice } =
    await loadDiscountAdminCodesPageData(searchParams);

  return <CodesAdministrationPage dashboard={dashboard} notice={notice} />;
}
