import {
  NexiCorrelationIdSchema,
  type NexiOperation,
  type NexiOperationId,
  type NexiOrder,
  type NexiOrderId,
  NexiService,
} from "@deskohub/nexi";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { type PaymentAttemptState, paymentAttempts } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";

const defaultMaxRecords = 50;
const maximumRecords = 100;

const paymentAttemptStateLabels = {
  created: "Started",
  pending: "Pending",
  paid: "Paid",
  failed: "Unsuccessful",
  cancelled: "Unsuccessful",
  expired: "Unsuccessful",
} satisfies Record<PaymentAttemptState, string>;

export type AdministrationOrderLink = {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly reservationId: WorkspaceReservationId;
  readonly state: PaymentAttemptState;
  readonly stateLabel: string;
  readonly amount: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  };
  readonly attemptCreatedAt: string;
  readonly providerOrderCreatedAt: string | null;
  readonly providerOrderCreatedAtEstimated: boolean;
};

export type AdministrationOrder = {
  readonly orderId: NexiOrderId;
  readonly provider: NexiOrder | null;
  readonly providerAvailable: boolean;
  readonly providerStatus:
    | "available"
    | "not_found"
    | "not_returned"
    | "unavailable";
  readonly link: AdministrationOrderLink | null;
};

export type AdministrationOperation = NexiOperation & {
  readonly linkedReservationId: WorkspaceReservationId | null;
};

export type AdministrationOrderListInput = {
  readonly fromTime?: string;
  readonly toTime?: string;
  readonly maxRecords?: number;
};

export type AdministrationOperationListInput = AdministrationOrderListInput & {
  readonly channel?: string;
  readonly operationType?: string;
};

export type AdministrationOrderList = {
  readonly items: readonly AdministrationOrder[];
  readonly providerAvailable: boolean;
  readonly truncated: boolean;
};

export type AdministrationOperationList = {
  readonly items: readonly AdministrationOperation[];
  readonly providerAvailable: boolean;
  readonly truncated: boolean;
};

type LocalOrderRow = {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly providerOrderId: NexiOrderId;
  readonly reservationId: WorkspaceReservationId;
  readonly state: PaymentAttemptState;
  readonly failureCode: string | null;
  readonly amountValue: number;
  readonly amountExponent: number;
  readonly currency: string;
  readonly attemptCreatedAt: Temporal.Instant;
  readonly providerOrderCreatedAt: Temporal.Instant | null;
  readonly providerSessionAttached: boolean;
};

type ProviderOrderLookup =
  | { readonly kind: "available"; readonly provider: NexiOrder }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

type ProviderOperationLookup =
  | { readonly kind: "available"; readonly operation: NexiOperation }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

const toOrderLink = (row: LocalOrderRow): AdministrationOrderLink => {
  const providerOrderCreatedAt =
    row.providerOrderCreatedAt ??
    (row.providerSessionAttached ? row.attemptCreatedAt : null);
  return {
    paymentAttemptId: row.paymentAttemptId,
    reservationId: row.reservationId,
    state: row.state,
    stateLabel:
      row.failureCode === "payment_abandoned_after_provider_cutoff"
        ? "Abandoned"
        : paymentAttemptStateLabels[row.state],
    amount: {
      value: row.amountValue,
      exponent: row.amountExponent,
      currency: row.currency,
    },
    attemptCreatedAt: row.attemptCreatedAt.toString(),
    providerOrderCreatedAt: providerOrderCreatedAt?.toString() ?? null,
    providerOrderCreatedAtEstimated:
      row.providerOrderCreatedAt === null && row.providerSessionAttached,
  };
};

const localOrderSelection = {
  paymentAttemptId: paymentAttempts.id,
  providerOrderId: paymentAttempts.providerOrderId,
  reservationId: paymentAttempts.workspaceReservationId,
  state: paymentAttempts.state,
  failureCode: paymentAttempts.failureCode,
  amountValue: paymentAttempts.amountValue,
  amountExponent: paymentAttempts.amountExponent,
  currency: paymentAttempts.currency,
  attemptCreatedAt: paymentAttempts.createdAt,
  providerOrderCreatedAt: paymentAttempts.providerOrderCreatedAt,
  providerSessionAttached: sql<boolean>`${paymentAttempts.providerRedirectUrl} is not null`,
} as const;

