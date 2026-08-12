import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { SalesAdministrationPage } from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminSalesPageData,
} from "@/features/discounts/admin/page-data.server";

export default function SalesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <SalesAdminContent searchParams={searchParams} />
    </Suspense>
  );
}

export async function SalesAdminContent({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { dashboard, notice } =
    await loadDiscountAdminSalesPageData(searchParams);

  return <SalesAdministrationPage dashboard={dashboard} notice={notice} />;
}
