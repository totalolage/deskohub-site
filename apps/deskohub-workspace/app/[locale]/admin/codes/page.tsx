import { Suspense } from "react";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import {
  AdministrationActionLoading,
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import {
  CodesAdministrationActions,
  CodesAdministrationCollection,
} from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodesPageData,
} from "@/features/discounts/admin/page-data.server";

export default function DiscountCodesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const data = loadDiscountAdminCodesPageData(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Codes</h1>
      <Suspense fallback={null}>
        <CodesNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={
          <Suspense
            fallback={
              <AdministrationActionLoading label="Loading code action" />
            }
          >
            <CodesActions data={data} />
          </Suspense>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading label="Loading discount code count" />
            }
          >
            <CodesCount data={data} />
          </Suspense>
        }
        label="discount code table controls"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={6}
            label="Loading discount codes"
          />
        }
      >
        <CodesCollection data={data} />
      </Suspense>
    </AdministrationPage>
  );
}

type CodesData = Awaited<ReturnType<typeof loadDiscountAdminCodesPageData>>;

async function CodesNotice({ data }: { readonly data: Promise<CodesData> }) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

async function CodesActions({ data }: { readonly data: Promise<CodesData> }) {
  return <CodesAdministrationActions dashboard={(await data).dashboard} />;
}

async function CodesCount({ data }: { readonly data: Promise<CodesData> }) {
  const count = (await data).dashboard.codes.length;
  return (
    <AdministrationTableCount
      count={count}
      label={`${count} discount code${count === 1 ? "" : "s"}`}
    />
  );
}

async function CodesCollection({
  data,
}: {
  readonly data: Promise<CodesData>;
}) {
  return <CodesAdministrationCollection dashboard={(await data).dashboard} />;
}
