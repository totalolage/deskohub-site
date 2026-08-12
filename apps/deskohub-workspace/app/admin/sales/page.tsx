import { Suspense } from "react";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import {
  SalesAdministrationActions,
  SalesAdministrationCollection,
} from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminSalesPageData,
} from "@/features/discounts/admin/page-data.server";

export default function SalesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const data = loadDiscountAdminSalesPageData(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Sales</h1>
      <Suspense fallback={null}>
        <SalesNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={<SalesAdministrationActions />}
        count={
          <Suspense fallback={<AdministrationCountLoading label="sale" />}>
            <SalesCount data={data} />
          </Suspense>
        }
        itemLabel="sale"
      />
      <Suspense
        fallback={<AdministrationCollectionLoading columns={5} label="sales" />}
      >
        <SalesCollection data={data} />
      </Suspense>
    </AdministrationPage>
  );
}

type SalesData = Awaited<ReturnType<typeof loadDiscountAdminSalesPageData>>;

async function SalesNotice({ data }: { readonly data: Promise<SalesData> }) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

async function SalesCount({ data }: { readonly data: Promise<SalesData> }) {
  return (
    <AdministrationTableCount
      count={(await data).dashboard.calendar.events.length}
      itemLabel="sale"
    />
  );
}

async function SalesCollection({
  data,
}: {
  readonly data: Promise<SalesData>;
}) {
  return <SalesAdministrationCollection dashboard={(await data).dashboard} />;
}
