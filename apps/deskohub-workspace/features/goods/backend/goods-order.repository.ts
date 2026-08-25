import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type NexiCorrelationId,
  NexiCorrelationIdSchema,
} from "@deskohub/nexi";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  discountApplications,
  goodsCartItems,
  goodsCarts,
  legalEvidenceEvents,
  type OrderRow,
  orderLines,
  orders,
} from "@/db/schema";
import {
  type LegalEvidenceEventInputError,
  persistLegalEvidenceEvents,
} from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { GoodsBasketDiscountCommitment } from "@/features/discounts";
import {
  type OrderDiscountEvidenceStateError,
  persistIssuedGoodsDiscountEvidence,
} from "@/features/discounts/backend/order-discount-evidence";
import type { DiscountClaimError } from "@/features/discounts/errors";
import type { OrderId } from "@/features/order";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import {
  emptyGoodsCart,
  type GoodsCart,
  type GoodsCartId,
  type GoodsCartRevision,
} from "../goods-cart";
import {
  type GoodsOrderDetail,
  type GoodsOrderIssuanceFacts,
  type GoodsOrderIssuanceId,
  type GoodsOrderLine,
  type GoodsOrderSummary,
  goodsOrderDetailSchema,
  goodsOrderIssueLegalEvidenceSource,
} from "../goods-order";
import { workspaceGoodsProductIdentitySchema } from "../goods-product";

export class GoodsOrderCartChangedError extends Data.TaggedError(
  "GoodsOrderCartChangedError"
)<{ readonly current: GoodsCart }> {}

export class GoodsOrderIssuanceConflictError extends Data.TaggedError(
  "GoodsOrderIssuanceConflictError"
)<{ readonly message: string }> {}

export class GoodsOrderNotFoundError extends Data.TaggedError(
  "GoodsOrderNotFoundError"
)<{ readonly orderId: OrderId }> {}

export class GoodsOrderStoredDataError extends Data.TaggedError(
  "GoodsOrderStoredDataError"
)<{ readonly message: string; readonly cause?: unknown }> {}

type GoodsOrderRepositoryError =
  | EffectDrizzleQueryError
  | SqlError
  | GoodsOrderCartChangedError
  | GoodsOrderIssuanceConflictError
  | GoodsOrderNotFoundError
  | GoodsOrderStoredDataError
  | DiscountClaimError
  | OrderDiscountEvidenceStateError
  | LegalEvidenceEventInputError;

export type IssueGoodsOrderRepositoryInput = GoodsOrderIssuanceFacts & {
  readonly customerId: DotyposCustomerId;
  readonly issuedAt: Temporal.Instant;
  readonly issuanceFingerprint: string;
  readonly discountCommitment?: GoodsBasketDiscountCommitment;
};

export interface IGoodsOrderRepository {
  readonly issue: (
    input: IssueGoodsOrderRepositoryInput
  ) => Effect.Effect<GoodsOrderDetail, GoodsOrderRepositoryError>;
  readonly list: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<readonly GoodsOrderSummary[], GoodsOrderRepositoryError>;
  readonly findByIssuanceId: (
    customerId: DotyposCustomerId,
    issuanceId: GoodsOrderIssuanceId,
    issuanceFingerprint: string
  ) => Effect.Effect<
    Option.Option<GoodsOrderDetail>,
    GoodsOrderRepositoryError
  >;
  readonly get: (
    customerId: DotyposCustomerId,
    orderId: OrderId
  ) => Effect.Effect<GoodsOrderDetail, GoodsOrderRepositoryError>;
}

export class GoodsOrderRepository extends Context.Service<
  GoodsOrderRepository,
  IGoodsOrderRepository
>()("@deskohub-workspace/goods/GoodsOrderRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        issue: Effect.fn("GoodsOrderRepository.issue")((input) =>
          db.transaction((tx) => issueGoodsOrder(tx, input))
        ),
        list: Effect.fn("GoodsOrderRepository.list")((customerId) =>
          db.transaction((tx) => listGoodsOrders(tx, customerId))
        ),
        findByIssuanceId: Effect.fn("GoodsOrderRepository.findByIssuanceId")(
          (customerId, issuanceId, issuanceFingerprint) =>
            db.transaction((tx) =>
              findGoodsOrderByIssuanceId(
                tx,
                customerId,
                issuanceId,
                issuanceFingerprint
              )
            )
        ),
        get: Effect.fn("GoodsOrderRepository.get")((customerId, orderId) =>
          db.transaction((tx) => getGoodsOrder(tx, customerId, orderId))
        ),
      } satisfies IGoodsOrderRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

type GoodsOrderTransaction = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

