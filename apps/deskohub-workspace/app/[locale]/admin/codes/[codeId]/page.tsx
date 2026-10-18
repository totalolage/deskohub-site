import { Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { CodeAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodePageData,
} from "@/features/discounts/admin/page-data.server";
import { discountCodeIdSchema } from "@/features/discounts/persistence-contracts";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function DiscountCodeAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly codeId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <DiscountCodeAdminDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

export async function DiscountCodeAdminDetail({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly codeId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const locale = await getRequestLocale();
  const { codeId } = await params;
  const decodedCodeId = Option.getOrElse(
    Schema.decodeUnknownOption(discountCodeIdSchema)(codeId),
    () => notFound()
  );
  const { detail, notice } = await loadDiscountAdminCodePageData(
    decodedCodeId,
    searchParams
  );

  return (
    <CodeAdministrationDetailPage
      detail={detail}
      locale={locale}
      notice={notice}
    />
  );
}