const normalizeMaximumRecords = (value?: number) =>
  Math.min(maximumRecords, Math.max(1, value ?? defaultMaxRecords));

const toLocalOrderRows = (
  rows: readonly (Omit<LocalOrderRow, "providerOrderId"> & {
    readonly providerOrderId: NexiOrderId | null;
  })[]
): readonly LocalOrderRow[] =>
  rows.flatMap((row) =>
    row.providerOrderId
      ? [{ ...row, providerOrderId: row.providerOrderId }]
      : []
  );

export interface IPaymentAdministrationService {
  readonly listOrders: (
    input: AdministrationOrderListInput
  ) => Effect.Effect<AdministrationOrderList, unknown>;
  readonly loadOrder: (
    orderId: NexiOrderId
  ) => Effect.Effect<AdministrationOrder, unknown>;
  readonly listOperations: (
    input: AdministrationOperationListInput
  ) => Effect.Effect<AdministrationOperationList, unknown>;
  readonly loadOperation: (operationId: NexiOperationId) => Effect.Effect<
    {
      readonly operationId: NexiOperationId;
      readonly operation: NexiOperation | null;
      readonly providerAvailable: boolean;
      readonly providerStatus: "available" | "not_found" | "unavailable";
      readonly linkedReservationId: WorkspaceReservationId | null;
    },
    unknown
  >;
  readonly loadReservationOrders: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<readonly AdministrationOrder[], unknown>;
}

export class PaymentAdministrationService extends Context.Service<
  PaymentAdministrationService,
  IPaymentAdministrationService