const issueGoodsOrder = Effect.fn("GoodsOrderRepository.issueTransaction")(
  function* (tx: GoodsOrderTransaction, input: IssueGoodsOrderRepositoryInput) {
    const correlationId = NexiCorrelationIdSchema.make(input.issuanceId);
    const { issuanceFingerprint } = input;
    const [inserted] = yield* tx
      .insert(orders)
      .values({
        kind: "goods",
        correlationId,
        dotyposCustomerId: input.customerId,
        issuanceFingerprint,
        paymentState: "not_started",
        fulfillmentState: "fulfilled",
        fulfilledAt: input.issuedAt,
        createdAt: input.issuedAt,
        updatedAt: input.issuedAt,
      })
      .onConflictDoNothing({ target: orders.correlationId })
      .returning();

    if (!inserted) {
      return yield* loadIdempotentOrder(
        tx,
        input,
        correlationId,
        issuanceFingerprint
      );
    }

    const [cart] = yield* tx
      .select({ id: goodsCarts.id, revision: goodsCarts.revision })
      .from(goodsCarts)
      .where(eq(goodsCarts.dotyposCustomerId, input.customerId))
      .limit(1)
      .for("update");
    const current = cart
      ? yield* loadCartItems(tx, cart.id, cart.revision)
      : emptyGoodsCart;
    if (!goodsCartsEqual(current, input.expectedCart)) {
      return yield* new GoodsOrderCartChangedError({ current });
    }
    if (!cart) {
      return yield* new GoodsOrderCartChangedError({ current });
    }

    yield* tx.insert(orderLines).values(
      input.lines.map((line, sequence) => ({
        orderId: inserted.id,
        sequence,
        productIdentity: line.product,
        description: line.description,
        quantity: line.quantity,
        unitPriceValue: line.unitPrice.value,
        undiscountedTotalValue: line.undiscountedTotal.value,
        payableTotalValue: line.payableTotal.value,
        amountExponent: line.unitPrice.exponent,
        currency: line.unitPrice.currency,
        createdAt: input.issuedAt,
      }))
    );

    if (input.discountCommitment) {
      yield* persistIssuedGoodsDiscountEvidence({
        tx,
        orderId: inserted.id,
        commitment: input.discountCommitment,
        locale: input.locale,
        issuedAt: input.issuedAt,
      });
    }

    yield* persistLegalEvidenceEvents({
      tx,
      events: input.legalDocuments.map(
        ({ documentKey, document, acknowledgements }) => ({
          orderId: inserted.id,
          evidence: {
            documentKey,
            documentHash: document.hash,
            accepted: true,
            acceptedAt: input.issuedAt.toString(),
            locale: input.locale,
            source: goodsOrderIssueLegalEvidenceSource,
            document,
            ...(acknowledgements && { acknowledgements }),
          },
        })
      ),
    });

    yield* tx.delete(goodsCartItems).where(eq(goodsCartItems.cartId, cart.id));
    yield* tx
      .update(goodsCarts)
      .set({ revision: cart.revision + 1, updatedAt: input.issuedAt })
      .where(eq(goodsCarts.id, cart.id));

    return yield* makeGoodsOrderDetail(inserted, input.lines);
  }
);

const loadIdempotentOrder = Effect.fn(
  "GoodsOrderRepository.loadIdempotentOrder"
)(function* (
  tx: GoodsOrderTransaction,
  input: IssueGoodsOrderRepositoryInput,
  correlationId: NexiCorrelationId,
  issuanceFingerprint: string
) {
  const [order] = yield* tx
    .select()
    .from(orders)
    .where(eq(orders.correlationId, correlationId))
    .limit(1)
    .for("share");
  if (
    order?.kind !== "goods" ||
    order.dotyposCustomerId !== input.customerId ||
    order.issuanceFingerprint !== issuanceFingerprint
  ) {
    return yield* new GoodsOrderIssuanceConflictError({
      message: "The issuance identifier belongs to another order.",
    });
  }
  const detail = yield* loadGoodsOrderDetail(tx, order);
  const evidence = yield* tx
    .select({
      accepted: legalEvidenceEvents.accepted,
      documentHash: legalEvidenceEvents.documentHash,
      documentKey: legalEvidenceEvents.documentKey,
      documentPath: legalEvidenceEvents.documentPath,
      hashAlgorithm: legalEvidenceEvents.hashAlgorithm,
      locale: legalEvidenceEvents.locale,
    })
    .from(legalEvidenceEvents)
    .where(
      and(
        eq(legalEvidenceEvents.orderId, order.id),
        eq(legalEvidenceEvents.source, goodsOrderIssueLegalEvidenceSource)
      )
    )
    .orderBy(asc(legalEvidenceEvents.documentKey));
  const expectedEvidence = input.legalDocuments
    .map(({ documentKey, document }) => ({
      accepted: true,
      documentHash: document.hash,
      documentKey,
      documentPath: document.path,
      hashAlgorithm: document.hashAlgorithm,
      locale: input.locale,
    }))
    .toSorted((left, right) =>
      left.documentKey.localeCompare(right.documentKey)
    );
  const [storedDiscountApplication] = yield* tx
    .select({ id: discountApplications.id })
    .from(discountApplications)
    .where(
      and(
        eq(discountApplications.orderId, order.id),
        isNull(discountApplications.paymentAttemptId)
      )
    )
    .limit(1);

  if (
    !goodsOrderLinesEqual(detail.lines, input.lines) ||
    !evidence.every((event, index) =>
      legalEvidenceMatches(event, expectedEvidence[index])
    ) ||
    evidence.length !== expectedEvidence.length ||
    Boolean(storedDiscountApplication) !== Boolean(input.discountCommitment)
  ) {
    return yield* new GoodsOrderIssuanceConflictError({
      message: "The issuance identifier was reused with different order facts.",
    });
  }
  if (input.discountCommitment) {
    yield* persistIssuedGoodsDiscountEvidence({
      tx,
      orderId: order.id,
      commitment: input.discountCommitment,
      locale: input.locale,
      issuedAt: order.fulfilledAt!,
    });
  }
  return detail;
});

