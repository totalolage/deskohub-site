import { Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { VoucherAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminVoucherPageData,
} from "@/features/discounts/admin/page-data.server";
import { voucherIdSchema } from "@/features/discounts/persistence-contracts";

export default function VoucherAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly voucherId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <VoucherAdminDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function VoucherAdminDetail({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly voucherId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { voucherId } = await params;
  const decodedVoucherId = Option.getOrElse(
    Schema.decodeUnknownOption(voucherIdSchema)(voucherId),
    () => notFound()
  );
  const { detail, notice } = await loadDiscountAdminVoucherPageData(
    decodedVoucherId,
    searchParams
  );
  return <VoucherAdministrationDetailPage detail={detail} notice={notice} />;
}
