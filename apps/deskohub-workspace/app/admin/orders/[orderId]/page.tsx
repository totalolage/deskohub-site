import { redirect } from "next/navigation";

export default async function LegacyNexiOrderPage({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  const { orderId } = await params;
  redirect(`/admin/nexi/orders/${encodeURIComponent(orderId)}`);
}