const listGoodsOrders = Effect.fn("GoodsOrderRepository.listTransaction")(
  function* (tx: GoodsOrderTransaction, customerId: DotyposCustomerId) {
    const rows = yield* tx
      .select()
      .from(orders)
      .where(
        and(eq(orders.kind, "goods"), eq(orders.dotyposCustomerId, customerId))
      )
      .orderBy(desc(orders.createdAt));
    if (rows.length === 0) return [];

    const lines = yield* loadGoodsOrderLines(
      tx,
      rows.map(({ id }) => id)
    );
    return yield* Effect.forEach(rows, (row) =>
      makeGoodsOrderDetail(row, lines.get(row.id) ?? []).pipe(
        Effect.map(({ lines: _lines, ...summary }) => summary)
      )
    );
  }
);

const findGoodsOrderByIssuanceId = Effect.fn(
  "GoodsOrderRepository.findByIssuanceIdTransaction"
)(function* (
  tx: GoodsOrderTransaction,
  customerId: DotyposCustomerId,
  issuanceId: GoodsOrderIssuanceId,
  issuanceFingerprint: string
) {
  const [order] = yield* tx
    .select()
    .from(orders)
    .where(eq(orders.correlationId, NexiCorrelationIdSchema.make(issuanceId)))
    .limit(1)
    .for("share");
  if (!order) return Option.none<GoodsOrderDetail>();
  if (
    order.kind !== "goods" ||
    order.dotyposCustomerId !== customerId ||
    order.issuanceFingerprint !== issuanceFingerprint
  ) {
    return yield* new GoodsOrderIssuanceConflictError({
      message: "The issuance identifier belongs to another order.",
    });
  }
  return Option.some(yield* loadGoodsOrderDetail(tx, order));
});

const getGoodsOrder = Effect.fn("GoodsOrderRepository.getTransaction")(
  function* (
    tx: GoodsOrderTransaction,
    customerId: DotyposCustomerId,
    orderId: OrderId
  ) {
    const [order] = yield* tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.kind, "goods"),
          eq(orders.dotyposCustomerId, customerId)
        )
      )
      .limit(1)
      .for("share");
    if (!order) return yield* new GoodsOrderNotFoundError({ orderId });
    return yield* loadGoodsOrderDetail(tx, order);
  }
);

const loadGoodsOrderDetail = Effect.fn("GoodsOrderRepository.loadDetail")(
  function* (tx: GoodsOrderTransaction, order: OrderRow) {
    const lines = yield* loadGoodsOrderLines(tx, [order.id]);
    return yield* makeGoodsOrderDetail(order, lines.get(order.id) ?? []);
  }
);

const loadGoodsOrderLines = Effect.fn("GoodsOrderRepository.loadLines")(
  function* (tx: GoodsOrderTransaction, orderIds: readonly OrderId[]) {
    const rows = yield* tx
      .select()
      .from(orderLines)
      .where(inArray(orderLines.orderId, [...orderIds]))
      .orderBy(asc(orderLines.orderId), asc(orderLines.sequence));
    const result = new Map<OrderId, GoodsOrderLine[]>();
    for (const row of rows) {
      const product = yield* Schema.decodeUnknownEffect(
        workspaceGoodsProductIdentitySchema,
        { onExcessProperty: "error" }
      )(row.productIdentity).pipe(
        Effect.mapError(
          (cause) =>
            new GoodsOrderStoredDataError({
              message: "Stored goods product identity is invalid.",
              cause,
            })
        )
      );
      const line: GoodsOrderLine = {
        product,
        description: row.description,
        quantity: row.quantity,
        unitPrice: {
          value: row.unitPriceValue,
          exponent: row.amountExponent,
          currency: row.currency,
        },
        undiscountedTotal: {
          value: row.undiscountedTotalValue,
          exponent: row.amountExponent,
          currency: row.currency,
        },
        payableTotal: {
          value: row.payableTotalValue,
          exponent: row.amountExponent,
          currency: row.currency,
        },
      };
      const existing = result.get(row.orderId);
      if (existing) existing.push(line);
      else result.set(row.orderId, [line]);
    }
    return result;
  }
);

