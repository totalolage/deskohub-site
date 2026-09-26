import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { NexiCorrelationId } from "@deskohub/nexi";
import type {
  OrderFulfillmentState,
  OrderId,
  OrderKind,
  OrderPaymentState,
} from "@/features/order";
import { type NewOrder, type Order, orders } from "./orders";

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// The order row carries branded domain identities, not bare strings.
type _OrderIdIsBranded = Expect<Equal<Order["id"], OrderId>>;
type _InsertIdIsBranded = Expect<Equal<NonNullable<NewOrder["id"]>, OrderId>>;
type _CorrelationIdIsBranded = Expect<
  Equal<Order["correlationId"], NexiCorrelationId>
>;
type _InsertCorrelationIdIsBranded = Expect<
  Equal<NonNullable<NewOrder["correlationId"]>, NexiCorrelationId>
>;
type _CustomerIdIsBranded = Expect<
  Equal<Order["dotyposCustomerId"], DotyposCustomerId>
>;

// Insert-time facts without defaults must be supplied by the caller. An
// optional column leaks `undefined` through the indexed access, so Equal
// against the bare domain type fails if the field stops being required.
type _KindIsRequired = Expect<Equal<NewOrder["kind"], OrderKind>>;
type _PaymentStateIsRequired = Expect<
  Equal<NewOrder["paymentState"], OrderPaymentState>
>;
type _FulfillmentStateIsRequired = Expect<
  Equal<NewOrder["fulfillmentState"], OrderFulfillmentState>
>;
type _CustomerIdIsRequired = Expect<
  Equal<NewOrder["dotyposCustomerId"], DotyposCustomerId>
>;

const validInsert: NewOrder = {
  kind: "reservation",
  correlationId: "0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f" as NexiCorrelationId,
  dotyposCustomerId: "12345" as DotyposCustomerId,
  paymentState: "paid",
  fulfillmentState: "processing",
};
void validInsert;

const validSelect: Order = {
  id: "0198c1a2-3b4c-7d5e-8f90-6f5e4d3c2b1a" as OrderId,
  kind: "reservation",
  correlationId: "0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f" as NexiCorrelationId,
  dotyposCustomerId: "12345" as DotyposCustomerId,
  paymentState: "paid",
  fulfillmentState: "fulfilled",
  activePaymentAttemptId: null,
  paidAt: Temporal.Instant.from("2026-09-26T10:00:00.000Z"),
  fulfilledAt: Temporal.Instant.from("2026-09-26T11:00:00.000Z"),
  fulfillmentFailedAt: null,
  fulfillmentFailureCode: null,
  createdAt: Temporal.Instant.from("2026-09-26T09:00:00.000Z"),
  updatedAt: Temporal.Instant.from("2026-09-26T11:00:00.000Z"),
};
void validSelect;

const invalidKind: NewOrder = {
  // @ts-expect-error only the reservation kind is a valid order kind
  kind: "goods",
  correlationId: "0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f" as NexiCorrelationId,
  dotyposCustomerId: "12345" as DotyposCustomerId,
  paymentState: "paid",
  fulfillmentState: "processing",
};
void invalidKind;

// Keep the table import live so the inferred types stay bound to the schema.
void orders;
