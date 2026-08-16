import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function OrderBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  const { orderId } = await params;
  return <AdministrationBreadcrumb segments={["nexi", "orders", orderId]} />;
}