>()("@deskohub-workspace/administration/PaymentAdministrationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const nexi = yield* NexiService;

      const loadLocalOrderRows = (input: AdministrationOrderListInput) => {
        const orderCreatedAt = sql<Temporal.Instant>`coalesce(${paymentAttempts.providerOrderCreatedAt}, ${paymentAttempts.createdAt})`;
        const conditions: SQL[] = [
          eq(paymentAttempts.provider, "nexi"),
          isNotNull(paymentAttempts.providerOrderId),
        ];
        if (input.fromTime) {
          conditions.push(
            gte(orderCreatedAt, Temporal.Instant.from(input.fromTime))
          );
        }
        if (input.toTime) {
          conditions.push(
            lt(orderCreatedAt, Temporal.Instant.from(input.toTime))
          );
        }
        return db
          .select(localOrderSelection)
          .from(paymentAttempts)
          .where(and(...conditions))
          .orderBy(desc(orderCreatedAt))
          .limit(normalizeMaximumRecords(input.maxRecords));
      };

      const loadLinksByOrderIds = Effect.fn(
        "PaymentAdministrationService.loadLinksByOrderIds"
      )(function* (orderIds: readonly NexiOrderId[]) {
        if (orderIds.length === 0) {
          return new Map<NexiOrderId, AdministrationOrderLink>();
        }
        const rows = toLocalOrderRows(
          yield* db
            .select(localOrderSelection)
            .from(paymentAttempts)
            .where(
              and(
                eq(paymentAttempts.provider, "nexi"),
                inArray(paymentAttempts.providerOrderId, [...orderIds])
              )
            )
        );
        return new Map(
          rows.map((row) => [row.providerOrderId, toOrderLink(row)] as const)
        );
      });

      const getProviderOrder = (
        orderId: NexiOrderId
      ): Effect.Effect<ProviderOrderLookup> =>
        nexi
          .getOrder({
            correlationId: NexiCorrelationIdSchema.make(crypto.randomUUID()),
            orderId,
          })
          .pipe(
            Effect.map(
              (provider): ProviderOrderLookup => ({
                kind: "available" as const,
                provider,
              })
            ),
            Effect.catchTag("ExternalAPIError", (cause) => {
              if (cause.statusCode === 404) {
                return Effect.succeed<ProviderOrderLookup>({
                  kind: "not_found",
                });
              }
              return Effect.logWarning("Nexi order details unavailable", {
                cause,
                orderId,
              }).pipe(Effect.as<ProviderOrderLookup>({ kind: "unavailable" }));
            }),
            Effect.catch((cause) =>
              Effect.logWarning("Nexi order details unavailable", {
                cause,
                orderId,
              }).pipe(Effect.as<ProviderOrderLookup>({ kind: "unavailable" }))
            )
          );

      const listOrders = Effect.fn("PaymentAdministrationService.listOrders")(
        function* (input: AdministrationOrderListInput) {
          const maxRecords = normalizeMaximumRecords(input.maxRecords);
          const [localRows, providerResult] = yield* Effect.all(
            [
              loadLocalOrderRows({ ...input, maxRecords }),
              nexi
                .listOrders({
                  correlationId: NexiCorrelationIdSchema.make(
                    crypto.randomUUID()
                  ),
                  fromTime: input.fromTime,
                  toTime: input.toTime,
                  maxRecords,
                })
                .pipe(
                  Effect.map((items) => ({
                    kind: "available" as const,
                    items,
                  })),
                  Effect.catch((cause) =>
                    Effect.logWarning("Nexi order list unavailable", {
                      cause,
                    }).pipe(Effect.as({ kind: "unavailable" as const }))
                  )
                ),
            ],
            { concurrency: 2 }
          );
          const localOrders = toLocalOrderRows(localRows);
          const providerItems =
            providerResult.kind === "available" ? providerResult.items : [];
          const localOrderIds = new Set(
            localOrders.map(({ providerOrderId }) => providerOrderId)
          );
          const links = yield* loadLinksByOrderIds(
            providerItems.flatMap((provider) =>
              localOrderIds.has(provider.orderId) ? [] : [provider.orderId]
            )
          );
          for (const row of localOrders) {
            links.set(row.providerOrderId, toOrderLink(row));
          }
          const orders = new Map<NexiOrderId, AdministrationOrder>();
          for (const provider of providerItems) {
            orders.set(provider.orderId, {
              orderId: provider.orderId,
              provider,
              providerAvailable: true,
              providerStatus: "available",
              link: links.get(provider.orderId) ?? null,
            });
          }
          for (const row of localOrders) {
            if (!orders.has(row.providerOrderId)) {
              orders.set(row.providerOrderId, {
                orderId: row.providerOrderId,
                provider: null,
                providerAvailable: providerResult.kind === "available",
                providerStatus:
                  providerResult.kind === "available"
                    ? "not_returned"
                    : "unavailable",
                link: toOrderLink(row),
              });
            }
          }
          const items = [...orders.values()].toSorted((left, right) => {
            const leftTime =
              left.provider?.lastOperationTime ??
              left.link?.providerOrderCreatedAt ??
              left.link?.attemptCreatedAt ??
              "";
            const rightTime =
              right.provider?.lastOperationTime ??
              right.link?.providerOrderCreatedAt ??
              right.link?.attemptCreatedAt ??
              "";
            return rightTime.localeCompare(leftTime);
          });
          return {
            items,
            providerAvailable: providerResult.kind === "available",
            truncated:
              providerItems.length >= maxRecords ||
              localOrders.length >= maxRecords,
          };
        }
      );

      const loadOrder = Effect.fn("PaymentAdministrationService.loadOrder")(
        function* (orderId: NexiOrderId) {
          const [localRows, providerResult] = yield* Effect.all(
            [
              db
                .select(localOrderSelection)
                .from(paymentAttempts)
                .where(
                  and(
                    eq(paymentAttempts.provider, "nexi"),
                    eq(paymentAttempts.providerOrderId, orderId)
                  )
                )
                .limit(1),
              getProviderOrder(orderId),
            ],
            { concurrency: 2 }
          );
          const local = toLocalOrderRows(localRows)[0];
          return {
            orderId,
            provider:
              providerResult.kind === "available"
                ? providerResult.provider
                : null,
            providerAvailable: providerResult.kind === "available",
            providerStatus: providerResult.kind,
            link: local ? toOrderLink(local) : null,
          };
        }
      );

      const listOperations = Effect.fn(
        "PaymentAdministrationService.listOperations"
      )(function* (input: AdministrationOperationListInput) {
        const maxRecords = normalizeMaximumRecords(input.maxRecords);
        const providerResult = yield* nexi
          .listOperations({
            correlationId: NexiCorrelationIdSchema.make(crypto.randomUUID()),
            fromTime: input.fromTime,
            toTime: input.toTime,
            maxRecords,
            channel: input.channel,
            operationType: input.operationType,
          })
          .pipe(
            Effect.map((items) => ({ kind: "available" as const, items })),
            Effect.catch((cause) =>
              Effect.logWarning("Nexi operation list unavailable", {
                cause,
              }).pipe(Effect.as({ kind: "unavailable" as const }))
            )
          );
        if (providerResult.kind === "unavailable") {
          return {
            items: [],
            providerAvailable: false,
            truncated: false,
          };
        }
        const links = yield* loadLinksByOrderIds(
          providerResult.items.flatMap(({ orderId }) =>
            orderId ? [orderId] : []
          )
        );
        return {
          items: providerResult.items.map((operation) => ({
            ...operation,
            linkedReservationId: operation.orderId
              ? (links.get(operation.orderId)?.reservationId ?? null)
              : null,
          })),
          providerAvailable: true,
          truncated: providerResult.items.length >= maxRecords,
        };
      });

      const loadOperation = Effect.fn(
        "PaymentAdministrationService.loadOperation"
      )(function* (operationId: NexiOperationId) {
        const result: ProviderOperationLookup = yield* nexi
          .getOperation({
            correlationId: NexiCorrelationIdSchema.make(crypto.randomUUID()),
            operationId,
          })
          .pipe(
            Effect.map(
              (operation): ProviderOperationLookup => ({
                kind: "available",
                operation,
              })
            ),
            Effect.catchTag("ExternalAPIError", (cause) => {
              if (cause.statusCode === 404) {
                return Effect.succeed<ProviderOperationLookup>({
                  kind: "not_found",
                });
              }
              return Effect.logWarning("Nexi operation details unavailable", {
                cause,
                operationId,
              }).pipe(
                Effect.as<ProviderOperationLookup>({ kind: "unavailable" })
              );
            }),
            Effect.catch((cause) =>
              Effect.logWarning("Nexi operation details unavailable", {
                cause,
                operationId,
              }).pipe(
                Effect.as<ProviderOperationLookup>({ kind: "unavailable" })
              )
            )
          );
        const links = yield* loadLinksByOrderIds(
          result.kind === "available" && result.operation.orderId
            ? [result.operation.orderId]
            : []
        );
        return {
          operationId,
          operation: result.kind === "available" ? result.operation : null,
          providerAvailable: result.kind === "available",
          providerStatus: result.kind,
          linkedReservationId:
            result.kind === "available" && result.operation.orderId
              ? (links.get(result.operation.orderId)?.reservationId ?? null)
              : null,
        };
      });

      const loadReservationOrders = Effect.fn(
        "PaymentAdministrationService.loadReservationOrders"
      )(function* (reservationId: WorkspaceReservationId) {
        const localRows = toLocalOrderRows(
          yield* db
            .select(localOrderSelection)
            .from(paymentAttempts)
            .where(
              and(
                eq(paymentAttempts.provider, "nexi"),
                eq(paymentAttempts.workspaceReservationId, reservationId),
                isNotNull(paymentAttempts.providerOrderId)
              )
            )
            .orderBy(paymentAttempts.createdAt)
        );
        return yield* Effect.all(
          localRows.map((row) =>
            getProviderOrder(row.providerOrderId).pipe(
              Effect.map(
                (providerResult): AdministrationOrder => ({
                  orderId: row.providerOrderId,
                  provider:
                    providerResult.kind === "available"
                      ? providerResult.provider
                      : null,
                  providerAvailable: providerResult.kind === "available",
                  providerStatus: providerResult.kind,
                  link: toOrderLink(row),
                })
              )
            )
          ),
          { concurrency: 4 }
        );
      });

      return {
        listOrders,
        loadOrder,
        listOperations,
        loadOperation,
        loadReservationOrders,
      };
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(Layer.merge(WorkspaceDatabase.Live, WorkspaceNexiLayer))
  );
}
