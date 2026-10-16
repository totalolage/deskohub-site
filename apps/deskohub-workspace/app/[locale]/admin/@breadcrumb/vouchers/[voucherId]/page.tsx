import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function VoucherBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly voucherId: string }>;
}) {
  const { voucherId } = await params;
  return <AdministrationBreadcrumb segments={["vouchers", voucherId]} />;
}