const makeGoodsOrderDetail = Effect.fn("GoodsOrderRepository.makeDetail")(
  function* (order: OrderRow, lines: readonly GoodsOrderLine[]) {
    const first = lines[0];
    if (!first || !order.fulfilledAt) {
      return yield* new GoodsOrderStoredDataError({
        message: "Stored goods order is incomplete.",
      });
    }
    if (
      lines.some(
        ({ unitPrice }) =>
          unitPrice.currency !== first.unitPrice.currency ||
          unitPrice.exponent !== first.unitPrice.exponent
      )
    ) {
      return yield* new GoodsOrderStoredDataError({
        message: "Stored goods order mixes monetary units.",
      });
    }

    return yield* Schema.decodeUnknownEffect(goodsOrderDetailSchema, {
      onExcessProperty: "error",
    })({
      id: order.id,
      paymentState: order.paymentState,
      fulfillmentState: order.fulfillmentState,
      fulfilledAt: temporalInstantToIsoString(order.fulfilledAt),
      createdAt: temporalInstantToIsoString(order.createdAt),
      undiscountedTotal: {
        value: lines.reduce(
          (sum, line) => sum + line.undiscountedTotal.value,
          0
        ),
        exponent: first.unitPrice.exponent,
        currency: first.unitPrice.currency,
      },
      payableTotal: {
        value: lines.reduce((sum, line) => sum + line.payableTotal.value, 0),
        exponent: first.unitPrice.exponent,
        currency: first.unitPrice.currency,
      },
      lines,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new GoodsOrderStoredDataError({
            message: "Stored goods order is invalid.",
            cause,
          })
      )
    );
  }
);

const loadCartItems = Effect.fn("GoodsOrderRepository.loadCartItems")(
  function* (
    tx: GoodsOrderTransaction,
    cartId: GoodsCartId,
    revision: GoodsCartRevision
  ) {
    const items = yield* tx
      .select({
        productId: goodsCartItems.productId,
        quantity: goodsCartItems.quantity,
      })
      .from(goodsCartItems)
      .where(eq(goodsCartItems.cartId, cartId))
      .orderBy(asc(goodsCartItems.productId));
    return { revision, items } satisfies GoodsCart;
  }
);

const goodsCartsEqual = (left: GoodsCart, right: GoodsCart) => {
  if (
    left.revision !== right.revision ||
    left.items.length !== right.items.length
  ) {
    return false;
  }
  const rightItems = new Map(
    right.items.map(({ productId, quantity }) => [productId, quantity])
  );
  return left.items.every(
    ({ productId, quantity }) => rightItems.get(productId) === quantity
  );
};

const goodsOrderLinesEqual = (
  left: readonly GoodsOrderLine[],
  right: readonly GoodsOrderLine[]
) =>
  left.length === right.length &&
  left.every((line, index) => {
    const expected = right[index];
    return (
      expected !== undefined &&
      getWorkspaceProductKey(line.product) ===
        getWorkspaceProductKey(expected.product) &&
      line.description === expected.description &&
      line.quantity === expected.quantity &&
      workspaceMoneyEquals(line.unitPrice, expected.unitPrice) &&
      workspaceMoneyEquals(
        line.undiscountedTotal,
        expected.undiscountedTotal
      ) &&
      workspaceMoneyEquals(line.payableTotal, expected.payableTotal)
    );
  });

const workspaceMoneyEquals = (left: WorkspaceMoney, right: WorkspaceMoney) =>
  left.value === right.value &&
  left.exponent === right.exponent &&
  left.currency === right.currency;

const legalEvidenceMatches = (
  left: {
    readonly accepted: boolean;
    readonly documentHash: string;
    readonly documentKey: string;
    readonly documentPath: string;
    readonly hashAlgorithm: string;
    readonly locale: string;
  },
  right: typeof left | undefined
) =>
  right !== undefined &&
  left.accepted === right.accepted &&
  left.documentHash === right.documentHash &&
  left.documentKey === right.documentKey &&
  left.documentPath === right.documentPath &&
  left.hashAlgorithm === right.hashAlgorithm &&
  left.locale === right.locale;
