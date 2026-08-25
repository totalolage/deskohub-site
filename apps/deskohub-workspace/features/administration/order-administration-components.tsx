import { Match } from "effect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { AdministrationLink as Link } from "./admin-link";
import {
  AdministrationDetailSection,
  AdministrationFact,
} from "./detail-components";
import { EmptyState } from "./empty-state";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
} from "./formatters";
import { GoodsOrderWriteOff } from "./goods-order-writeoff";
import type {
  AdministrationOrderDetail,
  AdministrationOrderSummary,
} from "./order-administration.service";
import {
  AdministrationStatusBadge,
  type AdministrationStatusTone,
} from "./status-badge";
import { AdministrationTableFrame } from "./table-frame";

const stateLabel = (state: string) =>
  state
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

const stateTone = (state: string): AdministrationStatusTone => {
  if (state === "paid" || state === "fulfilled" || state === "issued") {
    return "positive";
  }
  if (state === "pending" || state === "processing" || state === "created") {
    return "progress";
  }
  if (["failed", "cancelled", "expired", "required"].includes(state)) {
    return "attention";
  }
  return "neutral";
};

const Status = ({ value }: { readonly value: string }) => (
  <AdministrationStatusBadge tone={stateTone(value)}>
    {stateLabel(value)}
  </AdministrationStatusBadge>
);

const optionalDate = (value: string | null) =>
  value ? formatAdministrationDateTime(value) : "Not recorded";

const productLabel = Match.type<
  AdministrationOrderDetail["lines"][number]["product"]
>().pipe(
  Match.discriminatorsExhaustive("kind")({
    cowork: ({ tier }) => `Cowork · ${tier}`,
    goods: ({ categoryId, productId }) =>
      `Goods · ${categoryId} · ${productId}`,
    "meeting-room": ({ duration }) =>
      `Meeting room · ${duration.amount} ${duration.unit}`,
    office: ({ dayCount, seats }) =>
      `Office · ${seats} seats · ${dayCount} days`,
  })
);

export function OrderAdministrationTable({
  orders,
}: {
  readonly orders: readonly AdministrationOrderSummary[];
}) {
  if (orders.length === 0) {
    return <EmptyState message="No Deskohub orders have been issued." />;
  }
  return (
    <AdministrationTableFrame className="overflow-x-auto">
      <Table aria-label="Deskohub orders" className="min-w-[900px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Order</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Fulfillment</TableHead>
            <TableHead>Invoice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <Link
                  className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                  href={`/admin/orders/${order.id}`}
                >
                  {order.id}
                </Link>
                <p className="mt-1 text-xs text-navy-blue/65">
                  {formatAdministrationDateTime(order.createdAt)}
                </p>
              </TableCell>
              <TableCell>{stateLabel(order.kind)}</TableCell>
              <TableCell className="font-medium">
                {order.total
                  ? formatAdministrationMoney(order.total)
                  : "Unavailable"}
              </TableCell>
              <TableCell>
                <Status value={order.paymentState} />
              </TableCell>
              <TableCell>
                <Status value={order.fulfillmentState} />
              </TableCell>
              <TableCell>
                <Status value={order.invoiceStatus} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdministrationTableFrame>
  );
}

