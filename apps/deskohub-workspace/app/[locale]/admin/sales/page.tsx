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
          <Suspense
            fallback={<AdministrationCountLoading label="Loading sale count" />}
          >
            <SalesCount data={data} />
          </Suspense>
        }
        label="sale table controls"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading columns={6} label="Loading sales" />
        }
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
  const count = (await data).dashboard.calendar.events.length;
  return (
    <AdministrationTableCount
      count={count}
      label={`${count} sale${count === 1 ? "" : "s"}`}
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
