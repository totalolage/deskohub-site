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
  VouchersAdministrationActions,
  VouchersAdministrationCollection,
} from "@/features/discounts/admin/components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminVouchersPageData,
} from "@/features/discounts/admin/page-data.server";

export default function VouchersAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const data = loadDiscountAdminVouchersPageData(searchParams);
  return (
    <AdministrationPage>
      <h1 className="sr-only">Promotional vouchers</h1>
      <Suspense fallback={null}>
        <VouchersNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={
          <Suspense
            fallback={
              <AdministrationActionLoading label="Loading voucher action" />
            }
          >
            <VouchersActions />
          </Suspense>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading label="Loading voucher count" />
            }
          >
            <VouchersCount data={data} />
          </Suspense>
        }
        label="voucher table controls"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={6}
            label="Loading vouchers"
          />
        }
      >
        <VouchersCollection data={data} />
      </Suspense>
    </AdministrationPage>
  );
}

type VouchersData = Awaited<
  ReturnType<typeof loadDiscountAdminVouchersPageData>
>;

async function VouchersNotice({
  data,
}: {
  readonly data: Promise<VouchersData>;
}) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

function VouchersActions() {
  return <VouchersAdministrationActions />;
}

async function VouchersCount({
  data,
}: {
  readonly data: Promise<VouchersData>;
}) {
  const count = (await data).dashboard.vouchers.length;
  return (
    <AdministrationTableCount
      count={count}
      label={`${count} voucher${count === 1 ? "" : "s"}`}
    />
  );
}

async function VouchersCollection({
  data,
}: {
  readonly data: Promise<VouchersData>;
}) {
  return (
    <VouchersAdministrationCollection dashboard={(await data).dashboard} />
  );
}