export function OrderAdministrationDetail({
  detail,
}: {
  readonly detail: AdministrationOrderDetail;
}) {
  const { order } = detail;
  return (
    <div className="space-y-6">
      <AdministrationDetailSection title="Order facts">
        <dl className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <AdministrationFact label="Kind" value={stateLabel(order.kind)} />
          <AdministrationFact
            label="Customer ID"
            value={order.customerId}
            valueClassName="break-all font-mono text-xs"
          />
          <AdministrationFact
            label="Total"
            value={
              order.total
                ? formatAdministrationMoney(order.total)
                : "Unavailable"
            }
          />
          <AdministrationFact
            label="Invoice"
            value={<Status value={detail.invoice.status} />}
          />
          <AdministrationFact
            label="Payment"
            value={<Status value={order.paymentState} />}
          />
          <AdministrationFact
            label="Fulfillment"
            value={<Status value={order.fulfillmentState} />}
          />
          <AdministrationFact
            label="Created"
            value={formatAdministrationDateTime(order.createdAt)}
          />
          <AdministrationFact
            label="Updated"
            value={formatAdministrationDateTime(order.updatedAt)}
          />
          <AdministrationFact label="Paid" value={optionalDate(order.paidAt)} />
          <AdministrationFact
            label="Fulfilled"
            value={optionalDate(order.fulfilledAt)}
          />
          <AdministrationFact
            label="Fulfillment failed"
            value={optionalDate(order.fulfillmentFailedAt)}
          />
          <AdministrationFact
            label="Written off"
            value={optionalDate(order.writtenOffAt)}
          />
          <AdministrationFact
            label="Invoice issued"
            value={optionalDate(detail.invoice.issuedAt)}
          />
        </dl>
        {order.reservationId && (
          <Link
            className="mt-5 inline-flex font-semibold text-burned-orange-ink hover:underline"
            href={`/admin/reservations/${order.reservationId}`}
          >
            View linked reservation
          </Link>
        )}
        {order.kind === "goods" &&
          order.fulfillmentState === "fulfilled" &&
          order.paymentState !== "paid" &&
          !order.writtenOffAt &&
          !detail.paymentAttempts.some(
            ({ state }) => state === "created" || state === "pending"
          ) && <GoodsOrderWriteOff orderId={order.id} />}
      </AdministrationDetailSection>

      <section>
        <h2 className="mb-4 text-xl">Immutable lines</h2>
        <OrderLineTable detail={detail} />
      </section>

      <section>
        <h2 className="mb-4 text-xl">Payment attempts</h2>
        <OrderPaymentAttemptTable detail={detail} />
      </section>
    </div>
  );
}

function OrderLineTable({
  detail,
}: {
  readonly detail: AdministrationOrderDetail;
}) {
  if (detail.lines.length === 0) {
    return (
      <EmptyState message="Line totals are unavailable for this historical order." />
    );
  }
  return (
    <AdministrationTableFrame className="overflow-x-auto">
      <Table aria-label="Order lines" className="min-w-[920px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Line</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Unit price</TableHead>
            <TableHead>Before discounts</TableHead>
            <TableHead>Payable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell>
                <span className="font-medium">{line.description}</span>
                <span className="mt-1 block font-mono text-xs text-navy-blue/65">
                  #{line.sequence}
                </span>
              </TableCell>
              <TableCell className="text-sm">
                {productLabel(line.product)}
              </TableCell>
              <TableCell>{line.quantity}</TableCell>
              <TableCell>{formatAdministrationMoney(line.unitPrice)}</TableCell>
              <TableCell>
                {formatAdministrationMoney(line.undiscountedTotal)}
              </TableCell>
              <TableCell className="font-semibold">
                {formatAdministrationMoney(line.payableTotal)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdministrationTableFrame>
  );
}

function OrderPaymentAttemptTable({
  detail,
}: {
  readonly detail: AdministrationOrderDetail;
}) {
  if (detail.paymentAttempts.length === 0) {
    return (
      <EmptyState message="No payment attempts are linked to this order." />
    );
  }
  return (
    <AdministrationTableFrame className="overflow-x-auto">
      <Table aria-label="Order payment attempts" className="min-w-[760px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Attempt</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Refund</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.paymentAttempts.map((attempt) => (
            <TableRow key={attempt.id}>
              <TableCell>
                <span className="font-mono text-xs">{attempt.id}</span>
                <span className="mt-1 block text-xs text-navy-blue/65">
                  {formatAdministrationDateTime(attempt.createdAt)}
                </span>
              </TableCell>
              <TableCell>{stateLabel(attempt.provider)}</TableCell>
              <TableCell className="font-medium">
                {formatAdministrationMoney(attempt.amount)}
              </TableCell>
              <TableCell>
                <Status value={attempt.state} />
              </TableCell>
              <TableCell>
                <Status value={attempt.refundState} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdministrationTableFrame>
  );
}
