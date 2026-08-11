import { Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { CodeAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodePageData,
} from "@/features/discounts/admin/page-data.server";
import { discountCodeIdSchema } from "@/features/discounts/persistence-contracts";

export default async function DiscountCodeAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly codeId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { codeId } = await params;
  const decodedCodeId = Option.getOrElse(
    Schema.decodeUnknownOption(discountCodeIdSchema)(codeId),
    () => notFound()
  );
  const { detail, notice } = await loadDiscountAdminCodePageData(
    decodedCodeId,
    searchParams
  );

  return <CodeAdministrationDetailPage detail={detail} notice={notice} />;
}
