import { CodeAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodePageData,
} from "@/features/discounts/admin/page-data.server";
import type { DiscountCodeId } from "@/features/discounts/persistence-contracts";

export const dynamic = "force-dynamic";

export default async function DiscountCodeAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly codeId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { codeId } = await params;
  const { detail, notice } = await loadDiscountAdminCodePageData(
    codeId as DiscountCodeId,
    searchParams
  );

  return <CodeAdministrationDetailPage detail={detail} notice={notice} />;
}
