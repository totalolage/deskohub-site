import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { OrderAdministrationDetail } from "@/features/administration/order-administration-components";
import { loadAdministrationOrder } from "@/features/administration/page-data.server";

export default function OrderAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  return (
    <AdministrationPage>
      <Suspense
        fallback={<AdministrationDetailLoading label="order details" />}
      >
        <OrderDetail params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

async function OrderDetail({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  const { orderId } = await params;
  const detail = await loadAdministrationOrder(orderId);
  return (
    <>
      <AdministrationPageHeader
        description="Immutable order facts, payment lifecycle, and invoice status."
        eyebrow="Deskohub order"
        title={detail.order.id}
      />
      <OrderAdministrationDetail detail={detail} />
    </>
  );
}
